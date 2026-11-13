// 수익성 검증 — 판단자가 한눈에 비교할 수 있도록 안건 대상의 수익성 지표를 비교 대상과 나란히 놓는다 (순수 함수, 서버·시험 모두에서 쓴다).
//   · 인플루언서 계약: 다른 인플루언서와 비교
//   · 캠페인 집행: ① 같은 인플루언서의 다른 캠페인 ② 이 안건을 뺀 전체 캠페인 ③ 같은 종류(제품 라인)의 다른 인플루언서 캠페인
// 지표는 모두 공헌이익 계산 정의(사내 계산 정의 1.4)와 같은 식에서 나온다. 연 전속 고정 피·성과 피는 공헌이익에 들어 있지 않다.
import type { PerfLine, PerformanceResult } from '@/lib/metrics/performance'

export interface MetricSet {
  /** 실질 공헌이익 (원) — 비교 대상 묶음에서는 대상 1건당 평균 */
  cp: number
  /** 공헌이익률 = 공헌이익 ÷ 순매출 */
  cpRate: number | null
  /** 실질 ROAS = 공헌이익 ÷ 광고비. 공헌이익이 이미 광고비를 뺀 값이라 손익분기는 0배다 (흔히 쓰는 POAS = 광고비 전 이익 ÷ 광고비 와는 "POAS = 실질 ROAS + 1" 관계) */
  poas: number | null
  /** 명목 ROAS = GMV ÷ 광고비 */
  roas: number | null
  /** 반품률 = 환불 ÷ GMV (금액 기준) */
  returnRate: number | null
  /** 광고비 (원) */
  spend: number
}

export interface Column {
  label: string
  /** 라벨 아래 작은 글씨 (예: 3명 · 기준 설명) */
  sub?: string
  m: MetricSet | null
}

export interface ProfitabilityData {
  kind: 'influencer' | 'campaign'
  subjectName: string
  /** 대상 값의 출처: 기존 실적(원본 자료로 계산) / 제출 추정(팀원이 입력한 추계서) / 없음 */
  basis: '기존 실적' | '제출 추정' | null
  /** columns[0] 이 이 안건의 대상, 나머지는 비교 묶음 */
  columns: Column[]
  /** 비교의 기준이 되는 묶음(판단에 쓰는 평균) */
  groups: { key: string; label: string; /** 문장에 넣을 짧은 이름 */ short: string; n: number; m: MetricSet }[]
  /** 대상이 비교 모집단(인플루언서 전체 / 전체 캠페인)에서 어디쯤인가 — 1 이 가장 좋음, 0 이 가장 나쁨. 모르면 null */
  percentile: number | null
  rank: { cp: number; n: number } | null
  /** 표의 각 지표별 순위(1 = 가장 좋음) — 표에 있는 지표만. 대상을 비교 모집단에 끼워 넣어 센다 */
  ranks: { cp: number; cpRate: number | null; poas: number | null; roas: number | null; n: number } | null
  spendShare: { share: number; rank: number; n: number } | null
  /** 이 인플루언서(캠페인이면 소속 인플루언서)의 보수 구조: 고정 / 성과 / 고정+성과 */
  subjectFeeType: string | null
  /** 비교 대상 인플루언서들의 보수 구조 분포 (인플루언서 계약일 때) */
  feeMix: { fixed: number; perf: number; mixed: number } | null
  /** 공헌이익을 구하는 데 필요한 자료가 없을 때 그 목록 (비어 있어야 판단할 수 있다) */
  missing: string[]
  /** 제출한 추계서에 비어 있는 칸이 있어 "제출 추정" 공헌이익을 계산하지 못했다면 그 칸 목록 — 이 값은 비교·순위·AI 판단에 쓰지 않는다. (기존 실적으로 계산한 값은 영향 없음) */
  estimateMissing: string[]
}

export function metricsOf(l: PerfLine): MetricSet {
  return {
    cp: l.contributionProfit,
    cpRate: l.netRevenue > 0 ? l.contributionProfit / l.netRevenue : null,
    poas: l.adSpend > 0 ? l.contributionProfit / l.adSpend : null,
    roas: l.adSpend > 0 ? l.gmv / l.adSpend : null,
    returnRate: l.gmv > 0 ? l.refund / l.gmv : null,
    spend: l.adSpend,
  }
}

/** 여러 대상의 평균: 금액은 대상 1건당 평균, 비율은 합계끼리 나눈 값(큰 대상에 가중) */
export function aggregate(lines: PerfLine[]): MetricSet | null {
  if (lines.length === 0) return null
  const sum = (f: (l: PerfLine) => number) => lines.reduce((s, l) => s + f(l), 0)
  const cp = sum((l) => l.contributionProfit), net = sum((l) => l.netRevenue), spend = sum((l) => l.adSpend), gmv = sum((l) => l.gmv), refund = sum((l) => l.refund)
  return {
    cp: cp / lines.length,
    cpRate: net > 0 ? cp / net : null,
    poas: spend > 0 ? cp / spend : null,
    roas: spend > 0 ? gmv / spend : null,
    returnRate: gmv > 0 ? refund / gmv : null,
    spend: spend / lines.length,
  }
}

export interface Estimate {
  cp: number
  netRevenue: number
  gmv: number
  spend: number
  refund: number
}

export interface BuildArgs {
  kind: 'influencer' | 'campaign'
  influencerId: string
  campaignId?: string
  perf: PerformanceResult | null
  campaigns: { id: string; name: string; influencerId: string; productLine: string }[]
  influencers: { id: string; name: string; feeType: string | null }[]
  /** 팀원이 제출 때 입력한 추계서 값 — 기존 실적이 없을 때 대상 값으로 쓴다 */
  estimate?: Estimate | null
  /** 제출 추계서의 비어 있는 칸 (있으면 estimate 는 null 이어야 한다 — 0 으로 채워 계산하지 않는다) */
  estimateMissing?: string[]
}

const lineOfEstimate = (e: Estimate): PerfLine => ({
  orders: 0, refundedOrders: 0, gmv: e.gmv, refund: e.refund, netRevenue: e.netRevenue, cogs: 0, channelFee: 0, shipping: 0, returnLogistics: 0,
  adSpend: e.spend, contributionProfit: e.cp, nominalRoas: null, realRoas: null, returnRate: null,
})

/** 순위(1 = 가장 큼) 로 만든 백분위: 1 이 가장 좋고 0 이 가장 나쁘다. 모집단이 1개뿐이면 null */
function percentileOf(value: number, population: number[]): { rank: number; n: number; pct: number | null } {
  const all = [...population, value].sort((a, b) => b - a)
  const rank = all.indexOf(value) + 1
  return { rank, n: all.length, pct: all.length > 1 ? (all.length - rank) / (all.length - 1) : null }
}

/** 대상(m)을 다른 대상들(others)에 끼워 넣었을 때 지표별 순위 — 값이 클수록 좋은 지표라 큰 쪽이 1위 */
function ranksOf(m: MetricSet, others: PerfLine[]): NonNullable<ProfitabilityData['ranks']> {
  const ms = others.map(metricsOf)
  const rk = (v: number | null, f: (x: MetricSet) => number | null) => {
    if (v === null) return null
    return 1 + ms.filter((o) => { const w = f(o); return w !== null && w > v }).length
  }
  return { cp: rk(m.cp, (x) => x.cp) ?? 1, cpRate: rk(m.cpRate, (x) => x.cpRate), poas: rk(m.poas, (x) => x.poas), roas: rk(m.roas, (x) => x.roas), n: others.length + 1 }
}

// ───────── 요청 비중 vs 기존 집행 비중 (금액이 아니라 비중으로 비교)
//  · 요청 비중: 이번 기안의 인플루언서별 요청액 ÷ 전체 요청액 (예산 계획 자료와 기안 제출값은 같은 값으로 본다)
//  · 집행 비중: 지난 1년 인플루언서별 광고비 ÷ 전체 광고비 (mkt_ad_spend_ms)
export interface ShareRow {
  influencerId: string
  name: string
  /** 요청 비중 0~1 (이번 기안에 요청이 없으면 0) */
  requestShare: number
  /** 요청 비중 순위 (1 = 가장 큼, 요청이 있는 인플루언서끼리) */
  requestRank: number
  /** 실질 공헌이익 (원) */
  cpAmount: number | null
  /** 기존 집행 비중 0~1 */
  spendShare: number
  /** 실질 공헌이익 순위 (1 = 가장 좋음), 실적이 없으면 null */
  cpRank: number | null
}
export interface ShareCompare {
  rows: ShareRow[]
  /** 전체 인플루언서 수 (실질 공헌이익 순위의 모집단) */
  total: number
  /** 화면에 먼저 보여 줄 인플루언서: 이 안건의 인플루언서 · 요청 비중 상위 4명 · 요청은 상위인데 성과는 하위인 인플루언서 */
  keyIds: string[]
  /** 요청 비중 상위 3명 중 실질 공헌이익이 하위 절반인 사람 수 */
  topWeak: { top: number; weak: number }
  subjectId: string
  n: number
  /** 요청 비중 상위 1/3 중 실질 공헌이익 하위 1/3에 있는 인플루언서 이름 */
  invertedTop: string[]
  /** 요청 비중 순위와 실질 공헌이익 순위의 방향이 같은가 (스피어만 순위상관, -1~1). 비교 대상이 3명 미만이면 null */
  correlation: number | null
}

export function buildShareCompare(args: {
  requests: { influencerId: string; amount: number }[]
  perf: PerformanceResult | null
  subjectInfluencerId: string
}): ShareCompare | null {
  // 이 기안에 요청이 들어 있는 인플루언서들끼리만 비교한다 — 집행 비중·공헌이익 순위도 이 인플루언서들 안에서 다시 계산한다
  const total = args.requests.reduce((s, r) => s + r.amount, 0)
  const req = new Map<string, number>()
  for (const r of args.requests) req.set(r.influencerId, (req.get(r.influencerId) ?? 0) + r.amount)
  const inf = (args.perf?.byInfluencer ?? []).filter((i) => req.has(i.influencerId) || i.influencerId === args.subjectInfluencerId)
  if (inf.length === 0 || total <= 0) return null
  const spendTotal = inf.reduce((s, i) => s + i.adSpend, 0)
  const cpOrder = [...inf].sort((x, y) => y.contributionProfit - x.contributionProfit)
  const cpRankOf = new Map(cpOrder.map((i, k) => [i.influencerId, k + 1]))
  const rows: ShareRow[] = inf
    .map((i) => ({
      influencerId: i.influencerId,
      name: i.influencerName,
      requestShare: (req.get(i.influencerId) ?? 0) / total,
      requestRank: 0,
      cpAmount: i.contributionProfit,
      spendShare: spendTotal > 0 ? i.adSpend / spendTotal : 0,
      cpRank: cpRankOf.get(i.influencerId) ?? null,
    }))
    .sort((a, b) => b.requestShare - a.requestShare)
  const n = rows.length
  rows.forEach((r, i) => { r.requestRank = i + 1 })
  // 요청 비중 순위 vs 실질 공헌이익 순위 (같은 인플루언서들 안에서)
  const third = Math.ceil(n / 3)
  const invertedTop = rows.filter((r) => r.requestRank <= third && (r.cpRank ?? 0) > n - third).map((r) => r.name)
  let correlation: number | null = null
  if (n >= 3) {
    const d2 = rows.reduce((s, r) => s + (r.requestRank - (r.cpRank ?? 0)) ** 2, 0)
    correlation = 1 - (6 * d2) / (n * (n * n - 1))
  }
  const half = Math.floor(n / 2)
  const top3 = rows.slice(0, 3)
  const topWeak = { top: top3.length, weak: top3.filter((r) => (r.cpRank ?? 0) > n - half).length }
  const keyIds = rows.filter((r, i) => i < 4 || r.influencerId === args.subjectInfluencerId || invertedTop.includes(r.name)).map((r) => r.influencerId)
  return { rows, total: n, keyIds, topWeak, subjectId: args.subjectInfluencerId, n, invertedTop, correlation }
}

export function buildProfitability(a: BuildArgs): ProfitabilityData {
  const perf = a.perf
  const feeOf = new Map(a.influencers.map((i) => [i.id, i.feeType]))
  const nameOf = new Map(a.influencers.map((i) => [i.id, i.name]))
  const feeKind = (t: string | null | undefined) => (!t ? null : t.includes('+') ? 'mixed' : t === '고정' ? 'fixed' : t === '성과' ? 'perf' : null)
  const subjectFeeType = feeOf.get(a.influencerId) ?? null
  const base: ProfitabilityData = {
    kind: a.kind, subjectName: '', basis: null, columns: [], groups: [], percentile: null, rank: null, ranks: null, spendShare: null,
    subjectFeeType, feeMix: null, missing: [], estimateMissing: a.estimateMissing ?? [],
  }

  if (a.kind === 'influencer') {
    const inf = perf?.byInfluencer.find((x) => x.influencerId === a.influencerId)
    const others = (perf?.byInfluencer ?? []).filter((x) => x.influencerId !== a.influencerId)
    base.subjectName = nameOf.get(a.influencerId) ?? a.influencerId
    const line = inf ?? (a.estimate ? lineOfEstimate(a.estimate) : null)
    base.basis = inf ? '기존 실적' : a.estimate ? '제출 추정' : null
    if (!line) {
      base.missing.push(base.estimateMissing.length > 0 ? `제출한 추계서에 비어 있는 칸(${base.estimateMissing.join(', ')})이 있어 예상 공헌이익을 계산할 수 없고, 이 인플루언서의 기존 캠페인 실적도 없어요` : '이 인플루언서의 기존 캠페인 실적과 제출 추계서가 모두 없어요')
      return base
    }
    const m = metricsOf(line)
    const avg = aggregate(others)
    const sorted = [...others].sort((x, y) => y.contributionProfit - x.contributionProfit)
    base.columns = [{ label: '이 인플루언서', sub: base.basis ?? undefined, m }]
    if (avg) {
      base.columns.push({ label: '다른 인플루언서 평균', sub: `${others.length}명`, m: avg })
      base.groups.push({ key: 'others', label: '다른 인플루언서 평균', short: '다른 인플루언서', n: others.length, m: avg })
      const best = sorted[0], worst = sorted[sorted.length - 1]
      if (others.length >= 3) {
        base.columns.push({ label: `최고 (${best.influencerName})`, sub: '공헌이익 기준 (이 인플루언서 제외)', m: metricsOf(best) })
        base.columns.push({ label: `최저 (${worst.influencerName})`, sub: '공헌이익 기준 (이 인플루언서 제외)', m: metricsOf(worst) })
      }
    }
    const p = percentileOf(line.contributionProfit, others.map((x) => x.contributionProfit))
    base.rank = { cp: p.rank, n: p.n }
    base.percentile = p.pct
    base.ranks = ranksOf(m, others)
    if (inf) {
      const totalSpend = (perf?.byInfluencer ?? []).reduce((s, x) => s + x.adSpend, 0)
      const bySpend = [...(perf?.byInfluencer ?? [])].sort((x, y) => y.adSpend - x.adSpend)
      base.spendShare = totalSpend > 0 ? { share: inf.adSpend / totalSpend, rank: bySpend.findIndex((x) => x.influencerId === a.influencerId) + 1, n: bySpend.length } : null
    }
    const mix = { fixed: 0, perf: 0, mixed: 0 }
    for (const o of others) { const k = feeKind(feeOf.get(o.influencerId)); if (k) mix[k] += 1 }
    base.feeMix = mix
    return base
  }

  // 캠페인 집행
  const camp = a.campaigns.find((c) => c.id === a.campaignId)
  base.subjectName = camp?.name ?? a.campaignId ?? '이 캠페인'
  const line = perf?.byCampaign.find((x) => x.campaignId === a.campaignId) ?? null
  const used = line ?? (a.estimate ? lineOfEstimate(a.estimate) : null)
  base.basis = line ? '기존 실적' : a.estimate ? '제출 추정' : null
  if (!used) {
    base.missing.push(base.estimateMissing.length > 0 ? `제출한 추계서에 비어 있는 칸(${base.estimateMissing.join(', ')})이 있어 예상 공헌이익을 계산할 수 없고, 이 캠페인의 기존 실적도 없어요` : '이 캠페인의 기존 실적과 제출 추계서가 모두 없어요')
    return base
  }
  const all = (perf?.byCampaign ?? []).filter((x) => x.campaignId !== a.campaignId)
  const productOf = new Map(a.campaigns.map((c) => [c.id, c.productLine]))
  const sameInf = all.filter((x) => x.influencerId === a.influencerId)
  const sameType = camp
    ? all.filter((x) => productOf.get(x.campaignId) === camp.productLine && x.influencerId !== a.influencerId)
    : []
  base.columns = [{ label: '이 캠페인', sub: base.basis ?? undefined, m: metricsOf(used) }]
  const add = (key: string, label: string, short: string, list: PerfLine[]) => {
    const m = aggregate(list)
    if (!m) return
    base.columns.push({ label, sub: `${list.length}건`, m })
    base.groups.push({ key, label, short, n: list.length, m })
  }
  add('sameInfluencer', '같은 인플루언서의 다른 캠페인 평균', '같은 인플루언서의 다른 캠페인', sameInf)
  add('all', '전체 캠페인 평균 (이 안건 제외)', '전체 캠페인', all)
  add('sameType', `같은 종류(${camp?.productLine ?? '-'}) · 다른 인플루언서 평균`, `같은 종류(${camp?.productLine ?? '-'}) 타 인플루언서 캠페인`, sameType)
  const p = percentileOf(used.contributionProfit, all.map((x) => x.contributionProfit))
  base.rank = { cp: p.rank, n: p.n }
  base.percentile = p.pct
  base.ranks = ranksOf(metricsOf(used), all)
  return base
}
