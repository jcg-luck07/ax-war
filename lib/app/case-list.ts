// 안건 목록 화면용 조회 (서버 전용). 안건·승인·작업·이력을 한꺼번에 읽어 한 줄(CaseRow)로 만든다. 엔진 상태는 바꾸지 않는다.
import type { Sql } from 'postgres'
import { listCases } from '@/lib/engine/engine'
import { flowForCaseType } from '@/lib/process/definitions'
import { deriveFlowState, type FlowView } from '@/lib/process/state'
import { stateText } from '@/lib/process/status'
import { CASE_TYPE_CATEGORY, caseTypeLabel, type CategoryId } from './labels'
import { roleLabel } from './engine'

export interface CaseRow {
  id: number
  /** 목록에 보이는 제목 — 분류코드·요청액·내부 번호를 뺀 순수한 제목 */
  title: string
  /** 분류코드(전사 ID 규칙: 인플루언서 INF-nnn, 캠페인 CMP-nnnn) */
  code: string
  category: CategoryId | null
  categoryLabel: string
  /** 요청금액(원): 전속계약은 연 고정 피, 집행은 기안 요청액 */
  amount: number | null
  /** 상태 글자 (예: 재무팀 검토) 와 정렬용 단계 */
  state: string
  stage: number
  /** 결산일(돈이 나가는 날) */
  settlementDate: string | null
  /** 계약 체결 기한 */
  deadline: string | null
  dataOrigin: string
}

type Facts = Record<string, unknown>

/** 제목에서 분류코드·요청액·내부 번호(SYN-/PLAN-/SUB-)를 덜어 낸다. 예: "혜인(INF-001) 연간 전속계약 갱신 — 고정 피 연 28억 원" → "혜인 연간 전속계약 갱신" */
export function plainTitle(title: string): string {
  return title
    .replace(/\s+[—–-]\s+.*$/, '')
    .replace(/\s*\((INF|CMP)-\d+\)/g, '')
    .replace(/(^|\s)(SYN|PLAN|SUB)-[A-Z0-9]+\s*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export async function loadCaseRows(sql: Sql): Promise<CaseRow[]> {
  const [cases, approvals, tasks, events] = await Promise.all([
    listCases(sql),
    sql`SELECT case_id, status, required_role FROM approvals ORDER BY id`,
    sql`SELECT case_id, task_type, status, title, assignee_role, detail FROM tasks ORDER BY id`,
    sql`SELECT case_id, event_type FROM case_events`,
  ])
  const by = <T extends { case_id: unknown }>(rows: T[]) => {
    const m = new Map<number, T[]>()
    for (const r of rows) {
      const k = Number(r.case_id)
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return m
  }
  const ap = by(approvals as unknown as { case_id: number }[]) as Map<number, { case_id: number; status: string; required_role: string }[]>
  const tk = by(tasks as unknown as { case_id: number }[]) as Map<number, { case_id: number; task_type: string; status: string; title: string; assignee_role: string | null; detail: Record<string, unknown> }[]>
  const ev = by(events as unknown as { case_id: number }[]) as Map<number, { case_id: number; event_type: string }[]>

  return cases.map((c) => {
    const payload = c.payload as { facts?: Facts; plan?: Record<string, string | null>; evaluation?: { facts?: Facts } }
    const facts: Facts = { ...(payload.facts ?? {}), ...(payload.evaluation?.facts ?? {}) }
    const cat = CASE_TYPE_CATEGORY[c.caseType] ?? null
    const amount = Number(cat === 'influencer' ? facts.annual_contract_value_krw : facts.per_plan_amount_krw)
    const settlement = (cat === 'influencer' ? facts.fixed_fee_payment_date : facts.settlement_date ?? payload.plan?.settlement_date) as string | null | undefined

    const def = flowForCaseType(c.caseType)
    const view: FlowView = {
      case: { status: c.status, authority: c.authority },
      approvals: (ap.get(c.id) ?? []).map((a) => ({ status: a.status, requiredRole: a.required_role })),
      tasks: (tk.get(c.id) ?? []).map((t) => ({ taskType: t.task_type, status: t.status, title: t.title, assigneeRole: t.assignee_role, detail: t.detail ?? {} })),
      events: (ev.get(c.id) ?? []).map((e) => ({ eventType: e.event_type })),
    }
    const pending = view.approvals.find((a) => a.status === 'pending')
    const approverLabel = pending ? roleLabel(pending.requiredRole) : c.authority ? roleLabel(c.authority) : '승인권자'
    const st = def ? deriveFlowState(def, view) : null
    const s = stateText(def, st, c.status, approverLabel)
    return {
      id: c.id,
      title: plainTitle(c.title),
      code: (cat === 'influencer' ? c.subjectRefs.influencer : c.subjectRefs.campaign) ?? '',
      category: cat,
      categoryLabel: caseTypeLabel(c.caseType),
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      state: s.text,
      stage: s.stage,
      settlementDate: settlement || null,
      deadline: c.deadline,
      dataOrigin: c.dataOrigin,
    }
  })
}
