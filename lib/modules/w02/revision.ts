// 수정 보고 (서버 전용) — 승인 또는 부결 뒤에 사정이 바뀌어 "금액만" 달라질 때, 원래 안건과 첨부는 그대로 두고 바뀐 금액과 추가 첨부만 더해 다시 보고한다.
//   · 금액 변동이 5% 이내: 최초로 결정했던 승인권자에게 바로 보고한다.
//   · 5% 초과: 재무팀 절차(성과·비용표 취합 → 계약 담당 확인)부터 다시 거친 뒤 같은 승인권자에게 간다.
//   · 금액이 바뀌어 승인권한 기준(예: 연 10억 원, 건별 1천만 원)을 넘나들어도 승인권자는 바뀌지 않고, 최초로 결정한 승인권자가 그대로 맡는다.
// 이후 진행 단계의 모든 판단은 바뀐 금액을 기준으로 한다. 원 금액·원 첨부는 지우거나 고치지 않고 수정 보고 내역에 쌓는다.
import type { Sql } from 'postgres'
import { EngineError, createTasks, getCaseView, logEvent, type EngineConfig } from '@/lib/engine/engine'
import { EXPANSION_CASE_TYPE } from './contract-notice'
import { ALLOWED_EXT, MAX_CASE_FILE_BYTES } from './handoff'
import { REVISION_THRESHOLD, revisionRoute } from '@/lib/app/revision-rule'

export { REVISION_THRESHOLD, revisionRoute }
export const REVISION_KIND = 'revision'

export interface RevisionRecord {
  no: number
  at: string
  by: string
  fromAmount: number
  toAmount: number
  /** 직전 금액 대비 변동률 (0.032 = 3.2%) */
  pct: number
  /** direct: 승인권자에게 바로 / restart: 재무팀 절차부터 다시 */
  route: 'direct' | 'restart'
  reason: string
  approverRole: string
  files: string[]
}

/** 금액이 들어 있는 사실 이름 — 전속계약은 연 계약 금액, 캠페인은 건별 요청액 */
export const amountKeyOf = (caseType: string) => (caseType === EXPANSION_CASE_TYPE ? 'per_plan_amount_krw' : 'annual_contract_value_krw')

export interface RevisionFile {
  filename: string
  mime: string
  content: Buffer
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function reportRevision(
  sql: Sql, cfg: EngineConfig,
  input: { caseId: number; newAmount: number; reason: string; files: RevisionFile[]; by: string },
): Promise<RevisionRecord> {
  const view = await getCaseView(sql, input.caseId)
  const c = view.case
  const mains = view.approvals.filter((a) => a.kind === 'main')
  const decided = mains.filter((a) => a.status === 'approved' || a.status === 'rejected')
  if (!['approved', 'rejected', 'closed'].includes(c.status) || decided.length === 0) throw new EngineError('승인 또는 부결이 난 안건만 수정 보고할 수 있어요')
  const key = amountKeyOf(c.caseType)
  const payload = c.payload as { facts?: Record<string, unknown>; plan?: Record<string, unknown>; originalAmount?: number; revisions?: RevisionRecord[]; authorityLock?: string }
  const facts = { ...(payload.facts ?? {}) }
  const from = Number(facts[key])
  if (!(from > 0)) throw new EngineError('원래 금액을 알 수 없어요')
  const to = Math.round(input.newAmount)
  if (!Number.isInteger(to) || to <= 0) throw new EngineError('수정 금액은 0보다 큰 정수(원)로 입력해 주세요')
  if (to === from) throw new EngineError('원래 금액과 같아요. 바뀐 금액을 입력해 주세요')
  if (input.files.length > 5) throw new EngineError('수정 보고 첨부는 5개까지 올릴 수 있어요')
  for (const f of input.files) {
    const ext = f.filename.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXT.includes(ext)) throw new EngineError(`${f.filename}: 올릴 수 없는 파일 형식이에요 (${ALLOWED_EXT.join(', ')})`)
    if (f.content.length === 0) throw new EngineError(`${f.filename}: 빈 파일이에요`)
    if (f.content.length > MAX_CASE_FILE_BYTES) throw new EngineError(`${f.filename}: 파일이 너무 커요 (8MB 까지)`)
  }
  // 최초로 결정했던 승인권자 — 금액이 기준을 넘나들어도 바뀌지 않는다
  const approverRole = payload.authorityLock ?? decided[0].requiredRole
  const { pct, route } = revisionRoute(from, to)
  const prior = payload.revisions ?? []
  const record: RevisionRecord = {
    no: prior.length + 1, at: new Date().toISOString(), by: input.by, fromAmount: from, toAmount: to, pct, route,
    reason: input.reason.trim().slice(0, 300), approverRole, files: input.files.map((f) => f.filename),
  }
  facts[key] = to
  const plan = payload.plan ? { ...payload.plan } : undefined
  if (c.caseType === EXPANSION_CASE_TYPE) {
    // 같은 기안 묶음의 총액도 변동분만큼 바뀐다
    if (typeof facts.draft_total_krw === 'number') facts.draft_total_krw = Math.max(0, Number(facts.draft_total_krw) + (to - from))
    if (plan) plan.requested_budget_krw = String(to)
  }
  const next = { ...c.payload, facts, ...(plan ? { plan } : {}), originalAmount: payload.originalAmount ?? from, revisions: [...prior, record], authorityLock: approverRole }

  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    await t`UPDATE decision_cases SET payload = ${t.json(next as never)}, status = 'pending_approval', authority = ${approverRole}, updated_at = now() WHERE id = ${input.caseId}`
    // 이전 결정에서 생긴 열린 후속 작업과 대기 중인 승인(예: 불연장 통지서 승인)은 새 결정 뒤에 다시 정해지므로 닫는다
    await t`UPDATE tasks SET status = 'cancelled' WHERE case_id = ${input.caseId} AND status = 'open' AND task_type <> 'info_request'`
    await t`UPDATE approvals SET status = 'superseded', comment = '수정 보고로 대체됨' WHERE case_id = ${input.caseId} AND status = 'pending'`
    for (const f of input.files) {
      await t`INSERT INTO case_files (case_id, kind, revision, filename, mime, size, content, uploaded_by)
              VALUES (${input.caseId}, ${REVISION_KIND}, ${record.no}, ${f.filename}, ${f.mime || 'application/octet-stream'}, ${f.content.length}, ${f.content}, ${input.by})`
    }
    await logEvent(t, input.caseId, 'revision_reported', '사람', input.by, { ...record, route: route === 'direct' ? '승인권자에게 바로 보고' : '재무팀 절차부터 다시' })
    const [ap] = await t`INSERT INTO approvals (case_id, required_role) VALUES (${input.caseId}, ${approverRole}) RETURNING id`
    await logEvent(t, input.caseId, 'approval_requested', '시스템', null, { approvalId: Number(ap.id), requiredRole: approverRole, requiredLabel: cfg.roleLabel(approverRole), note: '수정 보고 — 최초 승인권자에게 배정' })
    if (route === 'restart') {
      const handler = cfg.handlers[c.caseType]
      const redo = handler?.onResubmit ? await handler.onResubmit({ ...c, payload: next } as never, cfg.ctx) : []
      await createTasks(t, input.caseId, redo, { kind: '시스템', name: null })
    }
  })
  return record
}
