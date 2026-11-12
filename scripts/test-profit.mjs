// 수익성 검증(비교표)과 AI 판단(시험용 규칙)의 시험.  node --import ./scripts/_register.mjs scripts/test-profit.mjs
// DB 를 쓰지 않는 순수 함수 시험이다.
import assert from 'node:assert/strict'
import { buildProfitability, buildShareCompare, aggregate, metricsOf } from '@/lib/modules/w02/profitability'
import { mockJudge, judge } from '@/lib/modules/w02/ai-judgment'
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

  await t('AI 판단: 3~5줄, "좋음 n점"(0~100)·"나쁨 -n점"(0~-100)·"주의할 점" 머리말, 공헌이익·POAS·공헌이익률의 뜻을 풀어 근거로 적는다', () => {
    const d = buildProfitability({ ...base, kind: 'influencer', influencerId: 'INF-001' })
    const j = mockJudge(d, { fixedFeeKrw: 2_800_000_000, performanceRateUnknown: true })
    assert.equal(j.status, 'ok'); assert.ok(j.lines.length >= 3 && j.lines.length <= 5)
    for (const l of j.lines) {
      assert.match(l.label, /^(좋음 \d{1,3}점|나쁨 -\d{1,3}점|주의할 점)$/)
      const m = l.label.match(/(-?\d+)점/); if (m) assert.ok(Math.abs(Number(m[1])) <= 100 && (l.tone === 'bad' ? Number(m[1]) <= 0 : Number(m[1]) >= 0))
    }
    const first = j.lines[0].text
    assert.match(first, /실질 공헌이익/); assert.match(first, /POAS/); assert.match(first, /공헌이익률/)
    assert.equal(j.lines[0].tone, 'bad') // 4명 중 꼴찌, 손실
    assert.ok(j.lines.some((l) => l.tone === 'caution' && /고정 피/.test(l.text)), '고정 피가 공헌이익에 빠져 있다는 한계를 판단에 넣는다')
  })

  await t('AI 판단: 보수 구조가 섞인 비교(고정 피 vs 성과 피)는 같은 잣대가 아니라고 알린다', () => {
    const d = buildProfitability({ ...base, kind: 'influencer', influencerId: 'INF-003' })
    const j = mockJudge(d, {})
    assert.ok(j.lines.some((l) => /섞여/.test(l.text)))
  })

  await t('AI 판단: 비교 대상과 수치가 비슷하면 그 비교는 적지 않는다 (수치 남발 금지)', () => {
    // 대상과 거의 같은 캠페인만 있는 경우
    const same = { ...perf, byCampaign: [camp('CMP-9', '대상', 'INF-009', L(30_000_000, 200_000_000, 60_000_000, 260_000_000, 20_000_000)), camp('CMP-8', '비슷1', 'INF-008', L(31_000_000, 205_000_000, 61_000_000, 265_000_000, 20_000_000)), camp('CMP-7', '비슷2', 'INF-007', L(29_500_000, 198_000_000, 59_000_000, 255_000_000, 19_000_000))] }
    const d = buildProfitability({ perf: same, campaigns: [{ id: 'CMP-9', name: '대상', influencerId: 'INF-009', productLine: '기초' }], influencers: [], kind: 'campaign', influencerId: 'INF-009', campaignId: 'CMP-9' })
    const j = mockJudge(d, {})
    assert.ok(!/비교:/.test(j.lines[0].text), '비슷한 수치는 비교 문구에 넣지 않는다')
  })

  await t('AI 판단: 불확실한 요소가 많을수록 점수가 깎인다', () => {
    const d = buildProfitability({ ...base, kind: 'influencer', influencerId: 'INF-004' })
    const few = mockJudge({ ...d, feeMix: null, subjectFeeType: null }, {})
    const many = mockJudge(d, { fixedFeeKrw: 1_000_000_000, performanceRateUnknown: true })
    const score = (j) => Math.abs(Number(j.lines[0].label.match(/(-?\d+)점/)[1]))
    assert.ok(score(many) <= score(few))
  })

  await t('AI 판단: 반품률은 비교 평균의 2배 이상일 때만 주의할 점으로 알린다', () => {
    const d = buildProfitability({ ...base, kind: 'influencer', influencerId: 'INF-001' })
    const hi = { ...d, columns: [{ ...d.columns[0], m: { ...d.columns[0].m, returnRate: 0.3 } }, ...d.columns.slice(1)], groups: d.groups.map((g) => ({ ...g, m: { ...g.m, returnRate: 0.1 } })) }
    assert.ok(mockJudge(hi, {}).lines.some((l) => /반품률/.test(l.text)))
    const lo = { ...hi, columns: [{ ...hi.columns[0], m: { ...hi.columns[0].m, returnRate: 0.12 } }, ...hi.columns.slice(1)] }
    assert.ok(!mockJudge(lo, {}).lines.some((l) => /반품률/.test(l.text)))
  })

  await t('표의 지표별 순위: 대상을 비교 모집단에 끼워 넣어 지표마다 센다', () => {
    const d = buildProfitability({ ...base, kind: 'influencer', influencerId: 'INF-001' })
    assert.equal(d.ranks.n, 4); assert.equal(d.ranks.cp, 4); assert.equal(d.ranks.roas > 0, true)
  })

  await t('요청 비중 vs 집행 비중: 금액이 아니라 비중으로 비교하고, 요청 비중 상위가 실질 하위면 거꾸로 선 것으로 알린다', () => {
    // 요청: 혜인(꼴찌 실적) 60%, 유키 20%, 초혜핏 10%, 토모카 10%
    const requests = [{ influencerId: 'INF-001', amount: 60 }, { influencerId: 'INF-004', amount: 20 }, { influencerId: 'INF-002', amount: 10 }, { influencerId: 'INF-003', amount: 10 }]
    const rich = { byInfluencer: perf.byInfluencer.map((x, i) => ({ ...x, spendShare: 0.25, rankByContribution: [4, 1, 2, 3][i] })), byCampaign: perf.byCampaign }
    const sc = buildShareCompare({ requests, perf: rich, subjectInfluencerId: 'INF-001' })
    assert.equal(sc.rows[0].influencerId, 'INF-001'); assert.ok(Math.abs(sc.rows[0].requestShare - 0.6) < 1e-9)
    assert.ok(sc.invertedTop.includes('혜인')); assert.ok(sc.correlation < 0)
    assert.equal(buildShareCompare({ requests: [], perf: rich, subjectInfluencerId: 'INF-001' }), null)
    const j = mockJudge(buildProfitability({ ...base, kind: 'influencer', influencerId: 'INF-001' }), { shares: sc })
    assert.ok(j.lines.some((l) => /요청 비중/.test(l.text)))
  })

  await t('AI 입력: 화면에 쓴 계산값을 한 덩어리로 모은다 — 회사 전체 목록·분포·배분·계약 방식, 대상은 isSubject 로 표시', () => {
    const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-2' })
    const input = buildJudgmentInput({ profitability: d, perf, subject: { influencerId: 'INF-001', campaignId: 'CMP-2' }, allocation: null, fees: { feeType: '고정+성과', fixedFeeKrw: 100, hasPerfFee: true } })
    assert.equal(input.company.campaigns.rows.length, 5); assert.equal(input.company.campaigns.rows.filter((r) => r.isSubject).length, 1)
    assert.equal(input.company.campaigns.dist.contributionProfit.negative, 2); assert.equal(input.fees.performanceRateUnknown, true)
    assert.ok(Array.isArray(JSON.parse(JSON.stringify(input)).company.influencers.rows)) // JSON 으로 그대로 보낼 수 있다
    assert.equal(distributionOf([1, 2, 3, 4, 5]).median, 3); assert.equal(distributionOf([]), null)
    assert.equal(judge(input).status, 'ok'); assert.match(JUDGMENT_PROMPT, /절대 수익성/)
  })

  await t('AI 판단: 손실인데 같은 인플루언서의 다른 캠페인보다 덜 나쁘다는 이유로 좋음 줄을 만들지 않는다', () => {
    const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-2' })
    const j = mockJudge(d, {})
    assert.ok(!j.lines.some((l) => l.tone === 'good'))
    assert.ok(!j.lines.some((l) => /같은 인플루언서의 다른 캠페인/.test(l.text)))
  })

  await t('자료 누락: 기존 실적도 제출 추계서도 없으면 AI 판단을 하지 않고 누락 사유를 돌려준다', () => {
    const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-NEW' })
    assert.equal(d.basis, null); assert.ok(d.missing.length > 0)
    const j = mockJudge(d, {})
    assert.equal(j.status, 'missing'); assert.ok(!('lines' in j))
  })

  await t('제출 추정: 기존 실적이 없어도 제출 추계서가 있으면 그 값으로 비교하고, 추정값이라는 한계를 알린다', () => {
    const d = buildProfitability({ ...base, kind: 'campaign', influencerId: 'INF-001', campaignId: 'CMP-NEW', estimate: { cp: 20_000_000, netRevenue: 100_000_000, gmv: 120_000_000, spend: 40_000_000, refund: 20_000_000 } })
    assert.equal(d.basis, '제출 추정'); assert.equal(d.missing.length, 0)
    const j = mockJudge(d, {})
    assert.equal(j.status, 'ok'); assert.ok(j.lines.some((l) => l.tone === 'caution' && /추정값/.test(l.text)))
  })

  console.log(`\n${n}개 시험 모두 통과`)
} catch (e) {
  console.error(e)
  process.exit(1)
}
