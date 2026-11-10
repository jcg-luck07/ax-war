// 두 번째 업무 예 (W01 캠페인 수요와 공급 일정 중 '재고 발주 승인') — 엔진은 그대로, 규칙(authority.rules.ts)과 이 handler 만 추가.
// ⚠️ 범용성을 보이기 위한 최소 구현이다. W01 전체(수요 예측, 입고 일정 연결 등)를 구현한 것이 아니다.
//    시연 안건은 가상 입력이며 실제 발주 데이터가 아니다.
import type { CaseHandler } from '../../engine/engine'
import { dateInBreachWindow, type BreachWindow } from '../cash/simulate'

export const PO_CASE_TYPE = 'w01.purchase_order'

export const w01Handlers: Record<string, CaseHandler> = {
  [PO_CASE_TYPE]: {
    caseType: PO_CASE_TYPE,
    deriveFacts: (c, ctx) => {
      const wins = (ctx as { cashWindows?: BreachWindow[] | null }).cashWindows
      const date = ((c.payload.facts ?? {}) as Record<string, unknown>).payment_due_date as string | undefined
      return { in_cash_breach_window: date && wins ? dateInBreachWindow(wins, date) : null }
    },
    describeFact: (fact) =>
      fact === 'in_cash_breach_window'
        ? {
            title: '발주 대금 지급 예정일 확인',
            assigneeRole: '재무',
            question: '이 발주의 대금 지급 예정일을 알려 주세요.',
            answerFields: [{ name: 'payment_due_date', type: 'date', label: '대금 지급 예정일' }],
          }
        : undefined,
    onDecision: (c, outcome) =>
      outcome === 'approved'
        ? [
            { key: 'place-order', taskType: 'execute', title: '공급자(Corevia)에 발주 전달 (모의)', assigneeRole: 'SCM', dueDate: null, detail: {}, dataOrigin: '가상입력' },
            { key: 'finance-cash-line', taskType: 'notify', title: '재무: 발주 대금을 현금 재전망 지급 줄에 반영', assigneeRole: '재무', dueDate: null, detail: {}, dataOrigin: '가상입력' },
          ]
        : outcome === 'rejected'
          ? [{ key: 'revise-order', taskType: 'review', title: '발주 수량·시기 재검토', assigneeRole: 'SCM', dueDate: null, detail: {}, dataOrigin: '가상입력' }]
          : [],
  },
}
