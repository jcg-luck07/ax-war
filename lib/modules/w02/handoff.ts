// 부서 사이 회부 (서버 전용) — 업무 흐름에서 한 부서가 자기 일을 끝내고 다음 부서에 넘기는 동작.
//   재무팀: 성과·비용표 취합 + 그룹 300억 배분 검토 대상 판정 → 계약 담당에게 회부
//   계약 담당: 계약서 첨부 + 계약 조건·기한 확인 → 승인권자에게 회부
// 회부는 그 단계의 작업(task)을 끝내는 것이다. 끝나야 다음 단계가 열리고, 마지막 단계가 끝나야 승인권자가 결정할 수 있다 (엔진이 지킨다).
import type { Sql } from 'postgres'
import { EngineError, completeTask, provideInfo, updateFacts, type EngineConfig } from '@/lib/engine/engine'

export const CONTRACT_KIND = 'contract'
const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'hwp', 'hwpx', 'txt', 'md', 'eml', 'msg', 'png', 'jpg', 'jpeg']
export const MAX_CASE_FILE_BYTES = 8 * 1024 * 1024

export interface CaseFileMeta {
  id: number
  caseId: number
  kind: string
  filename: string
  size: number
  uploadedBy: string
  createdAt: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function listCaseFiles(sql: Sql, caseId: number): Promise<CaseFileMeta[]> {
  const rows = await sql`SELECT id, case_id, kind, filename, size, uploaded_by, created_at FROM case_files WHERE case_id = ${caseId} ORDER BY id`
  return rows.map((r: any) => ({
    id: Number(r.id), caseId: Number(r.case_id), kind: r.kind, filename: r.filename, size: Number(r.size), uploadedBy: r.uploaded_by, createdAt: new Date(r.created_at).toISOString(),
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
  // 계약 담당의 회부 전에만 올릴 수 있다 (이미 승인권자에게 넘어간 뒤에는 서류를 바꿀 수 없다)
  const open = await sql`SELECT 1 FROM tasks WHERE case_id = ${input.caseId} AND status = 'open' AND detail->>'key' = 'confirm-terms' LIMIT 1`
  if (open.length === 0) throw new EngineError('계약 담당 확인 단계가 아니라서 계약서를 올릴 수 없어요')
  const [r] = await sql`
    INSERT INTO case_files (case_id, kind, filename, mime, size, content, uploaded_by)
    VALUES (${input.caseId}, ${input.kind}, ${input.filename}, ${input.mime || 'application/octet-stream'}, ${input.content.length}, ${input.content}, ${input.by}) RETURNING id`
  return Number(r.id)
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
