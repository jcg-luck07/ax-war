// 현금 재전망 시험.  node --import ./scripts/_register.mjs scripts/test-cash.mjs
// 입력은 시맨틱 레이어(DB)에서 읽고, 기대값은 원본 CSV 파일에서 따로 계산해 대조한다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { parseCsv } from '../lib/ingest/core.ts'
import { DEFAULT_CASH_OPTIONS, simulateCash, simulateWithSensitivity, dateInBreachWindow } from '../lib/modules/cash/simulate.ts'
import { loadCashInputs } from '@/lib/modules/cash/service'

const base = resolve(import.meta.dirname, '../01_참가자_배포용/04_원본데이터')
const R = (p) => parseCsv(readFileSync(resolve(base, p), 'utf8'), p).rows
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} })
let n = 0
const t = (name, fn) => { fn(); n++; console.log('✔', name) }
const won = (v) => Math.round(v / 1e6) / 100 + '억'

try {
  const inp = await loadCashInputs(sql)
  const cashDaily = R('02_masil/financials/fin_cash_daily_ms.csv')
  const ap = R('02_masil/financials/fin_ap_aging_ms.csv')
  const po = R('02_masil/inventory/sc_purchase_orders_ms.csv')
  const sumVals = (o) => Object.values(o).reduce((s, v) => s + v, 0)

  t('실적 구간(자금일보)의 항등식 closing = opening + inflow − outflow 이 성립한다', () => {
    for (const r of cashDaily) {
      assert.ok(Math.abs(Number(r.opening_balance) + Number(r.inflow_krw) - Number(r.outflow_krw) - Number(r.closing_balance)) <= 1, r.date)
    }
  })
  t('시맨틱 입력이 원본과 같다: 시작 잔액, 회수·지급·발주 합계', () => {
    const last = cashDaily[cashDaily.length - 1]
    assert.equal(inp.openingDate, last.date); assert.equal(inp.openingBalance, Number(last.closing_balance))
    assert.ok(Math.abs(sumVals(inp.inflows) - R('02_masil/financials/fin_ar_aging_ms.csv').reduce((s, r) => s + Number(r.outstanding_krw), 0)) <= 1)
    assert.ok(Math.abs(sumVals(inp.payments) - ap.filter((r) => r.po_id === 'NONE').reduce((s, r) => s + Number(r.amount_krw), 0)) <= 1)
    assert.ok(Math.abs(sumVals(inp.poPayments) - po.reduce((s, r) => s + Number(r.amount_krw), 0)) <= 1)
    assert.equal(inp.unlinkedApTotal, 0)
  })

  const res = simulateCash(inp)
  t('시작 잔액 = as-of 직전 영업일(2026-06-30) 종가', () => { assert.equal(res.openingDate, '2026-06-30'); assert.equal(res.openingBalance, 5148063540) })
  t('영업일에만 판정한다 (주말 날짜가 days 에 없다)', () => { for (const d of res.days) { const w = new Date(d.date).getUTCDay(); assert.ok(w >= 1 && w <= 5, d.date) } })
  t('주말 입출금이 사라지지 않는다: 전체 흐름 합 = 마지막 잔액 − 시작 잔액', () => {
    const sum = res.days.reduce((s, d) => s + d.inflow - d.outflow, 0)
    assert.ok(Math.abs(res.days[res.days.length - 1].closing - (res.openingBalance + sum)) <= 1)
  })
  t('이중계상 방지: PO 연결 AP 를 지급에 다시 더하지 않는다 (AP 중 po_id=NONE 만)', () => {
    const noneOnly = ap.filter((r) => r.po_id === 'NONE').reduce((s, r) => s + Number(r.amount_krw), 0)
    const poSum = po.reduce((s, r) => s + Number(r.amount_krw), 0)
    assert.ok(Math.abs(res.days.reduce((s, d) => s + d.outflow, 0) - (noneOnly + poSum)) <= 1)
  })
  t('하회 구간이 존재하고 시작일·최저 잔액이 보고된다', () => {
    console.log(`   첫 하회 ${res.firstBreach} · 최저 ${won(res.minBalance)}(${res.minDate}) · 30억 대비 부족 ${won(res.shortfallAtMin)}`)
    console.log('   구간:', res.windows.map((w) => `${w.start}~${w.end}${w.openEnded ? '(기간 끝까지 회복 못 함)' : ''}`).join(', '))
    assert.equal(res.firstBreach, '2026-07-21'); assert.equal(res.minDate, '2026-07-27'); assert.ok(Math.abs(res.minBalance - 1_648_000_000) < 5_000_000)
  })
  t('날짜가 하회 구간 안인지 판정한다', () => { assert.equal(dateInBreachWindow(res.windows, res.firstBreach), true); assert.equal(dateInBreachWindow(res.windows, '2026-07-01'), false) })
  t('기안 요청액을 별도 줄로 넣으면 최저 잔액이 더 낮아진다(원본 포함분과 분리)', () => {
    const extras = R('02_masil/marketing/mkt_budget_plan_ms.csv').map((p) => ({ date: p.settlement_date, amount: Number(p.requested_budget_krw), label: p.plan_id }))
    const withPlans = simulateCash(inp, { ...DEFAULT_CASH_OPTIONS, extraOutflows: extras })
    console.log(`   기안 25건(합 ${won(extras.reduce((s, x) => s + x.amount, 0))}) 반영: 최저 ${won(res.minBalance)} → ${won(withPlans.minBalance)}`)
    assert.ok(withPlans.minBalance < res.minBalance); assert.equal(withPlans.firstBreach, res.firstBreach)
  })
  t('가정 민감도: 기한 지난 미수금을 회수 못 한다고 봐도 하회가 시작된다', () => {
    const s = simulateWithSensitivity(inp)
    console.log(`   (기본) ${s.base.firstBreach} / (보수적) ${s.alternative.firstBreach} · 최저 ${won(s.base.minBalance)} / ${won(s.alternative.minBalance)}`)
    assert.ok(s.base.firstBreach && s.alternative.firstBreach)
  })
  t('재무팀 공식 전망과 대조한다 (정답이 아니라 대조 대상)', () => {
    assert.ok(res.forecastComparison.length >= 10)
    const worst = res.forecastComparison.reduce((a, b) => (Math.abs(b.diff) > Math.abs(a.diff) ? b : a))
    console.log(`   공식 전망 대비 최대 차이: ${worst.week} 주 ${won(worst.diff)}`)
  })

  console.log(`\n${n}개 시험 모두 통과`)
} finally {
  await sql.end()
}
