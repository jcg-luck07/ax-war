// 시맨틱 레이어 시험.  node --import ./scripts/_register.mjs scripts/test-semantic.mjs
// 핵심: SQL 로 번역·실행한 결과가, 따로 손으로 짠 기준 구현(scripts/reference/performance.ts)과 같은가.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { MASIL_MODEL } from '@/lib/semantic/model'
import { compileQuery, SemanticError } from '@/lib/semantic/compile'
import { runSemantic, entityRows } from '@/lib/semantic/run'
import { getPerformance } from '@/lib/metrics/service'
import { DEFAULT_ASSUMPTIONS } from '@/lib/metrics/performance'
import { computePerformance as reference } from './reference/performance.ts'

const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} })
const rows = async (file) => (await sql`select data from source_rows where source_file=${file} order by row_no`).map((r) => r.data)
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol

try {
  const inp = {
    orders: await rows('02_masil/marketing/mkt_orders_ms.csv'), returns: await rows('02_masil/marketing/mkt_returns_ms.csv'),
    adSpend: await rows('02_masil/marketing/mkt_ad_spend_ms.csv'), costMaster: await rows('02_masil/marketing/mkt_cost_master_ms.csv'),
    campaigns: await rows('02_masil/master/m_campaign_ms.csv'), influencers: await rows('02_masil/master/m_influencer_ms.csv'),
  }
  if (inp.orders.length === 0) throw new Error('원본이 적재되어 있지 않아요: node scripts/ingest.mjs')

  const scenarios = {
    '기본 가정': DEFAULT_ASSUMPTIONS,
    '주문당 2회': { ...DEFAULT_ASSUMPTIONS, unitsPerOrder: 2 },
    '환불 시 원가·수수료 회수': { ...DEFAULT_ASSUMPTIONS, recoverCostOnRefund: true, recoverChannelFeeOnRefund: true },
    '반품 물류비 2회': { ...DEFAULT_ASSUMPTIONS, returnLogisticsTimes: 2 },
  }
  for (const [name, a] of Object.entries(scenarios)) {
    await t(`기준 구현과 일치: ${name} (인플루언서 10명 × 14개 값, 캠페인 25개)`, async () => {
      const sem = await getPerformance(a, sql)
      const ref = reference(inp, a)
      assert.equal(sem.byInfluencer.length, ref.byInfluencer.length)
      for (const r of ref.byInfluencer) {
        const s = sem.byInfluencer.find((x) => x.influencerId === r.influencerId)
        assert.ok(s, r.influencerId)
        for (const k of ['orders', 'refundedOrders', 'gmv', 'refund', 'netRevenue', 'cogs', 'channelFee', 'shipping', 'returnLogistics', 'adSpend', 'contributionProfit']) {
          assert.ok(near(s[k], r[k]), `${r.influencerId} ${k}: 시맨틱 ${s[k]} vs 기준 ${r[k]}`)
        }
        assert.ok(near(s.realRoas, r.realRoas, 1e-9) && near(s.nominalRoas, r.nominalRoas, 1e-9) && near(s.returnRate, r.returnRate, 1e-9))
        assert.equal(s.rankByContribution, r.rankByContribution); assert.equal(s.rankBySpend, r.rankBySpend); assert.equal(s.rankByGmv, r.rankByGmv)
      }
      for (const r of ref.byCampaign) {
        const s = sem.byCampaign.find((x) => x.campaignId === r.campaignId)
        assert.ok(s && near(s.contributionProfit, r.contributionProfit) && near(s.gmv, r.gmv) && near(s.adSpend, r.adSpend), r.campaignId)
      }
      assert.ok(near(sem.totals.contributionProfit, ref.totals.contributionProfit, 2))
      assert.ok(near(sem.alignment.spearman, ref.alignment.spearman, 1e-9))
    })
  }

  await t('집계 단위가 달라도 행이 부풀지 않는다: 광고비(광고 집행 기준)와 GMV(주문 기준)를 한 번에 물어도 각각 맞다', async () => {
    const [r] = await runSemantic(sql, MASIL_MODEL, { select: ['gmv', 'ad_spend', 'orders'], by: 'influencer' }).then((x) => x.filter((y) => y.key === 'INF-001'))
    const gmv = inp.orders.filter((o) => inp.campaigns.find((c) => c.campaign_id === o.campaign_id)?.influencer_id === 'INF-001').reduce((s, o) => s + Number(o.gmv_krw), 0)
    const ad = inp.adSpend.filter((o) => inp.campaigns.find((c) => c.campaign_id === o.campaign_id)?.influencer_id === 'INF-001').reduce((s, o) => s + Number(o.ad_cost_krw), 0)
    assert.ok(near(r.values.gmv, gmv)); assert.ok(near(r.values.ad_spend, ad))
  })

  await t('현금 흐름: 시간 차원(payment_date)으로 회수·지급·발주를 날짜별로 묶는다', async () => {
    const res = await runSemantic(sql, MASIL_MODEL, { select: ['ar_outstanding', 'ap_operating', 'po_payment'], by: 'payment_date' })
    const ar = (await rows('02_masil/financials/fin_ar_aging_ms.csv')).reduce((s, r) => s + Number(r.outstanding_krw), 0)
    const po = (await rows('02_masil/inventory/sc_purchase_orders_ms.csv')).reduce((s, r) => s + Number(r.amount_krw), 0)
    const ap = (await rows('02_masil/financials/fin_ap_aging_ms.csv')).filter((r) => r.po_id === 'NONE').reduce((s, r) => s + Number(r.amount_krw), 0)
    const sum = (k) => res.reduce((s, r) => s + (r.values[k] ?? 0), 0)
    assert.ok(near(sum('ar_outstanding'), ar)); assert.ok(near(sum('po_payment'), po)); assert.ok(near(sum('ap_operating'), ap))
    assert.ok(res.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.key)))
  })

  await t('엔티티 행을 타입이 있는 값으로 꺼낸다 (숫자는 number, 날짜는 YYYY-MM-DD)', async () => {
    const plans = await entityRows(sql, MASIL_MODEL, 'budget_plan')
    assert.equal(plans.length, 25)
    assert.equal(typeof plans[0].requested_budget_krw, 'number'); assert.match(plans[0].settlement_date, /^\d{4}-\d{2}-\d{2}$/)
    const refund = await entityRows(sql, MASIL_MODEL, 'order_refund') // 집계 엔티티
    assert.ok(refund.length > 0 && typeof refund[0].refund_krw === 'number')
  })

  await t('자료 품질 측정값: 연결 안 되는 행을 숨기지 않고 센다', async () => {
    const [q] = await runSemantic(sql, MASIL_MODEL, { select: ['orders_missing_cost', 'orders_without_campaign', 'returns_without_order', 'ap_unlinked'] })
    assert.deepEqual(Object.values(q.values).map((v) => v ?? 0), [0, 0, 0, 0])
  })

  await t('잘못된 선언은 SQL 을 만들기 전에 막는다 (모르는 지표·차원·열·연결 불가)', () => {
    assert.throws(() => compileQuery(MASIL_MODEL, { select: ['없는지표'] }), SemanticError)
    assert.throws(() => compileQuery(MASIL_MODEL, { select: ['gmv'], by: '없는차원' }), SemanticError)
    assert.throws(() => compileQuery(MASIL_MODEL, { select: ['po_payment'], by: 'influencer' }), /이어지는 관계가 없어요/)
    const bad = structuredClone(MASIL_MODEL); bad.measures.gmv.expr = 'order.no_such_col'
    assert.throws(() => compileQuery(bad, { select: ['gmv'] }), /no_such_col/)
  })

  await t('지표 정의는 모델에 한 번만 있다: 실질 ROAS 는 실질 공헌이익을 쓰고, 공헌이익은 순수익을 쓴다(순환 없음)', () => {
    const sqlText = compileQuery(MASIL_MODEL, { select: ['real_roas'], by: 'influencer' }).text
    assert.ok(sqlText.includes('m_ad_spend') && sqlText.includes('m_cogs') && sqlText.includes('m_refund'))
  })

  console.log(`\n${n}개 시험 모두 통과`)
} finally {
  await sql.end()
}
