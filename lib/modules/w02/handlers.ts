// W02(인플루언서 계약·캠페인 집행) 업무 모듈 — 엔진에 꽂는 handler.
// 엔진은 이 파일을 모른다. 여기서 "이 업무에서는 무엇을 사실로 보고, 결정 뒤 어떤 일이 생기는가"를 정한다.
//
// 후속 작업의 뼈대는 W02.bpmn(교육용 현재 업무)을 따른다:
//   승인 → 승인조건 문서화 → 상대방에 결과 통보 → 통보·회신 기록 보관 / 부결 → 기한 전 재검토
// BPMN 은 주최 측의 교육용 가정이므로 이 작업들은 data_origin '가정'으로 표시한다.
import type { AuthorityDecision, Facts } from '../../rules/types'
import type { CaseHandler, HandlerCtx, TaskSpec } from '../../engine/engine'
import type { DecisionCase } from '../../engine/types'
import { dateInBreachWindow, type BreachWindow } from '../cash/simulate'
import { CONTRACT_CASE_TYPE, EXPANSION_CASE_TYPE } from './contract-notice'

export interface W02Deps {
  decide(caseType: string, facts: Facts): AuthorityDecision
  roleLabel(roleId: string): string
}

export interface W02Ctx extends HandlerCtx {
  /** 현금 재전망으로 구한 하회 구간(원본 전망 포함분만 — 새 기안은 넣지 않은 기준선). 없으면 null → 모름 */
  cashWindows?: BreachWindow[] | null
}

const BPMN = 'W02.bpmn (교육용 현재 업무)'
type Payload = { facts?: Facts; plan?: { settlement_date?: string }; evaluation?: { decision?: AuthorityDecision } }

export function outflowDate(c: DecisionCase): string | null {
  const p = c.payload as Payload
  const f = p.facts ?? {}
  if (c.caseType === EXPANSION_CASE_TYPE) return (f.settlement_date as string) ?? p.plan?.settlement_date ?? null
  return (f.fixed_fee_payment_date as string) ?? null
}

/** 돈 나가는 날이 하회 구간 안인가: true / false / null(모름: 날짜를 모르거나 재전망이 없음) */
export function inBreachWindow(c: DecisionCase, ctx: W02Ctx): boolean | null {
  const date = outflowDate(c)
  if (!date || !ctx.cashWindows) return null
  return dateInBreachWindow(ctx.cashWindows, date)
}

/** 승인 앞 단계: 재무가 성과·비용표를 취합하고(수작업), 계약 담당이 계약 조건·기한을 확인한다. 둘 다 끝나야 승인권자가 결정할 수 있다.
 *  W02.bpmn 의 '성과·비용표 취합' → '계약조건·기한 확인' (교육용 가정). 같은 안건에서 한 번만 만든다(once). */
export function prepTasks(deadline: string | null, contractTitle: string): TaskSpec[] {
  return [
    { key: 'collect-performance', taskType: 'prepare', title: '성과·비용표 취합', assigneeRole: '재무', dueDate: deadline, detail: { gate: 'pre-approval', once: true, basis: BPMN }, dataOrigin: '가정' },
    { key: 'confirm-terms', taskType: 'prepare', title: contractTitle, assigneeRole: '계약 담당', dueDate: deadline, detail: { gate: 'pre-approval', once: true, after: 'collect-performance', basis: BPMN }, dataOrigin: '가정' },
  ]
}

/** 재검토 뒤 다시 올릴 때: 승인 앞 단계 작업을 다시 연다 (once 표시를 빼서 끝난 작업이 있어도 새로 만든다) */
export const redoPrepTasks = (deadline: string | null, contractTitle: string): TaskSpec[] =>
  prepTasks(deadline, contractTitle).map((t) => ({ ...t, detail: { ...(t.detail ?? {}), once: false } }))

export function makeW02Handlers(deps: W02Deps): Record<string, CaseHandler> {
  const describeFact: CaseHandler['describeFact'] = (fact) => {
    if (fact === 'in_cash_breach_window') {
      return {
        title: '돈이 나가는 날짜 확인 (현금 하회 구간 판단용)',
        assigneeRole: '재무',
        question: '이 약정의 현금 유출일(지급 예정일)을 알려 주세요. 재전망의 하회 구간과 대조해 승인권자를 정합니다.',
        answerFields: [{ name: 'fixed_fee_payment_date', type: 'date', label: '현금 유출일(지급 예정일)' }],
      }
    }
    if (fact === 'linked_to_group_300') {
      return {
        title: '그룹 300억 배분 사업과 연결되는지 확인',
        assigneeRole: '재무',
        question: '이 마케팅 기안이 그룹 300억 배분 검토 대상에 포함되나요? (회의에서 정리되지 않은 사항)',
        answerFields: [{ name: 'linked_to_group_300', type: 'boolean', label: '300억 사업과 연결됨' }],
      }
    }
    return undefined
  }

  const contract: CaseHandler = {
    caseType: CONTRACT_CASE_TYPE,
    describeFact,
    deriveFacts: (c, ctx) => ({ in_cash_breach_window: inBreachWindow(c, ctx as W02Ctx) }),
    onEvaluated: (c): TaskSpec[] => prepTasks(c.deadline, '계약조건·기한 확인'),
    onResubmit: (c): TaskSpec[] => redoPrepTasks(c.deadline, '계약조건·기한 확인'),
    onDecision: (c, outcome): TaskSpec[] => {
      const deadline = c.deadline
      if (outcome === 'approved') {
        return [
          { key: 'doc-conditions', taskType: 'document', title: '승인조건 문서화', assigneeRole: '계약 담당', dueDate: deadline, detail: { basis: BPMN }, dataOrigin: '가정' },
          { key: 'notify-counterparty', taskType: 'notify', title: '상대방(인플루언서 소속 에이전시)에 계약 결과 통보 — 통보 기한 전', assigneeRole: '마케팅', dueDate: deadline, detail: { basis: BPMN, after: 'doc-conditions', note: `기한(${deadline}) 이후 통보는 효력이 없고 동일 조건 자동 갱신이 일어남` }, dataOrigin: '가정' },
          { key: 'record-reply', taskType: 'record', title: '통보·회신 기록 보관 (통보 회신 증빙 첨부)', assigneeRole: '계약 담당', dueDate: deadline, detail: { basis: BPMN, after: 'notify-counterparty' }, dataOrigin: '가정' },
          // Masil 대표가 승인하는 안건은 어차피 그룹 보고를 해야 한다 (승인권한 정책)
          ...((c.payload as Payload).evaluation?.decision?.authority === 'masil_ceo' ? [{ key: 'group-report', taskType: 'report', title: '그룹 보고 (Masil 대표 승인 건)', assigneeRole: '마케팅', dueDate: deadline, detail: { source: '00_common/approval_authority_policy.md', after: 'record-reply' }, dataOrigin: '원본' as const }] : []),
        ]
      }
      if (outcome === 'rejected') {
        // 부결 = 계약을 연장하지 않는다. 계약 담당이 후속조치(계약 미갱신 통지서 결재 보고)를 하고, 승인권자가 다시 승인하면 통지서를 발송한다.
        return [
          { key: 'request-nonrenewal', taskType: 'document', title: '후속조치: 계약 미갱신 통지서 결재 보고 — 승인권자의 승인이 필요해요', assigneeRole: '계약 담당', dueDate: deadline, detail: { basis: '사용자 지정 절차', warning: `${deadline} 까지 통보하지 않으면 동일 조건으로 1년 자동 갱신(체결로 간주)되고, 이후 해지하면 위약금이 생길 수 있음` }, dataOrigin: '가정' },
        ]
      }
      // 재검토: 처음 안건을 올린 부서(마케팅)로 돌아가 보완한 뒤 다시 절차를 진행한다
      return [{ key: 'hold-reason', taskType: 'review', title: '재검토 요청 사항 보완 후 재보고', assigneeRole: '마케팅', dueDate: deadline, detail: { basis: '사용자 지정 절차' }, dataOrigin: '가정' }]
    },
    // 불연장 통보 보고에 대한 승인권자의 결정: 승인 → 통보 발송, 재검토 → 계약 담당이 보완해 다시 보고
    onFollowupDecision: (c, kind, outcome): TaskSpec[] => {
      if (kind !== 'nonrenewal') return []
      if (outcome === 'approved') {
        return [{ key: 'send-nonrenewal', taskType: 'notify', title: '상대방에 계약 불연장(미갱신) 통지서 발송 — 통보 기한 전', assigneeRole: '계약 담당', dueDate: c.deadline, detail: { basis: '사용자 지정 절차', note: `기한(${c.deadline}) 이후 통보는 효력이 없고 동일 조건 자동 갱신이 일어남` }, dataOrigin: '가정' }]
      }
      return [{ key: 'request-nonrenewal', taskType: 'document', title: '계약 미갱신 통지서 보완 후 다시 결재 보고', assigneeRole: '계약 담당', dueDate: c.deadline, detail: { basis: '사용자 지정 절차' }, dataOrigin: '가정' }]
    },
  }

  const expansion: CaseHandler = {
    caseType: EXPANSION_CASE_TYPE,
    describeFact,
    deriveFacts: (c, ctx) => ({ in_cash_breach_window: inBreachWindow(c, ctx as W02Ctx) }),
    onEvaluated: (c): TaskSpec[] => prepTasks(c.deadline, '계약 확정기한·전속계약 확인'),
    onResubmit: (c): TaskSpec[] => redoPrepTasks(c.deadline, '계약 확정기한·전속계약 확인'),
    onDecision: (c, outcome): TaskSpec[] => {
      const p = c.payload as Payload
      const also = p.evaluation?.decision?.also ?? []
      if (outcome === 'approved') {
        // 한 방향으로만: 승인조건 문서화(계약 담당) → 상대방에 계약 통보(마케팅 = 원팀) → 통보·회신 기록 보관(계약 담당) → (총액 1억 초과 시) 그룹 보고
        const t: TaskSpec[] = [
          { key: 'doc-conditions', taskType: 'document', title: '승인조건 문서화', assigneeRole: '계약 담당', dueDate: c.deadline, detail: { basis: '사용자 지정 절차' }, dataOrigin: '가정' },
          { key: 'notify-counterparty', taskType: 'notify', title: '상대방에 계약 통보 — 계약 확정기한 전', assigneeRole: '마케팅', dueDate: c.deadline, detail: { basis: '사용자 지정 절차', after: 'doc-conditions', note: `확정기한(${c.deadline})이 지나면 자동 확정되어 철회할 수 없음` }, dataOrigin: '가정' },
          { key: 'record-reply', taskType: 'record', title: '통보·회신 기록 보관 (통보 회신 증빙 첨부)', assigneeRole: '계약 담당', dueDate: c.deadline, detail: { basis: '사용자 지정 절차', after: 'notify-counterparty' }, dataOrigin: '가정' },
        ]
        if (p.evaluation?.decision?.authority === 'masil_ceo' || also.includes('그룹 보고')) t.push({ key: 'group-report', taskType: 'report', title: '그룹 보고 (Masil 대표 승인 건)', assigneeRole: '마케팅', dueDate: c.deadline, detail: { source: '00_common/approval_authority_policy.md', after: 'record-reply' }, dataOrigin: '원본' })
        return t
      }
      if (outcome === 'rejected') {
        // 부결 = 이 캠페인을 진행하지 않는다. 계약 담당이 상대방 회신·기록을 맡는다.
        return [
          { key: 'stop-campaign', taskType: 'record', title: '캠페인 집행 중단 처리 — 상대방에 진행하지 않는다고 회신하고 기록 보관 (해당 인플루언서의 전속계약은 별개 결정이므로 통보 기한도 함께 확인)', assigneeRole: '계약 담당', dueDate: c.deadline, detail: { basis: '사용자 지정 절차', source: '00_common/approval_authority_policy.md', note: '기안을 부결해도 전속계약은 갱신될 수 있음' }, dataOrigin: '가정' },
        ]
      }
      return [{ key: 'hold-reason', taskType: 'review', title: '재검토 요청 사항 보완 후 재보고', assigneeRole: '마케팅', dueDate: c.deadline, detail: { basis: '사용자 지정 절차' }, dataOrigin: '가정' }]
    },
  }

  return { [CONTRACT_CASE_TYPE]: contract, [EXPANSION_CASE_TYPE]: expansion }
}

/** 화면에 보여 줄 보충 설명. 돈이 나가는 날(집행·지급 예정일)이 현금 하회 예상 구간 안일 때만 나온다(평시에는 없음). 엔진 상태를 바꾸지 않는다. */
export function w02Notes(c: DecisionCase, ctx: W02Ctx): string[] {
  const date = outflowDate(c)
  const wins = ctx.cashWindows
  if (!date || !wins || !dateInBreachWindow(wins, date)) return []
  const notes = [`돈이 나가는 날 ${date}: 현금 하회 예상 구간 안 (${wins.find((w) => date >= w.start && date <= w.end)?.start} ~ ${wins.find((w) => date >= w.start && date <= w.end)?.end})`]
  const first = wins[0]
  if (c.deadline && c.deadline < first.start) {
    notes.push(`확정기한(${c.deadline})이 하회 구간 시작(${first.start})보다 앞서 도래합니다 — 기한을 넘기면 자동 확정되어 철회할 수 없으므로 기한 전에 보고해야 합니다. (근거: covenant_terms_ms.md)`)
  }
  return notes
}
