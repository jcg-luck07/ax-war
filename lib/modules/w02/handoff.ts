// 부서 사이 회부 (서버 전용) — 업무 흐름에서 한 부서가 자기 일을 끝내고 다음 부서에 넘기는 동작.
//   재무팀: 성과·비용표 취합 + 그룹 300억 배분 검토 대상 판정 → 계약 담당에게 회부
//   계약 담당: 계약서 첨부 + 계약 조건·기한 확인 → 승인권자에게 회부
// 회부는 그 단계의 작업(task)을 끝내는 것이다. 끝나야 다음 단계가 열리고, 마지막 단계가 끝나야 승인권자가 결정할 수 있다 (엔진이 지킨다).
import type { Sql } from 'postgres'
import { EngineError, completeTask, createTasks, logEvent, provideInfo, updateFacts, type EngineConfig } from '@/lib/engine/engine'

export const CONTRACT_KIND = 'contract'
/** 상대방 통보 회신 증빙 — 계약 담당이 업무 흐름의 마지막 단계(통보·회신 기록 보관)에서 붙인다 */
export const NOTICE_KIND = 'notice'
/** 통보 회신 증빙을 붙일 수 있는 단계: 승인(통보·회신 기록 보관) · 캠페인 부결(집행 중단 처리) · 계약 부결(불연장 통지서 발송) */
export const NOTICE_STEPS = ['record-reply', 'stop-campaign', 'send-nonrenewal']
export const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'hwp', 'hwpx', 'txt', 'md', 'eml', 'msg', 'png', 'jpg', 'jpeg']
export const MAX_CASE_FILE_BYTES = 8 * 1024 * 1024

export interface CaseFileMeta {
  id: number
  caseId: number
  kind: string
  /** 수정 보고 첨부면 몇 번째 수정 보고인지 */
  revision: number | null
  filename: string
  size: number
  uploadedBy: string
  createdAt: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function listCaseFiles(sql: Sql, caseId: number): Promise<CaseFileMeta[]> {
  const rows = await sql`SELECT id, case_id, kind, revision, filename, size, uploaded_by, created_at FROM case_files WHERE case_id = ${caseId} ORDER BY id`
  return rows.map((r: any) => ({
    id: Number(r.id), caseId: Number(r.case_id), kind: r.kind, revision: r.revision === null ? null : Number(r.revision), filename: r.filename, size: Number(r.size), uploadedBy: r.uploaded_by, createdAt: new Date(r.created_at).toISOString(),
  }))
}

export async function getCaseFile(sql: Sql, id: number) {
  const [r] = await sql`SELECT * FROM case_files WHERE id = ${id}`
  return r ? { id: Number(r.id), filename: String(r.filename), size: Number(r.size), content: r.content as Buffer } : null
}

export async function addCaseFile(sql: Sql, input: { caseId: number; kind: string; filename: string; mime: string; content: Buffer; by: string }) {
  const [c] = await sql`SELECT id FROM decision_cases WHERE id = ${input.caseId}`
  if (!c) throw new EngineError('안건을 찾을 수 없어요')
  const ext = input.filename.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXT.includes(ext)) throw new EngineError(`${input.filename}: 올릴 수 없는 파일 형식이에요 (${ALLOWED_EXT.join(', ')})`)
  if (input.content.length === 0) throw new EngineError(`${input.filename}: 빈 파일이에요`)
  if (input.content.length > MAX_CASE_FILE_BYTES) throw new EngineError(`${input.filename}: 파일이 너무 커요 (8MB 까지)`)
  if (input.kind !== CONTRACT_KIND && input.kind !== NOTICE_KIND) throw new EngineError('올릴 수 없는 서류 종류예요')
  // 계약서는 계약 담당의 확인 단계에서만(승인권자에게 넘어간 뒤에는 바꿀 수 없다), 통보 회신 증빙은 통보·회신 기록 보관 단계에서만 올린다
  const stepKeys = input.kind === CONTRACT_KIND ? ['confirm-terms'] : NOTICE_STEPS
  const open = await sql`SELECT 1 FROM tasks WHERE case_id = ${input.caseId} AND status = 'open' AND detail->>'key' IN ${sql(stepKeys)} LIMIT 1`
  if (open.length === 0) throw new EngineError(input.kind === CONTRACT_KIND ? '계약 담당 확인 단계가 아니라서 계약서를 올릴 수 없어요' : '통보·회신 기록 보관(승인), 집행 중단 처리·불연장 통지서 발송(부결) 단계가 아니라서 통보 회신 증빙을 올릴 수 없어요')
  const [r] = await sql`
    INSERT INTO case_files (case_id, kind, filename, mime, size, content, uploaded_by)
    VALUES (${input.caseId}, ${input.kind}, ${input.filename}, ${input.mime || 'application/octet-stream'}, ${input.content.length}, ${input.content}, ${input.by}) RETURNING id`
  return Number(r.id)
}

/** 첨부했던 서류를 뺀다 — 올릴 수 있는 단계가 아직 열려 있을 때만 (계약서: 계약 담당 확인 단계, 통보 회신 증빙: 기록 보관 단계) */
export async function removeCaseFile(sql: Sql, id: number, by: string): Promise<void> {
  const [f] = await sql`SELECT id, case_id, kind, filename FROM case_files WHERE id = ${id}`
  if (!f) throw new EngineError('없는 파일이에요')
  const stepKeys = f.kind === CONTRACT_KIND ? ['confirm-terms'] : NOTICE_STEPS
  const open = await sql`SELECT 1 FROM tasks WHERE case_id = ${f.case_id} AND status = 'open' AND detail->>'key' IN ${sql(stepKeys)} LIMIT 1`
  if (open.length === 0) throw new EngineError('이미 다음 단계로 넘어가서 첨부를 뺄 수 없어요')
  await sql`DELETE FROM case_files WHERE id = ${id}`
  await logEvent(sql, Number(f.case_id), 'file_removed', '사람', by, { filename: String(f.filename), kind: String(f.kind) })
}

async function openPrepTask(sql: Sql, caseId: number, key: string) {
  const [t] = await sql`SELECT id, assignee_role FROM tasks WHERE case_id = ${caseId} AND status = 'open' AND detail->>'key' = ${key} LIMIT 1`
  return t ? { id: Number(t.id), assigneeRole: (t.assignee_role as string | null) ?? null } : null
}

/**
 * 재무팀 회부: 그룹 300억 배분 검토 대상인지 판정하고, 성과·비용표 취합을 끝내 계약 담당에게 넘긴다.
 *  linked = true  → 포함될 가능성이 있어 검토 대상으로 처리 (승인권자가 CEO/이사회)
 *  linked = false → 포함될 가능성이 없어 대상 아님
 * 확정됐다는 증거가 없으면 미확정으로 보고, 재무팀이 가능성만 따져 둘 중 하나로 정한다.
 */
export async function financeRefer(sql: Sql, cfg: EngineConfig, caseId: number, input: { linked: boolean; by: string }): Promise<{ authorityLabel: string | null }> {
  const task = await openPrepTask(sql, caseId, 'collect-performance')
  if (!task) throw new EngineError('재무팀이 처리할 단계가 아니에요 (이미 회부했거나 아직 접수 전이에요)')
  const info = await sql`SELECT id FROM tasks WHERE case_id = ${caseId} AND status = 'open' AND task_type = 'info_request' AND detail->>'fact' = 'linked_to_group_300' LIMIT 1`
  let label: string | null = null
  if (info.length > 0) {
    const r = await provideInfo(sql, cfg, Number(info[0].id), { answers: { linked_to_group_300: input.linked }, origin: '사용자입력', by: `${input.by} (재무팀)`, note: '재무팀 회부 시 판정' })
    label = r.decision.authorityLabel
  } else {
    const r = await updateFacts(sql, cfg, caseId, { patch: { linked_to_group_300: input.linked }, reason: '재무팀 회부 시 300억 배분 검토 대상 판정', origin: '사용자입력', by: input.by })
    label = r.decision.authorityLabel
  }
  await completeTask(sql, task.id, input.by)
  return { authorityLabel: label }
}

/** 계약 담당 회부: 계약서가 첨부돼 있어야 하고, 조건·기한을 확인했으면 승인권자에게 넘긴다. */
export async function contractRefer(sql: Sql, caseId: number, by: string): Promise<void> {
  const task = await openPrepTask(sql, caseId, 'confirm-terms')
  if (!task) throw new EngineError('계약 담당이 처리할 단계가 아니에요 (이미 회부했거나 재무팀 회부 전이에요)')
  const files = await listCaseFiles(sql, caseId)
  if (!files.some((f) => f.kind === CONTRACT_KIND)) throw new EngineError('계약서를 먼저 첨부해 주세요')
  await completeTask(sql, task.id, by)
}

// ───────────── 보완 요청 · 계약 불연장 통보 보고 ─────────────

/** 단계별로 보완을 요청할 수 있는 팀 = 그 단계 앞에서 거쳐 온 팀 (assigneeRole 값과 화면 이름) */
export const REWORK_TARGETS: Record<string, { role: string; label: string }[]> = {
  'collect-performance': [{ role: '마케팅', label: '마케팅팀' }],
  'confirm-terms': [{ role: '재무', label: '재무팀' }, { role: '마케팅', label: '마케팅팀' }],
}

/**
 * 보완 요청: 내 단계를 멈추고, 이전에 거쳐 온 팀에게 보완하라는 일을 보낸다.
 * 그 팀이 끝내기 전까지 내 단계는 열리지 않고(detail.after) 승인권자도 결정할 수 없다(gate).
 */
export async function requestRework(sql: Sql, caseId: number, input: { fromKey: string; toRole: string; note: string; by: string }): Promise<void> {
  const targets = REWORK_TARGETS[input.fromKey]
  if (!targets) throw new EngineError('이 단계에서는 보완을 요청할 수 없어요')
  if (!targets.some((t) => t.role === input.toRole)) throw new EngineError('보완을 요청할 수 있는 팀이 아니에요 (이전에 거쳐 온 팀만 고를 수 있어요)')
  const from = await openPrepTask(sql, caseId, input.fromKey)
  if (!from) throw new EngineError('지금 이 단계를 처리할 수 있는 상태가 아니에요')
  const note = input.note.trim().slice(0, 200)
  const reworkKey = `rework:${input.fromKey}`
  const [due] = await sql`SELECT due_date FROM tasks WHERE id = ${from.id}`
  const made = await createTasks(sql, caseId, [{
    key: reworkKey, taskType: 'review', title: `보완 요청 — ${note || '내용을 보완해 주세요'}`, assigneeRole: input.toRole,
    dueDate: due?.due_date ? new Date(due.due_date).toISOString().slice(0, 10) : null,
    detail: { gate: 'pre-approval', reworkFrom: input.fromKey, note, requestedBy: input.by }, dataOrigin: '사용자입력',
  }], { kind: '사람', name: input.by })
  if (made.length === 0) throw new EngineError('이미 보완을 요청했어요. 그 팀이 끝낼 때까지 기다려 주세요')
  await sql`UPDATE tasks SET detail = detail || ${sql.json({ after: reworkKey } as never)} WHERE id = ${from.id}`
  await logEvent(sql, caseId, 'rework_requested', '사람', input.by, { from: input.fromKey, toRole: input.toRole, note })
}

/**
 * 부결된 계약 안건의 후속: 계약 담당이 후속조치로 계약 미갱신 통지서의 결재를 보고한다 — 승인권자가 다시 승인해야 발송할 수 있다.
 * 새 승인 요청(kind = nonrenewal)을 만들고 보고 작업을 끝낸다.
 */
export async function requestNonrenewalApproval(sql: Sql, cfg: EngineConfig, caseId: number, by: string): Promise<{ requiredLabel: string }> {
  const task = await openPrepTask(sql, caseId, 'request-nonrenewal')
  if (!task) throw new EngineError('계약 미갱신 통지서를 보고할 단계가 아니에요')
  const [c] = await sql`SELECT status FROM decision_cases WHERE id = ${caseId}`
  if (!c || c.status !== 'rejected') throw new EngineError('부결된 안건만 계약 미갱신 통지서를 보고할 수 있어요')
  const [last] = await sql`SELECT required_role FROM approvals WHERE case_id = ${caseId} AND kind = 'main' AND status = 'rejected' ORDER BY id DESC LIMIT 1`
  if (!last) throw new EngineError('부결한 승인권자를 찾을 수 없어요')
  const role = String(last.required_role)
  const [ap] = await sql`INSERT INTO approvals (case_id, required_role, kind) VALUES (${caseId}, ${role}, 'nonrenewal') RETURNING id`
  await logEvent(sql, caseId, 'approval_requested', '사람', by, { approvalId: Number(ap.id), requiredRole: role, requiredLabel: cfg.roleLabel(role), kind: 'nonrenewal', note: '계약 미갱신 통지서 승인' })
  await completeTask(sql, task.id, by)
  return { requiredLabel: cfg.roleLabel(role) }
}
