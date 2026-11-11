// 안건 목록의 "상태": 지금 누가(어느 부서·승인권자) 무엇을 해야 하는지. 업무 흐름 상태에서 계산한다 (순수 함수).
// 필터에서 고르는 상태는 아래 7가지뿐이고, 목록 칸에는 그 뒤에 구체적인 담당·할 일을 덧붙인다.
//   재무팀 검토 필요 / 계약 담당 확인 필요 / 승인 필요 · CEO/이사회 / 후속 작업 · 계약 담당 승인조건 문서화 / 재검토 / 보류 / 완료
import type { FlowDef } from './types'
import type { FlowState } from './state'

/** 필터에 나오는 상태 7가지 (진행 순서) */
export const STATES = [
  { base: '재무팀 검토 필요', stage: 1 },
  { base: '계약 담당 확인 필요', stage: 2 },
  { base: '승인 필요', stage: 3 },
  { base: '후속 작업', stage: 4 },
  { base: '재검토', stage: 5 },
  { base: '보류', stage: 6 },
  { base: '완료', stage: 7 },
] as const

export interface StateText {
  /** 목록에 보이는 글자 (예: "승인 필요 · CEO/이사회") */
  text: string
  /** 정렬용 단계 번호 — 작을수록 앞 단계 */
  stage: number
  /** 7가지 중 하나 — 필터가 이 값으로 거른다 */
  base: string
}

const LANE_NAME: Record<string, string> = { marketing: '마케팅', finance: '재무팀', contract: '계약 담당' }
const stageOf = (base: string) => STATES.find((s) => s.base === base)?.stage ?? 8

export function stateText(def: FlowDef | undefined, st: FlowState | null, caseStatus: string, approverLabel: string): StateText {
  const mk = (base: string, detail = '', more = ''): StateText => ({ text: `${base}${detail ? ` · ${detail}` : ''}${more}`, base, stage: stageOf(base) })
  if (!def || !st) return mk(caseStatus === 'closed' ? '완료' : '재무팀 검토 필요')
  const cur = st.current[0]
  if (cur) {
    const more = st.current.length > 1 ? ` 외 ${st.current.length - 1}` : ''
    const b = cur.bind
    if (b.t === 'prep') return mk(b.key === 'confirm-terms' ? '계약 담당 확인 필요' : '재무팀 검토 필요', '', more)
    if (b.t === 'decision') return mk('승인 필요', approverLabel, more)
    const who = LANE_NAME[cur.lane] ?? (cur.lane === 'approver' ? approverLabel : cur.lane)
    // 결정 뒤 후속 작업: 승인 → 후속 작업, 부결 → 재검토, 보류 → 보류
    const base = b.t === 'task' ? (b.branch === 'approved' ? '후속 작업' : b.branch === 'rejected' ? '재검토' : '보류') : '후속 작업'
    return mk(base, `${who} ${cur.label}`, more)
  }
  if (caseStatus === 'rejected' || st.outcome === 'rejected') return mk('완료', '부결')
  if (caseStatus === 'on_hold' || st.outcome === 'on_hold') return mk('보류')
  if (caseStatus === 'need_info') return mk('재무팀 검토 필요')
  return mk('완료')
}

/** 필터에서 고를 수 있는 상태 — 지금 해당하는 안건이 없어도 고를 수 있다 */
export const allStateTexts = () => STATES.map((s) => ({ base: s.base, stage: s.stage }))
