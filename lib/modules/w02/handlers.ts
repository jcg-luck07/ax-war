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
import { CONTRACT_CASE_TYPE, CONTRACT_NOTICE, EXPANSION_CASE_TYPE } from './contract-notice'

export interface W02Deps {
  decide(caseType: string, facts: Facts): AuthorityDecision
  roleLabel(roleId: string): string
}

export interface W02Ctx extends HandlerCtx {
  /** 현금 재전망으로 구한 하회 구간(원본 전망 포함분만 — 새 기안은 넣지 않은 기준선). 없으면 null → 모름 */
  cashWindows?: BreachWindow[] | null
}

const BPMN = 'W02.bpmn (교육용 현재 업무)'
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10)
const nextBusinessDay = (d: string) => {
  let x = d
  do x = addDays(x, 1)
  while ([0, 6].includes(new Date(Date.parse(x)).getUTCDay()))
  return x
}

type Payload = { facts?: Facts; plan?: { settlement_date?: string }; evaluation?: { decision?: AuthorityDecision } }

function outflowDate(c: DecisionCase): string | null {
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
    onDecision: (c, outcome): TaskSpec[] => {
      const deadline = c.deadline
      if (outcome === 'approved') {
        return [
          { key: 'doc-conditions', taskType: 'document', title: '승인조건 문서화', assigneeRole: '계약 담당', dueDate: deadline, detail: { basis: BPMN }, dataOrigin: '가정' },
          { key: 'notify-counterparty', taskType: 'notify', title: '상대방(혜인 소속 에이전시)에 결과 통보 — 통보 기한 전', assigneeRole: '마케팅', dueDate: deadline, detail: { basis: BPMN, note: `기한(${CONTRACT_NOTICE.notifyDeadline}) 이후 통보는 효력이 없고 동일 조건 자동 갱신이 일어남` }, dataOrigin: '가정' },
          { key: 'record-reply', taskType: 'record', title: '통보·회신 기록 보관', assigneeRole: '계약 담당', dueDate: deadline, detail: { basis: BPMN }, dataOrigin: '가정' },
        ]
      }
      if (outcome === 'rejected') {
        return [
          { key: 'rethink-before-deadline', taskType: 'review', title: '기한 전 재검토 — 조건 변경안 또는 해지 통보 검토', assigneeRole: '마케팅', dueDate: deadline, detail: { basis: BPMN, warning: `${CONTRACT_NOTICE.notifyDeadline} 까지 통보하지 않으면 동일 조건으로 1년 자동 갱신(체결로 간주)되고, 이후 해지 시 잔여 고정 피의 50% 위약금` }, dataOrigin: '가정' },
          { key: 'watch-deadline', taskType: 'monitor', title: '통보 기한 모니터링 — 미결정이면 자동 갱신됨', assigneeRole: '계약 담당', dueDate: deadline, detail: { basis: BPMN }, dataOrigin: '가정' },
        ]
      }
      return [{ key: 'hold-reason', taskType: 'review', title: '보류 사유 확인 후 재상신 준비', assigneeRole: '마케팅', dueDate: deadline, detail: { basis: BPMN }, dataOrigin: '가정' }]
    },
  }

  const expansion: CaseHandler = {
    caseType: EXPANSION_CASE_TYPE,
    describeFact,
    deriveFacts: (c, ctx) => ({ in_cash_breach_window: inBreachWindow(c, ctx as W02Ctx) }),
    // 다른 부서(재무)의 제약이 대안을 바꾸는 지점: 집행일이 하회 구간 안이면 재무에 '집행 시기 조정' 가능 여부를 묻는다.
    onEvaluated: (c, _d, ctx0): TaskSpec[] => {
      const ctx = ctx0 as W02Ctx
      if (inBreachWindow(c, ctx) !== true) return []
      const date = outflowDate(c)!
      const win = ctx.cashWindows!.find((w) => date >= w.start && date <= w.end)!
      const suggested = nextBusinessDay(win.end)
      const p = c.payload as Payload
      const facts = { ...(p.facts ?? {}), in_cash_breach_window: false }
      const alt = deps.decide(EXPANSION_CASE_TYPE, facts)
      return [
        {
          key: 'finance-shift-settlement',
          taskType: 'info_request',
          title: '재무: 집행 예정일을 현금 하회 구간 밖으로 조정할 수 있는지 회신',
          assigneeRole: '재무',
          dueDate: c.deadline,
          detail: {
            fact: 'settlement_date',
            question: `집행 예정일 ${date} 은 현금 하회 예상 구간(${win.start}~${win.end}) 안입니다. 구간이 끝난 뒤(예: ${suggested})로 늦출 수 있으면 날짜를, 늦출 수 없으면 현재 날짜를 그대로 알려 주세요.`,
            answerFields: [{ name: 'settlement_date', type: 'date', label: '조정된 집행 예정일' }],
            currentDate: date, windowStart: win.start, windowEnd: win.end, suggestedDate: suggested,
            whatIf: { authority: alt.authority, authorityLabel: alt.authorityLabel, also: alt.also, note: '집행일이 구간 밖이 되면 승인권자가 이렇게 내려갑니다(300억 연결 여부가 확인된 경우).' },
            dept: '재무', why: '다른 부서(재무)의 현금 제약이 이 기안의 집행 시기와 승인권자를 바꿈',
          },
          dataOrigin: '원본',
        },
      ]
    },
    onDecision: (c, outcome): TaskSpec[] => {
      const p = c.payload as Payload
      const also = p.evaluation?.decision?.also ?? []
      if (outcome === 'approved') {
        const t: TaskSpec[] = [
          { key: 'prepare-execution', taskType: 'execute', title: '캠페인 집행 준비 (계약 확정기한 전 확정 여부 확인)', assigneeRole: '마케팅', dueDate: c.deadline, detail: { basis: BPMN }, dataOrigin: '가정' },
          { key: 'finance-cash-line', taskType: 'notify', title: '재무: 집행 예정일 지급액을 현금 재전망 추가 유출 줄에 반영', assigneeRole: '재무', dueDate: outflowDate(c), detail: { why: '원본 전망 포함분과 분리된 추가 유출(A05)' }, dataOrigin: '가정' },
        ]
        if (also.includes('그룹 보고')) t.push({ key: 'group-report', taskType: 'report', title: '그룹 보고 (승인권한 정책: 총액 1억 원 초과 시 Masil 대표 승인 + 그룹 보고)', assigneeRole: '마케팅', dueDate: c.deadline, detail: { source: '00_common/approval_authority_policy.md' }, dataOrigin: '원본' })
        return t
      }
      if (outcome === 'rejected') {
        return [
          { key: 'rethink-allocation', taskType: 'review', title: '[제안] 부결 후 예산 배분 재검토 — 효율 상위 인플루언서 검토 (표본 한계 명시)', assigneeRole: '마케팅', dueDate: null, detail: { note: '원본 문서에 없는 제안입니다. 과거 평균 효율을 늘린 예산에 곱하면 선형성·포화를 가정하게 됩니다(A05).' }, dataOrigin: '가정' },
          { key: 'check-contract', taskType: 'monitor', title: '혜인 전속계약은 별개 결정 — 통보 기한(7/17) 확인', assigneeRole: '계약 담당', dueDate: CONTRACT_NOTICE.notifyDeadline, detail: { source: '00_common/approval_authority_policy.md', note: '기안을 부결해도 전속계약은 갱신될 수 있음' }, dataOrigin: '원본' },
        ]
      }
      return [{ key: 'hold-reason', taskType: 'review', title: '보류 사유 확인 후 재상신 준비', assigneeRole: '마케팅', dueDate: c.deadline, detail: {}, dataOrigin: '가정' }]
    },
  }

  return { [CONTRACT_CASE_TYPE]: contract, [EXPANSION_CASE_TYPE]: expansion }
}

/** 화면에 보여 줄 보충 설명(마감과 하회 구간의 관계 등). 엔진 상태를 바꾸지 않는다. */
export function w02Notes(c: DecisionCase, ctx: W02Ctx): string[] {
  const notes: string[] = []
  const date = outflowDate(c)
  const wins = ctx.cashWindows
  if (c.caseType === EXPANSION_CASE_TYPE && wins && wins.length && c.deadline) {
    const first = wins[0]
    if (c.deadline < first.start) {
      notes.push(`확정기한(${c.deadline})이 하회 구간 시작(${first.start})보다 앞서 도래합니다 — 기한을 넘기면 자동 확정되어 철회할 수 없으므로 기한 전에 상신해야 합니다. (근거: covenant_terms_ms.md)`)
    }
  }
  if (date && wins) {
    const inside = dateInBreachWindow(wins, date)
    notes.push(`돈이 나가는 날 ${date}: ${inside ? '현금 하회 예상 구간 안' : '하회 구간 밖'}`)
  } else if (c.caseType === CONTRACT_CASE_TYPE) {
    notes.push('고정 피 지급 일정이 문서에 없어 현금 유출일을 알 수 없습니다(미확인).')
  }
  return notes
}
