// 성과 지표 시험.  node --import ./scripts/_register.mjs scripts/test-metrics.mjs
// 시맨틱 레이어로 계산한 값을, 앞서 별도 스크립트(파이썬)로 구해 둔 값과 대조한다.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { getPerformance } from '@/lib/metrics/service'
import { DEFAULT_ASSUMPTIONS } from '@/lib/metrics/performance'

const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} })
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

try {
  const r = await getPerformance(DEFAULT_ASSUMPTIONS, sql)
  const by = Object.fromEntries(r.byInfluencer.map((x) => [x.influencerId, x]))

  const expected = {
    'INF-001': { gmv: 422424676, refund: 55201015, spend: 309975627, cp: -61308789 },
    'INF-002': { gmv: 121676523, refund: 4451289, spend: 18270678, cp: 67656962 },
    'INF-005': { gmv: 222552519, refund: 26707867, spend: 168790989, cp: -36162212 },
    'INF-009': { gmv: 44097768, refund: 1020383, spend: 6742335, cp: 21923008 },
  }
  for (const [id, e] of Object.entries(expected)) {
    await t(`${id} 이전 계산값과 일치 (GMV·환불·광고비·공헌이익)`, () => {
      assert.ok(near(by[id].gmv, e.gmv)); assert.ok(near(by[id].refund, e.refund)); assert.ok(near(by[id].adSpend, e.spend))
      assert.ok(near(by[id].contributionProfit, e.cp), `cp ${by[id].contributionProfit} vs ${e.cp}`)
    })
  }
  await t('혜인: 광고비 비중 1위(40.6%)인데 실질 공헌이익은 적자·최하위', () => {
    assert.equal(by['INF-001'].rankBySpend, 1); assert.ok(Math.abs(by['INF-001'].spendShare - 0.406) < 0.001)
    assert.ok(by['INF-001'].contributionProfit < 0); assert.equal(by['INF-001'].rankByContribution, 10); assert.equal(by['INF-001'].rankByGmv, 1)
  })
  await t('초혜핏: 실질 공헌이익 1위, 광고비 비중은 3% 미만', () => { assert.equal(by['INF-002'].rankByContribution, 1); assert.ok(by['INF-002'].spendShare < 0.03) })
  await t('합계가 인플루언서 합과 같다(누락·중복 없음)', () => {
    const sum = (k) => r.byInfluencer.reduce((s, x) => s + x[k], 0)
    assert.ok(near(r.totals.gmv, sum('gmv'))); assert.ok(near(r.totals.contributionProfit, sum('contributionProfit'), 5))
    assert.ok(near(r.totals.contributionProfit, r.byCampaign.reduce((s, x) => s + x.contributionProfit, 0), 5))
  })
  await t('Net Revenue = GMV − 환불, 쿠폰은 다시 빼지 않는다', () => { for (const x of r.byInfluencer) assert.ok(near(x.netRevenue, x.gmv - x.refund)) })
  await t('자료 품질: 연결 안 되는 행이 없다고 보고한다', () => { assert.deepEqual(r.quality, { ordersMissingCost: 0, ordersWithoutCampaign: 0, returnsWithoutOrder: 0 }) })
  await t('배분-성과 정렬도: 약한 반대 방향(−0.33)', () => { assert.ok(Math.abs(r.alignment.spearman + 1 / 3) < 1e-6); assert.equal(r.alignment.direction, '반대 방향') })

  await t('가정: 주문당 적용 단위를 2로 올리면 혜인 공헌이익이 더 나빠진다', async () => {
    const h2 = (await getPerformance({ ...DEFAULT_ASSUMPTIONS, unitsPerOrder: 2 }, sql)).byInfluencer.find((x) => x.influencerId === 'INF-001')
    assert.ok(h2.contributionProfit < by['INF-001'].contributionProfit)
  })
  await t('가정: 환불 시 원가·수수료를 회수한다고 보면 공헌이익이 올라가지만 여전히 적자', async () => {
    const h3 = (await getPerformance({ ...DEFAULT_ASSUMPTIONS, recoverCostOnRefund: true, recoverChannelFeeOnRefund: true }, sql)).byInfluencer.find((x) => x.influencerId === 'INF-001')
    assert.ok(h3.contributionProfit > by['INF-001'].contributionProfit); assert.ok(h3.contributionProfit < 0)
  })
  await t('결론의 강건성: 가정 4가지를 바꿔도 혜인은 광고비 1위·공헌이익 최하위권', async () => {
    for (const v of [{ unitsPerOrder: 2 }, { recoverCostOnRefund: true, recoverChannelFeeOnRefund: true }, { returnLogisticsTimes: 2 }, { recoverCostOnRefund: true }]) {
      const x = (await getPerformance({ ...DEFAULT_ASSUMPTIONS, ...v }, sql)).byInfluencer.find((y) => y.influencerId === 'INF-001')
      assert.ok(x.rankByContribution >= 9 && x.rankBySpend === 1, JSON.stringify(v))
    }
  })

  console.log(`\n${n}개 시험 모두 통과`)
} finally {
  await sql.end()
}
