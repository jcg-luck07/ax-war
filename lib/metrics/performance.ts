// 인플루언서·캠페인 성과 — 계산은 시맨틱 레이어(lib/semantic)가 하고, 여기서는 결과를 화면용으로 조립한다.
// (순위, 광고비 비중, 배분-성과 정렬도). 지표 정의는 lib/semantic/model.ts 에만 있다.
// 다른 파일을 import 하지 않는다 (순수 함수).

/** 계산 가정. 값을 바꿔 다시 계산할 수 있고, 바뀐 값은 결과에 그대로 실려 나간다. */
export interface PerfAssumptions {
  /** 주문 1건에 원가·배송비를 몇 번 적용할까. 주문 행에 수량이 없어서 가정이 필요하다. */
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

/** 가정 → 시맨틱 모델의 파라미터 */
export const toSemanticParams = (a: PerfAssumptions): Record<string, number> => ({
  unitsPerOrder: a.unitsPerOrder,
  returnLogisticsTimes: a.returnLogisticsTimes,
  recoverCostOnRefund: a.recoverCostOnRefund ? 1 : 0,
  recoverFeeOnRefund: a.recoverChannelFeeOnRefund ? 1 : 0,
})

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
    ordersMissingCost: number
    ordersWithoutCampaign: number
    returnsWithoutOrder: number
  }
}

/** 시맨틱 질의가 돌려주는 한 줄 */
export interface SemRow {
  key: string | null
  attrs: Record<string, string | null>
  values: Record<string, number | null>
}

/** 시맨틱 질의에 요청하는 지표·측정값 목록 */
export const PERF_SELECT = [
  'orders', 'refunded_orders', 'gmv', 'refund', 'cogs', 'channel_fee', 'shipping', 'return_logistics', 'ad_spend',
  'net_revenue', 'contribution_profit', 'nominal_roas', 'real_roas', 'return_rate',
]

const n0 = (v: number | null | undefined) => v ?? 0

export function toLine(v: Record<string, number | null>): PerfLine {
  return {
    orders: n0(v.orders), refundedOrders: n0(v.refunded_orders), gmv: n0(v.gmv), refund: n0(v.refund),
    netRevenue: n0(v.net_revenue), cogs: n0(v.cogs), channelFee: n0(v.channel_fee), shipping: n0(v.shipping),
    returnLogistics: n0(v.return_logistics), adSpend: n0(v.ad_spend), contributionProfit: n0(v.contribution_profit),
    nominalRoas: v.nominal_roas ?? null, realRoas: v.real_roas ?? null, returnRate: v.return_rate ?? null,
  }
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

export function assemblePerformance(
  inf: readonly SemRow[], camp: readonly SemRow[], total: SemRow | undefined,
  quality: Record<string, number | null>, assumptions: PerfAssumptions,
): PerformanceResult {
  const lines = inf.map((r) => toLine(r.values))
  const totalSpend = lines.reduce((s, l) => s + l.adSpend, 0)
  const rGmv = rankDesc(lines.map((l) => l.gmv))
  const rSpend = rankDesc(lines.map((l) => l.adSpend))
  const rCp = rankDesc(lines.map((l) => l.contributionProfit))

  const byInfluencer: InfluencerPerf[] = inf.map((r, i) => ({
    ...lines[i],
    influencerId: r.key ?? '',
    influencerName: r.attrs.influencer_name ?? '',
    tier: r.attrs.tier ?? '',
    spendShare: totalSpend > 0 ? lines[i].adSpend / totalSpend : 0,
    rankByGmv: rGmv[i],
    rankBySpend: rSpend[i],
    rankByContribution: rCp[i],
  }))
  byInfluencer.sort((x, y) => x.rankByContribution - y.rankByContribution)

  const byCampaign: CampaignPerf[] = camp.map((r) => ({
    ...toLine(r.values), campaignId: r.key ?? '', campaignName: r.attrs.campaign_name ?? '', influencerId: r.attrs.influencer_id ?? '',
  }))

  // 배분-성과 정렬도: 광고비 순위 vs 실질 공헌이익 순위 (둘 다 1=큼). 같은 방향이면 +, 반대면 −
  const rho = pearson(rSpend, rCp) // 순위에 대한 피어슨 = 스피어만
  const direction = rho === null ? '계산 불가' : rho >= 0.3 ? '같은 방향' : rho <= -0.3 ? '반대 방향' : '뚜렷하지 않음'

  return {
    assumptions,
    byInfluencer,
    byCampaign,
    totals: toLine(total?.values ?? {}),
    alignment: { spearman: rho, direction },
    quality: {
      ordersMissingCost: n0(quality.orders_missing_cost),
      ordersWithoutCampaign: n0(quality.orders_without_campaign),
      returnsWithoutOrder: n0(quality.returns_without_order),
    },
  }
}
