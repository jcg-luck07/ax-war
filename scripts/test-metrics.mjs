// 성과 지표 시험.  node scripts/test-metrics.mjs
// CSV 를 파일에서 직접 읽어(DB 없이) 계산하고, 앞서 별도 스크립트로 계산해 둔 값과 대조한다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCsv } from '../lib/ingest/core.ts'
import { computePerformance, DEFAULT_ASSUMPTIONS } from '../lib/metrics/performance.ts'

const base = resolve(import.meta.dirname, '../01_참가자_배포용/04_원본데이터')
const rows = (p) => parseCsv(readFileSync(resolve(base, p), 'utf8'), p).rows
const inp = {
  orders: rows('02_masil/marketing/mkt_orders_ms.csv'),
  returns: rows('02_masil/marketing/mkt_returns_ms.csv'),
  adSpend: rows('02_masil/marketing/mkt_ad_spend_ms.csv'),
  costMaster: rows('02_masil/marketing/mkt_cost_master_ms.csv'),
  campaigns: rows('02_masil/master/m_campaign_ms.csv'),
  influencers: rows('02_masil/master/m_influencer_ms.csv'),
}
let n = 0
const t = (name, fn) => { fn(); n++; console.log('✔', name) }
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

const r = computePerformance(inp)
const by = Object.fromEntries(r.byInfluencer.map((x) => [x.influencerId, x]))

// 앞서 별도 계산(파이썬)으로 구한 값 — 같은 정의·같은 가정이면 같아야 한다.
const expected = {
  'INF-001': { gmv: 422424676, refund: 55201015, spend: 309975627, cp: -61308789 },
  'INF-002': { gmv: 121676523, refund: 4451289, spend: 18270678, cp: 67656962 },
  'INF-005': { gmv: 222552519, refund: 26707867, spend: 168790989, cp: -36162212 },
  'INF-009': { gmv: 44097768, refund: 1020383, spend: 6742335, cp: 21923008 },
}
for (const [id, e] of Object.entries(expected)) {
  t(`${id} 이전 계산값과 일치 (GMV·환불·광고비·공헌이익)`, () => {
    assert.ok(near(by[id].gmv, e.gmv), `gmv ${by[id].gmv} vs ${e.gmv}`)
    assert.ok(near(by[id].refund, e.refund), `refund ${by[id].refund} vs ${e.refund}`)
    assert.ok(near(by[id].adSpend, e.spend), `spend ${by[id].adSpend} vs ${e.spend}`)
    assert.ok(near(by[id].contributionProfit, e.cp), `cp ${by[id].contributionProfit} vs ${e.cp}`)
  })
}

t('혜인: 광고비 비중 1위(40.6%)인데 실질 공헌이익은 적자·하위권', () => {
  assert.equal(by['INF-001'].rankBySpend, 1)
  assert.ok(Math.abs(by['INF-001'].spendShare - 0.406) < 0.001)
  assert.ok(by['INF-001'].contributionProfit < 0)
  assert.ok(by['INF-001'].rankByContribution >= 9)
  assert.equal(by['INF-001'].rankByGmv, 1)
})
t('초혜핏: 실질 공헌이익 1위, 광고비 비중은 3% 미만', () => {
  assert.equal(by['INF-002'].rankByContribution, 1)
  assert.ok(by['INF-002'].spendShare < 0.03)
})
t('합계가 인플루언서 합과 같다(누락·중복 없음)', () => {
  const sum = (k) => r.byInfluencer.reduce((s, x) => s + x[k], 0)
  assert.ok(near(r.totals.gmv, sum('gmv'))); assert.ok(near(r.totals.contributionProfit, sum('contributionProfit')))
  const camp = r.byCampaign.reduce((s, x) => s + x.contributionProfit, 0)
  assert.ok(near(r.totals.contributionProfit, camp, 5), '캠페인 합 ≠ 전체')
})
t('Net Revenue = GMV − 환불, 쿠폰은 다시 빼지 않는다', () => {
  for (const x of r.byInfluencer) assert.ok(near(x.netRevenue, x.gmv - x.refund))
})
t('분모(광고비)가 0 이면 ROAS 는 null', () => {
  const z = computePerformance({ ...inp, adSpend: [] })
  assert.ok(z.byInfluencer.every((x) => x.nominalRoas === null && x.realRoas === null))
})
t('데이터 품질: 비용 마스터 누락·연결 안 되는 주문 수를 보고한다', () => {
  console.log('   품질:', JSON.stringify(r.quality))
  assert.equal(r.quality.ordersMissingCost, 0)
})
t('배분-성과 정렬도: 반대 방향으로 판정', () => {
  console.log(`   스피어만 ${r.alignment.spearman?.toFixed(2)} → ${r.alignment.direction}`)
  assert.equal(r.alignment.direction, '반대 방향')
})

// ── 가정을 바꾸면 결과가 바뀌어야 한다 (프로그램에서 가정을 바꿔 다시 계산할 수 있다는 약속) ──
t('가정: 주문당 적용 단위를 2로 올리면 혜인 공헌이익이 더 나빠진다', () => {
  const r2 = computePerformance(inp, { ...DEFAULT_ASSUMPTIONS, unitsPerOrder: 2 })
  const h2 = r2.byInfluencer.find((x) => x.influencerId === 'INF-001')
  assert.ok(h2.contributionProfit < by['INF-001'].contributionProfit)
  console.log(`   혜인 공헌이익 ${Math.round(by['INF-001'].contributionProfit).toLocaleString()} → ${Math.round(h2.contributionProfit).toLocaleString()}`)
})
t('가정: 환불 시 원가를 회수한다고 보면 공헌이익이 올라간다', () => {
  const r3 = computePerformance(inp, { ...DEFAULT_ASSUMPTIONS, recoverCostOnRefund: true, recoverChannelFeeOnRefund: true })
  const h3 = r3.byInfluencer.find((x) => x.influencerId === 'INF-001')
  assert.ok(h3.contributionProfit > by['INF-001'].contributionProfit)
  console.log(`   혜인 공헌이익(회수 가정) ${Math.round(h3.contributionProfit).toLocaleString()} — 여전히 ${h3.contributionProfit < 0 ? '적자' : '흑자'}`)
})
t('결론의 강건성: 가정을 바꿔도 혜인은 광고비 1위·공헌이익 하위권인가', () => {
  const variants = [
    { ...DEFAULT_ASSUMPTIONS, unitsPerOrder: 2 },
    { ...DEFAULT_ASSUMPTIONS, recoverCostOnRefund: true, recoverChannelFeeOnRefund: true },
    { ...DEFAULT_ASSUMPTIONS, returnLogisticsTimes: 2 },
    { ...DEFAULT_ASSUMPTIONS, unitsPerOrder: 1, recoverCostOnRefund: true },
  ]
  for (const v of variants) {
    const x = computePerformance(inp, v).byInfluencer.find((y) => y.influencerId === 'INF-001')
    console.log(`   ${JSON.stringify(v)} → 혜인 공헌이익 순위 ${x.rankByContribution}위, 실질 ROAS ${x.realRoas?.toFixed(2)}`)
    assert.ok(x.rankByContribution >= 8)
  }
})

console.log(`\n${n}개 시험 모두 통과`)
