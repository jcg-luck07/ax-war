// 인플루언서·캠페인 성과 계산 (순수 함수 — DB·파일을 모른다. 행 배열과 가정만 받는다).
// 지표 정의는 definitions.ts 와 calculation_definitions.md 1.4 를 따른다.
// 다른 파일을 import 하지 않는다.

export type Row = Record<string, string>

export interface PerfInputs {
  orders: readonly Row[] // mkt_orders_ms
  returns: readonly Row[] // mkt_returns_ms
  adSpend: readonly Row[] // mkt_ad_spend_ms
  costMaster: readonly Row[] // mkt_cost_master_ms
  campaigns: readonly Row[] // m_campaign_ms
  influencers: readonly Row[] // m_influencer_ms
}

/** 계산 가정. 값을 바꿔 다시 계산할 수 있다 — 바뀐 값은 결과에 그대로 실려 나간다. */
export interface PerfAssumptions {
  /** 주문 1건에 원가·배송비를 몇 번(수량) 적용할까. 주문 행에 수량이 없어서 가정이 필요하다. */
  unitsPerOrder: number
  /** 반품 물류비를 환불 1건에 몇 번 적용할까 */
  returnLogisticsTimes: number
  /** 환불되면 제품원가를 회수한다고 볼까 (자료가 없어 기본 false) */
  recoverCostOnRefund: boolean
  /** 환불되면 채널수수료를 돌려받는다고 볼까 (자료가 없어 기본 false) */
  recoverChannelFeeOnRefund: boolean
}

export const DEFAULT_ASSUMPTIONS: PerfAssumptions = {
  unitsPerOrder: 1,
  returnLogisticsTimes: 1,
  recoverCostOnRefund: false,
  recoverChannelFeeOnRefund: false,
}

export interface PerfLine {
  orders: number
  refundedOrders: number
  gmv: number
  refund: number
  netRevenue: number
  cogs: number
  channelFee: number
  shipping: number
  returnLogistics: number
  adSpend: number
  contributionProfit: number
  nominalRoas: number | null
  realRoas: number | null
  returnRate: number | null // 0~1, 금액 기준
}

export interface InfluencerPerf extends PerfLine {
  influencerId: string
  influencerName: string
  tier: string
  spendShare: number // 전체 광고비 중 비중 0~1
  rankByGmv: number // 1 = 가장 큼
  rankBySpend: number
  rankByContribution: number
}

export interface CampaignPerf extends PerfLine {
  campaignId: string
  campaignName: string
  influencerId: string
}

export interface PerformanceResult {
  assumptions: PerfAssumptions
  byInfluencer: InfluencerPerf[]
  byCampaign: CampaignPerf[]
  totals: PerfLine
  alignment: {
    /** 광고비 순위와 실질 공헌이익 순위의 스피어만 상관 (−1~+1). 계산 불가면 null */
    spearman: number | null
    direction: '같은 방향' | '반대 방향' | '뚜렷하지 않음' | '계산 불가'
  }
  quality: {
    ordersMissingCost: number // 비용 마스터에 없는 (SKU, 채널) 주문 수
    ordersWithoutCampaign: number
    returnsWithoutOrder: number
    campaignsWithoutInfluencer: number
  }
}

const num = (v: string | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const zero = (): PerfLine => ({
  orders: 0, refundedOrders: 0, gmv: 0, refund: 0, netRevenue: 0, cogs: 0, channelFee: 0,
  shipping: 0, returnLogistics: 0, adSpend: 0, contributionProfit: 0,
  nominalRoas: null, realRoas: null, returnRate: null,
})

/** 합계로 파생 값(순수익·공헌이익·ROAS·반품률)을 채운다. */
function finish(l: PerfLine): PerfLine {
  l.netRevenue = l.gmv - l.refund
  l.contributionProfit = l.netRevenue - l.cogs - l.channelFee - l.shipping - l.returnLogistics - l.adSpend
  l.nominalRoas = l.adSpend > 0 ? l.gmv / l.adSpend : null
  l.realRoas = l.adSpend > 0 ? l.contributionProfit / l.adSpend : null
  l.returnRate = l.gmv > 0 ? l.refund / l.gmv : null
  return l
}

function rankDesc(values: number[]): number[] {
  // 1 = 가장 큼. 동률은 평균 순위.
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
  const ranks = new Array<number>(values.length)
  let k = 0
  while (k < idx.length) {
    let j = k
    while (j + 1 < idx.length && idx[j + 1].v === idx[k].v) j++
    const avg = (k + j) / 2 + 1
    for (let m = k; m <= j; m++) ranks[idx[m].i] = avg
    k = j + 1
  }
  return ranks
}

function pearson(x: number[], y: number[]): number | null {
  const n = x.length
  if (n < 3) return null
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy)
}

export function computePerformance(
  inp: PerfInputs,
  assumptions: PerfAssumptions = DEFAULT_ASSUMPTIONS,
): PerformanceResult {
  const a = assumptions
  const campaignById = new Map(inp.campaigns.map((c) => [c.campaign_id, c]))
  const influencerById = new Map(inp.influencers.map((i) => [i.influencer_id, i]))
  const costByKey = new Map(inp.costMaster.map((c) => [`${c.sku_id}|${c.channel_id}`, c]))

  // 주문별 환불 합 (한 주문에 환불이 여러 건일 수 있다)
  const orderIds = new Set(inp.orders.map((o) => o.order_id))
  const refundByOrder = new Map<string, number>()
  let returnsWithoutOrder = 0
  for (const r of inp.returns) {
    if (!orderIds.has(r.order_id)) { returnsWithoutOrder++; continue }
    refundByOrder.set(r.order_id, (refundByOrder.get(r.order_id) ?? 0) + num(r.refund_amount_krw))
  }

  const byCampaign = new Map<string, PerfLine>()
  const line = (cid: string) => {
    let l = byCampaign.get(cid)
    if (!l) byCampaign.set(cid, (l = zero()))
    return l
  }

  let ordersMissingCost = 0
  let ordersWithoutCampaign = 0
  for (const o of inp.orders) {
    if (!campaignById.has(o.campaign_id)) { ordersWithoutCampaign++; continue }
    const l = line(o.campaign_id)
    const gmv = num(o.gmv_krw)
    const refund = refundByOrder.get(o.order_id) ?? 0
    l.orders += 1
    l.gmv += gmv
    l.refund += refund
    const m = costByKey.get(`${o.sku_id}|${o.channel_id}`)
    if (!m) { ordersMissingCost++; if (refund > 0) l.refundedOrders += 1; continue }
    const refunded = refund > 0
    if (refunded) l.refundedOrders += 1
    const cogs = num(m.product_cost_krw) * a.unitsPerOrder
    const fee = (gmv * num(m.channel_fee_pct)) / 100
    l.cogs += refunded && a.recoverCostOnRefund ? 0 : cogs
    l.channelFee += refunded && a.recoverChannelFeeOnRefund ? 0 : fee
    l.shipping += num(m.shipping_cost_krw) * a.unitsPerOrder
    if (refunded) l.returnLogistics += num(m.return_logistics_cost_krw) * a.returnLogisticsTimes
  }
  // 광고비는 ad_cost_krw 전액 (influencer_fee_krw 는 이미 포함이라 더하지 않는다)
  for (const s of inp.adSpend) {
    if (campaignById.has(s.campaign_id)) line(s.campaign_id).adSpend += num(s.ad_cost_krw)
  }

  const campaignPerfs: CampaignPerf[] = []
  const infl = new Map<string, PerfLine>()
  let campaignsWithoutInfluencer = 0
  for (const [cid, l] of byCampaign) {
    finish(l)
    const c = campaignById.get(cid)!
    campaignPerfs.push({ ...l, campaignId: cid, campaignName: c.campaign_name, influencerId: c.influencer_id })
    if (!influencerById.has(c.influencer_id)) { campaignsWithoutInfluencer++; continue }
    const t = infl.get(c.influencer_id) ?? zero()
    for (const k of ['orders','refundedOrders','gmv','refund','cogs','channelFee','shipping','returnLogistics','adSpend'] as const) t[k] += l[k]
    infl.set(c.influencer_id, t)
  }

  const ids = [...infl.keys()]
  const lines = ids.map((id) => finish(infl.get(id)!))
  const totalSpend = lines.reduce((s, l) => s + l.adSpend, 0)
  const rGmv = rankDesc(lines.map((l) => l.gmv))
  const rSpend = rankDesc(lines.map((l) => l.adSpend))
  const rCp = rankDesc(lines.map((l) => l.contributionProfit))

  const byInfluencer: InfluencerPerf[] = ids.map((id, i) => ({
    ...lines[i],
    influencerId: id,
    influencerName: influencerById.get(id)!.influencer_name,
    tier: influencerById.get(id)!.tier,
    spendShare: totalSpend > 0 ? lines[i].adSpend / totalSpend : 0,
    rankByGmv: rGmv[i],
    rankBySpend: rSpend[i],
    rankByContribution: rCp[i],
  }))
  byInfluencer.sort((x, y) => x.rankByContribution - y.rankByContribution)

  const totals = zero()
  for (const l of lines) for (const k of ['orders','refundedOrders','gmv','refund','cogs','channelFee','shipping','returnLogistics','adSpend'] as const) totals[k] += l[k]
  finish(totals)

  // 배분-성과 정렬도: 광고비 순위 vs 실질 공헌이익 순위 (둘 다 1=큼). 같은 방향이면 +, 반대면 −
  const rho = pearson(rSpend, rCp) // 순위에 대한 피어슨 = 스피어만
  const direction = rho === null ? '계산 불가' : rho >= 0.3 ? '같은 방향' : rho <= -0.3 ? '반대 방향' : '뚜렷하지 않음'

  return {
    assumptions: a,
    byInfluencer,
    byCampaign: campaignPerfs.sort((x, y) => x.campaignId.localeCompare(y.campaignId)),
    totals,
    alignment: { spearman: rho, direction },
    quality: { ordersMissingCost, ordersWithoutCampaign, returnsWithoutOrder, campaignsWithoutInfluencer },
  }
}
