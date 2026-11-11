// 안건 목록의 "상태" 글자: 지금 누가(어느 부서·승인권자) 무엇을 해야 하는지. 업무 흐름 상태에서 계산한다 (순수 함수).
// 예: 재무팀 검토 / 계약 담당 확인 / CEO/이사회 승인 필요 / Masil 대표 승인 필요 / 후속 작업 …
import type { FlowDef } from './types'
import type { FlowState } from './state'

export interface StateText {
  /** 화면에 보이는 상태 (예: "재무팀 검토") */
  text: string
  /** 정렬용 단계 번호 — 작을수록 앞 단계 */
  stage: number
}

const LANE_NAME: Record<string, string> = { marketing: '마케팅', finance: '재무팀', contract: '계약 담당' }

export function stateText(def: FlowDef | undefined, st: FlowState | null, caseStatus: string, approverLabel: string): StateText {
  if (!def || !st) return { text: caseStatus === 'closed' ? '완료' : '진행 중', stage: 9 }
  const cur = st.current[0]
  if (cur) {
    const more = st.current.length > 1 ? ` 외 ${st.current.length - 1}` : ''
    const b = cur.bind
    if (b.t === 'prep') return { text: `${b.key === 'collect-performance' ? '재무팀 검토' : b.key === 'confirm-terms' ? '계약 담당 확인' : `${LANE_NAME[cur.lane] ?? cur.lane} ${cur.label}`}${more}`, stage: b.key === 'confirm-terms' ? 2 : 1 }
    if (b.t === 'decision') return { text: `${approverLabel} 승인 필요${more}`, stage: 3 }
    return { text: `${LANE_NAME[cur.lane] ?? (cur.lane === 'approver' ? approverLabel : cur.lane)} ${cur.label}${more}`, stage: 4 }
  }
  if (caseStatus === 'rejected' || st.outcome === 'rejected') return { text: '부결 (재검토 종료)', stage: 6 }
  if (caseStatus === 'on_hold' || st.outcome === 'on_hold') return { text: '보류', stage: 7 }
  if (caseStatus === 'need_info') return { text: '확인 필요', stage: 1 }
  if (caseStatus === 'closed' || caseStatus === 'approved') return { text: '완료', stage: 5 }
  return { text: '진행 중', stage: 8 }
}
