// 화면 표시용 서식·라벨 (순수 함수 · 서버/브라우저 어디서나 import 가능). 영어 상태값은 화면에 보이지 않는다.
import { CASE_TYPE_CATEGORY, caseTypeLabel } from './labels'

/** 금액: 줄이지 않고 1원 단위까지 모두 쓴다. 예: 2,800,000,000원 / −61,308,789원 */
export function fmtWon(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n < 0 ? '−' : ''}${Math.round(Math.abs(n)).toLocaleString('ko-KR')}원`
}

/** 비율 0.406 → 40.6% */
export function fmtPct(r: number | null | undefined, digits = 1): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—'
  return `${(r * 100).toFixed(digits)}%`
}

export function fmtRoas(r: number | null | undefined): string {
  return r === null || r === undefined || !Number.isFinite(r) ? '계산 불가' : `${r.toFixed(2)}배`
}

export type ChipColor = 'default' | 'accent' | 'success' | 'warning' | 'danger'

export const STATUS: Record<string, { label: string; color: ChipColor }> = {
  open: { label: '접수', color: 'default' },
  need_info: { label: '확인 필요', color: 'warning' },
  pending_approval: { label: '승인 대기', color: 'accent' },
  approved: { label: '승인됨', color: 'success' },
  rejected: { label: '부결', color: 'danger' },
  on_hold: { label: '보류', color: 'warning' },
  closed: { label: '완료', color: 'default' },
}
export const statusOf = (s: string) => STATUS[s] ?? { label: s, color: 'default' as ChipColor }

export const APPROVAL_STATUS: Record<string, { label: string; color: ChipColor }> = {
  pending: { label: '결정 대기', color: 'accent' },
  approved: { label: '승인', color: 'success' },
  rejected: { label: '부결', color: 'danger' },
  on_hold: { label: '보류', color: 'warning' },
  superseded: { label: '대체됨', color: 'default' },
}

export const TASK_STATUS: Record<string, { label: string; color: ChipColor }> = {
  open: { label: '진행 중', color: 'accent' },
  done: { label: '완료', color: 'success' },
  cancelled: { label: '취소', color: 'default' },
}

export const TASK_TYPE: Record<string, string> = {
  info_request: '확인 요청',
  document: '문서화',
  notify: '통보·알림',
  record: '기록 보관',
  review: '재검토',
  monitor: '모니터링',
  execute: '실행',
  report: '보고',
  prepare: '승인 준비',
}

// 안건 종류 이름은 lib/app/labels.ts 한 곳에서 온다 (안건 접수의 분류 이름과 같은 값)
export const CASE_TYPE: Record<string, string> = Object.fromEntries(
  Object.keys(CASE_TYPE_CATEGORY).map((t) => [t, caseTypeLabel(t)]),
)

export const ORIGIN: Record<string, { label: string; color: ChipColor }> = {
  원본: { label: '원본', color: 'success' },
  가정: { label: '가정', color: 'warning' },
  합성: { label: '합성', color: 'warning' },
  가상입력: { label: '가상 입력', color: 'accent' },
}

export const EVENT_LABEL: Record<string, string> = {
  created: '기안 접수',
  evaluated: '규칙으로 평가',
  approval_requested: '승인 요청 생성',
  approval_superseded: '승인 요청 대체',
  decided: '사람이 결정',
  status_changed: '상태 변경',
  task_created: '작업 생성',
  task_done: '작업 완료',
  facts_changed: '조건 변경',
  info_received: '확인 회신 도착',
  resubmitted: '재상신',
}

export const FACT_LABEL: Record<string, string> = {
  annual_contract_value_krw: '전속계약 연 고정 피',
  per_plan_amount_krw: '기안 한 건 요청액',
  draft_total_krw: '기안 요청 총액',
  creates_cash_outflow: '현금 유출이 생기는가',
  in_cash_breach_window: '돈 나가는 날이 현금 하회 구간 안인가',
  linked_to_group_300: '그룹 300억 사업과 연결되는가',
  settlement_date: '집행 예정일',
  fixed_fee_payment_date: '고정 피 지급일',
  payment_due_date: '대금 지급 예정일',
}

export function fmtFact(key: string, v: unknown): string {
  if (v === null || v === undefined) return '모름'
  if (typeof v === 'boolean') return v ? '예' : '아니오'
  if (typeof v === 'number' && key.endsWith('_krw')) return fmtWon(v)
  return String(v)
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** D-day 문구: 16일 남음 / 오늘 마감 / 3일 지남 */
export function ddayText(days: number | null): string {
  if (days === null) return '마감 없음'
  if (days === 0) return '오늘 마감'
  return days > 0 ? `${days}일 남음` : `${-days}일 지남`
}
