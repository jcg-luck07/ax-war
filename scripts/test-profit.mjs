// 수익성 검증(비교표)과 AI 판단 입력의 시험.  node --import ./scripts/_register.mjs scripts/test-profit.mjs
// DB 를 쓰지 않는 순수 함수 시험이다.
import assert from 'node:assert/strict'
import { buildProfitability, buildShareCompare, aggregate, metricsOf } from '@/lib/modules/w02/profitability'
import { buildJudgmentInput, distributionOf } from '@/lib/modules/w02/judgment-input'
import { JUDGMENT_PROMPT } from '@/lib/modules/w02/ai-prompt'

let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }

// 성과 한 줄 (공헌이익 cp, 순매출 net, 광고비 spend, GMV gmv, 환불 refund)
const L = (cp, net, spend, gmv, refund) => ({
  orders: 10, refundedOrders: 1, gmv, refund, netRevenue: net, cogs: 0, channelFee: 0, shipping: 0, returnLogistics: 0,
  adSpend: spend, contributionProfit: cp, nominalRoas: gmv / spend, realRoas: cp / spend, returnRate: refund / gmv,
})
const inf = (id, name, line) => ({ ...line, influencerId: id, influencerName: name, tier: '대형', spendShare: 0, rankByGmv: 1, rankBySpend: 1, rankByContribution: 1 })
const camp = (id, name, influencerId, line) => ({ ...line, campaignId: id, campaignName: name, influencerId })

const influencers = [
  { id: 'INF-001', name: '혜인', feeType: '고정+성과' },
  { id: 'INF-002', name: '초혜핏', feeType: '성과' },
  { id: 'INF-003', name: '토모카', feeType: '고정' },
  { id: 'INF-004', name: '유키', feeType: '고정' },
]
const campaigns = [
  { id: 'CMP-1', name: '혜인 색조 1', influencerId: 'INF-001', productLine: '색조' },
  { id: 'CMP-2', name: '혜인 기초 2', influencerId: 'INF-001', productLine: '기초' },
  { id: 'CMP-3', name: '초혜핏 기초 1', influencerId: 'INF-002', productLine: '기초' },
  { id: 'CMP-4', name: '토모카 기초 1', influencerId: 'INF-003', productLine: '기초' },
  { id: 'CMP-5', name: '유키 색조 1', influencerId: 'INF-004', productLine: '색조' },
]
const perf = {
  byInfluencer: [
    inf('INF-001', '혜인', L(-60_000_000, 300_000_000, 150_000_000, 400_000_000, 40_000_000)),
    inf('INF-002', '초혜핏', L(30_000_000, 200_000_000, 60_000_000, 260_000_000, 20_000_000)),
    inf('INF-003', '토모카', L(40_000_000, 250_000_000, 70_000_000, 330_000_000, 25_000_000)),
    inf('INF-004', '유키', L(20_000_000, 150_000_000, 50_000_000, 200_000_000, 15_000_000)),
  ],
  byCampaign: [
    camp('CMP-1', '혜인 색조 1', 'INF-001', L(-30_000_000, 150_000_000, 80_000_000, 200_000_000, 20_000_000)),
    camp('CMP-2', '혜인 기초 2', 'INF-001', L(-30_000_000, 150_000_000, 70_000_000, 200_000_000, 20_000_000)),
    camp('CMP-3', '초혜핏 기초 1', 'INF-002', L(30_000_000, 200_000_000, 60_000_000, 260_000_000, 20_000_000)),
    camp('CMP-4', '토모카 기초 1', 'INF-003', L(40_000_000, 250_000_000, 70_000_000, 330_000_000, 25_000_000)),
    camp('CMP-5', '유키 색조 1', 'INF-004', L(20_000_000, 150_000_000, 50_000_000, 200_000_000, 15_000_000)),
  ],
}
const base = { perf, campaigns, influencers }

try {
  await t('지표: 공헌이익률(÷순매출) · POAS(공헌이익÷광고비) · 명목 ROAS(GMV÷광고비) · 반품률을 정의대로 계산한다', () => {
    const m = metricsOf(L(30_000_000, 200_000_000, 60_000_000, 260_000_000, 20_000_000))
    assert.equal(m.cp, 30_000_000); assert.equal(m.cpRate, 0.15); assert.equal(m.poas, 0.5); assert.ok(Math.abs(m.roas - 260 / 60) < 1e-9); assert.ok(Math.abs(m.returnRate - 20 / 260) < 1e-9)
  })
  await t('평균: 금액은 대상 1건당 평균, 비율은 합계끼리 나눈다', () => {
    const a = aggregate([L(10, 100, 50, 150, 15), L(30, 300, 50, 350, 35)])
    assert.equal(a.cp, 20); assert.equal(a.cpRate, 40 / 400); assert.equal(a.poas, 40 / 100); assert.equal(a.returnRate, 50 / 500)
    assert.equal(aggregate([]), null)
  })

  await t('인플루언서 계약: 다른 인플루언서와 비교 — 평균·최고·최저와 순위, 보수 구조 분포', () => {
    const d = buildProfitability({ ...base, kind: 'influencer', influencerId: 'INF-001' })
    assert.equal(d.basis, '기존 실적'); assert.deepEqual(d.columns.map((c) => c.label.split(' (')[0]), ['이 인플루언서', '다른 인플루언서 평균', '최고', '최저'])
    assert.equal(d.rank.cp, 4); assert.equal(d.rank.n, 4); assert.equal(d.percentile, 0)
    assert.match(d.columns[2].label, /토모카/); assert.match(d.columns[3].label, /유키/); assert.match(d.columns[2].sub, /공헌이익 기준/)
    assert.deepEqual(d.feeMix, { fixed: 2, perf: 1, mixed: 0 }) // 비교 대상(자기 제외): 고정 2 · 성과 1
    assert.equal(d.subjectFeeType, '고정+성과')
  })

  await t('캠페인: ① 같은 인플루언서의 다른 캠페인 ② 이 안건을 뺀 전체 ③ 같은 종류의 다른 인플루언서 — 자기 자신은 모두에서 뺀다', () => {
    const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-2' })
    const g = Object.fromEntries(d.groups.map((x) => [x.key, x]))
    assert.equal(g.sameInfluencer.n, 1) // CMP-1 만
    assert.equal(g.all.n, 4) // 자기(CMP-2) 제외 전체
    assert.equal(g.sameType.n, 2) // 기초 중 다른 인플루언서: CMP-3, CMP-4
    assert.equal(d.columns.length, 4); assert.equal(d.rank.n, 5)
  })

  await t('표의 지표별 순위: 대상을 비교 모집단에 끼워 넣어 지표마다 센다', () => {
    const d = buildProfitability({ ...base, kind: 'influencer', influencerId: 'INF-001' })
    assert.equal(d.ranks.n, 4); assert.equal(d.ranks.cp, 4); assert.equal(d.ranks.roas > 0, true)
  })

  await t('요청 비중 vs 집행 비중: 금액이 아니라 비중으로 비교하고, 요청 비중 상위가 실질 하위인 인플루언서를 찾는다', () => {
    // 요청: 혜인(꼴찌 실적) 60%, 유키 20%, 초혜핏 10%, 토모카 10%
    const requests = [{ influencerId: 'INF-001', amount: 60 }, { influencerId: 'INF-004', amount: 20 }, { influencerId: 'INF-002', amount: 10 }, { influencerId: 'INF-003', amount: 10 }]
    const rich = { byInfluencer: perf.byInfluencer.map((x, i) => ({ ...x, spendShare: 0.25, rankByContribution: [4, 1, 2, 3][i] })), byCampaign: perf.byCampaign }
    const sc = buildShareCompare({ requests, perf: rich, subjectInfluencerId: 'INF-001' })
    assert.equal(sc.rows[0].influencerId, 'INF-001'); assert.ok(Math.abs(sc.rows[0].requestShare - 0.6) < 1e-9)
    assert.ok(sc.invertedTop.includes('혜인')); assert.ok(sc.correlation < 0)
    assert.equal(buildShareCompare({ requests: [], perf: rich, subjectInfluencerId: 'INF-001' }), null)
  })

  await t('AI 입력: 화면에 쓴 계산값을 한 덩어리로 모은다 — 회사 전체 목록·분포·배분·계약 방식, 대상은 isSubject 로 표시', () => {
    const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-2' })
    const input = buildJudgmentInput({ profitability: d, perf, subject: { influencerId: 'INF-001', campaignId: 'CMP-2' }, allocation: null, fees: { feeType: '고정+성과', fixedFeeKrw: 100, hasPerfFee: true } })
    assert.equal(input.company.campaigns.rows.length, 5); assert.equal(input.company.campaigns.rows.filter((r) => r.isSubject).length, 1)
    assert.equal(input.company.campaigns.dist.contributionProfit.negative, 2); assert.equal(input.fees.performanceRateUnknown, true)
    assert.ok(Array.isArray(JSON.parse(JSON.stringify(input)).company.influencers.rows)) // JSON 으로 그대로 보낼 수 있다
    assert.equal(distributionOf([1, 2, 3, 4, 5]).median, 3); assert.equal(distributionOf([]), null)
    assert.match(JUDGMENT_PROMPT, /절대 수익성/)
  })

  await t('수정 보고: 바뀐 금액으로 다시 만든 수익성 값과 수정 이력이 AI 입력에 들어가 입력(해시)이 달라진다 — 수정 보고가 없으면 입력에 금액 칸이 없다', async () => {
    const { hashJudgmentInput } = await import('@/lib/modules/w02/ai-store')
    const mk = (spend, amount) => {
      const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-2', estimate: { cp: 1000 - spend, netRevenue: 2000, gmv: 2200, spend, refund: 200 } })
      return buildJudgmentInput({ profitability: d, perf, subject: { influencerId: 'INF-001', campaignId: 'CMP-2' }, allocation: null, amount, fees: {} })
    }
    const before = mk(500, null), none = mk(500, { currentKrw: 500, originalKrw: 500, revisions: [] })
    assert.equal('amount' in before.caseInfo, false); assert.equal(hashJudgmentInput(before), hashJudgmentInput(none), '수정 보고가 없으면 입력이 그대로다 (저장된 판단을 계속 쓴다)')
    const after = mk(400, { currentKrw: 400, originalKrw: 500, revisions: [{ no: 1, fromKrw: 500, toKrw: 400, pct: -0.2, reason: '라이브 1회 축소' }] })
    assert.equal(after.caseInfo.amount.currentKrw, 400); assert.notEqual(hashJudgmentInput(before), hashJudgmentInput(after))
    assert.match(JUDGMENT_PROMPT, /caseInfo\.amount/)
  })
  await t('빈 칸은 0원이 아니라 "계산 불가": 비어 있는 칸이 있으면 공헌이익을 계산하지 않고, 비교·AI 판단에서 빼며, 무엇이 비었는지 알려 준다', async () => {
    const { calcContributionIfComplete, missingContribution } = await import('@/lib/metrics/contribution-calc')
    const { contributionFromInput } = await import('@/lib/modules/intake/submissions')
    const part = contributionFromInput({ returnLogistics: '52500', requested: '5500000', gmv: '' })
    assert.equal(part.gmv, null); assert.equal(part.cogs, null); assert.equal(part.returnLogistics, 52_500); assert.equal(part.marketingSpend, 5_500_000)
    assert.equal(calcContributionIfComplete(part), null); assert.deepEqual(missingContribution(part).slice(0, 2), ['예상 GMV', '예상 반품 환불액'])
    const zero = contributionFromInput({ gmv: '0', refund: '0', cogs: '0', channelFee: '0', shipping: '0', returnLogistics: '0', requested: '100' })
    assert.equal(calcContributionIfComplete(zero).contributionProfit, -100, '0 원으로 적은 칸은 진짜 0 원이라 계산한다')
    // 기존 실적이 없는 대상: 제출 추계서가 비어 있어 계산 못 하면 "자료 누락" — AI 에게 묻지 않고 보완 요청으로 이어진다
    const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-9', campaignId: 'CMP-NEW', estimate: null, estimateMissing: ['예상 GMV', '제품 원가'] })
    assert.equal(d.basis, null); assert.equal(d.missing.length, 1); assert.match(d.missing[0], /예상 GMV, 제품 원가/)
    // 기존 실적이 있는 대상: 실적 값은 그대로 쓰고, 제출 추정 값은 쓰지 않으며, 빠진 칸을 알려 준다
    const e = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-2', estimate: null, estimateMissing: ['예상 GMV'] })
    assert.equal(e.basis, '기존 실적'); assert.deepEqual(e.estimateMissing, ['예상 GMV']); assert.equal(e.missing.length, 0)
  })

  await t('자료 누락: 기존 실적도 제출 추계서도 없으면 누락 사유를 돌려준다 (이때는 AI 에게 묻지 않는다)', () => {
    const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-NEW' })
    assert.equal(d.basis, null); assert.ok(d.missing.length > 0)
  })

  await t('제출 추정: 기존 실적이 없어도 제출 추계서가 있으면 그 값으로 비교하고', () => {
    const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-NEW', estimate: { cp: 20_000_000, netRevenue: 100_000_000, gmv: 120_000_000, spend: 40_000_000, refund: 20_000_000 } })
    assert.equal(d.basis, '제출 추정'); assert.equal(d.missing.length, 0)
  })

  console.log(`\n${n}개 시험 모두 통과`)
} catch (e) {
  console.error(e)
  process.exit(1)
}
