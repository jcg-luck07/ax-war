// Masil 현금 재전망 (순수 함수). 정의: 00_common/calculation_definitions.md 1.2, 02_masil/financials/covenant_terms_ms.md
//
//   Closing[t] = Opening[t] + 예상 회수 − 예상 지급 − 기타 유출
//   covenant 위반 = 영업일 종가 < 30억 (매 영업일 1회라도. 기간 평균이 아니다. stand-alone, 그룹 지원 제외)
//
// 소스(이중계상 금지)
//   회수  : fin_ar_aging_ms.outstanding_krw 를 due_date 에
//   지급  : fin_ap_aging_ms 중 po_id = 'NONE'(운영 매입채무)만 payment_due_date 에
//   기타  : sc_purchase_orders_ms.amount_krw 를 payment_due_date 에   ← AP 의 PO 연결분은 여기서만 빠진다
//   추가  : 새로 검토 중인 약정(예: 캠페인 기안)은 별도 줄(extraOutflows)로 분리 — 원본 전망 포함분과 섞지 않는다(A05)
//
// 주말에 잡힌 입출금은 사라지지 않고 다음 영업일 종가에 합산된다(달력일 누적, 영업일에만 판정).
// 다른 파일을 import 하지 않는다.

export type Row = Record<string, string>

export interface CashInputs {
  cashDaily: readonly Row[] // fin_cash_daily_ms (실적)
  ar: readonly Row[] // fin_ar_aging_ms
  ap: readonly Row[] // fin_ap_aging_ms
  po: readonly Row[] // sc_purchase_orders_ms
  forecast?: readonly Row[] // fin_cash_forecast_ms (재무팀 공식 전망 — 정답이 아니라 대조용)
}

export interface ExtraOutflow {
  date: string
  amount: number
  label: string
}

export interface CashOptions {
  asOf: string // '2026-07-01'
  horizonDays: number
  covenantMin: number
  /** as-of 보다 이른 due_date 의 미수금: 'asOf' = as-of 날 회수된다고 봄(덜 보수적) / 'exclude' = 회수 안 됨(보수적) */
  overdueCollections: 'asOf' | 'exclude'
  extraOutflows: readonly ExtraOutflow[]
}

export const DEFAULT_CASH_OPTIONS: CashOptions = {
  asOf: '2026-07-01',
  horizonDays: 120,
  covenantMin: 3_000_000_000,
  overdueCollections: 'asOf',
  extraOutflows: [],
}

export interface CashDay {
  date: string
  inflow: number // 직전 영업일 이후 누적(주말 포함)
  outflow: number
  closing: number
  breach: boolean
}

export interface BreachWindow {
  start: string
  end: string // 종가가 다시 30억 이상이 되기 전 마지막 영업일 (기간 끝까지 못 벗어나면 horizon 끝)
  minBalance: number
  minDate: string
  /** 전망 기간이 끝날 때까지 회복하지 못함 → 기간이 열려 있음(실제 끝은 이 자료로는 알 수 없다) */
  openEnded: boolean
}

export interface CashResult {
  options: CashOptions
  openingDate: string
  openingBalance: number
  days: CashDay[]
  windows: BreachWindow[]
  firstBreach: string | null
  minBalance: number
  minDate: string
  shortfallAtMin: number // 최저일 기준 30억 대비 부족액 (부족하지 않으면 0)
  issues: string[] // 자료 품질 문제 (조용히 넘기지 않는다)
  forecastComparison: { week: string; official: number; simulated: number; diff: number }[]
}

const num = (v: string | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const addDays = (d: string, n: number): string => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10)
const isBusinessDay = (d: string): boolean => {
  const w = new Date(Date.parse(d)).getUTCDay()
  return w !== 0 && w !== 6
}

export function simulateCash(inp: CashInputs, opt: CashOptions = DEFAULT_CASH_OPTIONS): CashResult {
  const issues: string[] = []
  if (inp.cashDaily.length === 0) throw new Error('자금일보(fin_cash_daily_ms)가 비어 있어요')
  const last = inp.cashDaily[inp.cashDaily.length - 1]
  const openingBalance = num(last.closing_balance)
  const openingDate = last.date

  // 날짜별 흐름표
  const inflow = new Map<string, number>()
  const outflow = new Map<string, number>()
  const add = (m: Map<string, number>, date: string, amt: number) => m.set(date, (m.get(date) ?? 0) + amt)
  const toAsOf = (d: string) => (d < opt.asOf ? opt.asOf : d)

  let excludedOverdue = 0
  for (const r of inp.ar) {
    const amt = num(r.outstanding_krw)
    if (amt <= 0) continue
    if (r.due_date < opt.asOf) {
      if (opt.overdueCollections === 'exclude') { excludedOverdue += amt; continue }
      add(inflow, opt.asOf, amt)
    } else add(inflow, r.due_date, amt)
  }
  if (excludedOverdue > 0) issues.push(`기한이 지난 미수금 ${excludedOverdue.toLocaleString()}원을 회수되지 않는 것으로 제외했어요(보수적 가정).`)

  const poIds = new Set(inp.po.map((p) => p.po_id))
  for (const r of inp.ap) {
    if (r.po_id === 'NONE') add(outflow, toAsOf(r.payment_due_date), num(r.amount_krw)) // 운영 매입채무만
    else if (!poIds.has(r.po_id)) {
      issues.push(`AP ${r.ap_id}: po_id ${r.po_id} 가 발주 목록에 없어 어느 쪽에도 반영되지 않았어요(이중계상 방지 규칙상 제외).`)
    }
  }
  for (const p of inp.po) add(outflow, toAsOf(p.payment_due_date), num(p.amount_krw))
  for (const x of opt.extraOutflows) add(outflow, toAsOf(x.date), x.amount)

  // 달력일로 누적하고 영업일에만 판정한다
  const days: CashDay[] = []
  let bal = openingBalance
  let pendIn = 0
  let pendOut = 0
  for (let i = 0; i < opt.horizonDays; i++) {
    const date = addDays(opt.asOf, i)
    const fi = inflow.get(date) ?? 0
    const fo = outflow.get(date) ?? 0
    bal += fi - fo
    pendIn += fi
    pendOut += fo
    if (isBusinessDay(date)) {
      days.push({ date, inflow: pendIn, outflow: pendOut, closing: bal, breach: bal < opt.covenantMin })
      pendIn = 0
      pendOut = 0
    }
  }

  // 하회 구간(연속된 영업일)
  const windows: BreachWindow[] = []
  let cur: BreachWindow | null = null
  for (const d of days) {
    if (d.breach) {
      if (!cur) cur = { start: d.date, end: d.date, minBalance: d.closing, minDate: d.date, openEnded: false }
      cur.end = d.date
      if (d.closing < cur.minBalance) { cur.minBalance = d.closing; cur.minDate = d.date }
    } else if (cur) { windows.push(cur); cur = null }
  }
  if (cur) {
    cur.openEnded = true
    cur.end = days[days.length - 1].date
    windows.push(cur)
  }

  let min = days[0]
  for (const d of days) if (d.closing < min.closing) min = d

  // 재무팀 공식 전망과 대조 (week = 그 주 월요일, 비교 시점 = 그 주 마지막 영업일 종가)
  const forecastComparison: CashResult['forecastComparison'] = []
  for (const f of inp.forecast ?? []) {
    const fri = addDays(f.week, 4)
    const sim = days.find((d) => d.date === fri)
    if (sim) forecastComparison.push({ week: f.week, official: num(f.projected_closing_krw), simulated: sim.closing, diff: sim.closing - num(f.projected_closing_krw) })
  }

  return {
    options: opt,
    openingDate,
    openingBalance,
    days,
    windows,
    firstBreach: windows.length ? windows[0].start : null,
    minBalance: min.closing,
    minDate: min.date,
    shortfallAtMin: Math.max(0, opt.covenantMin - min.closing),
    issues,
    forecastComparison,
  }
}

/** 날짜가 하회 구간 안(달력일 기준 start~end, 주말 포함)에 있는가 */
export function dateInBreachWindow(windows: readonly BreachWindow[], date: string): boolean {
  return windows.some((w) => date >= w.start && date <= w.end)
}

/** 결론이 가정에 민감한지 보려고 두 가지 가정으로 모두 돌린다 */
export function simulateWithSensitivity(inp: CashInputs, opt: CashOptions = DEFAULT_CASH_OPTIONS) {
  const base = simulateCash(inp, opt)
  const conservative = simulateCash(inp, { ...opt, overdueCollections: opt.overdueCollections === 'asOf' ? 'exclude' : 'asOf' })
  return {
    base,
    alternative: conservative,
    sameFirstBreach: base.firstBreach === conservative.firstBreach,
  }
}
