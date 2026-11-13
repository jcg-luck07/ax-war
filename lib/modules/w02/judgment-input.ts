// AI 판단에 넘길 입력 한 덩어리 — 화면을 그리려고 이미 계산한 값들을 한곳에 모은다 (새 계산은 분포 요약뿐).
// 나중에 AI API 를 연결하면 이 객체를 JSON 으로 그대로 보내면 된다.
//
// 담는 것:
//  · 이 안건의 대상과 값의 출처, 수익성 검증 표 전체(대상 값·비교 묶음·표의 지표별 순위)
//  · 회사 전체의 캠페인·인플루언서 성과 목록과 분포(표 밖의 비교 기준) — 이 안건의 대상은 isSubject 로 표시
//  · 배분: 인플루언서별 이번 기안 요청 비중 · 지난 1년 집행 비중 · 실질 공헌이익 순위
//  · 계약 방식·금액(알려진 것만)과 지표의 한계
import type { PerfLine, PerformanceResult } from '@/lib/metrics/performance'
import { metricsOf, type ProfitabilityData, type ShareCompare } from './profitability'

/** 값 목록의 분포 요약 */
export interface Distribution {
  n: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  /** 0 미만인 개수 (손실 대상) */
  negative: number
}

export interface CompanyRow {
  id: string
  name: string
  influencerId: string
  /** 이 안건의 대상인가 */
  isSubject: boolean
  gmv: number
  adSpend: number
  contributionProfit: number
  /** 공헌이익 ÷ 순매출 */
  cpRate: number | null
  /** 공헌이익 ÷ 광고비 */
  poas: number | null
  /** GMV ÷ 광고비 */
  roas: number | null
  /** 실질 공헌이익 순위 (1 = 가장 좋음) */
  rankByContribution: number
  /** GMV 순위 (1 = 가장 큼) */
  rankByGmv: number
}

export interface CompanyView {
  rows: CompanyRow[]
  dist: { contributionProfit: Distribution | null; cpRate: Distribution | null; poas: Distribution | null }
}

export interface JudgmentInput {
  caseInfo: {
    kind: 'influencer' | 'campaign'
    subjectName: string
    /** 대상 값의 출처 */
    basis: ProfitabilityData['basis']
  }
  /** 수익성 검증 표 전체 (대상 값, 비교 묶음, 표의 지표별 순위, 누락 자료) */
  profitability: ProfitabilityData
  /** 회사 전체 비교 기준 — 표 밖의 안건·인플루언서·캠페인 순위와 분포 */
  company: { campaigns: CompanyView; influencers: CompanyView }
  /** 배분 방향: 요청 비중 vs 지난 1년 집행 비중 vs 실질 공헌이익 순위 (캠페인 집행 안건) */
  allocation: ShareCompare | null
  /** 계약 방식·금액 — 모르는 것은 null */
  fees: {
    feeType: string | null
    fixedFeeKrw: number | null
    performanceFeeKrw: number | null
    performanceRate: number | null
    /** 성과 피가 있는 계약인데 비율을 아직 모른다 */
    performanceRateUnknown: boolean
  }
}

function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i), hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

export function distributionOf(values: number[]): Distribution | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  return { n: s.length, min: s[0], q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75), max: s[s.length - 1], negative: s.filter((v) => v < 0).length }
}

function view(rows: CompanyRow[]): CompanyView {
  const nums = (f: (r: CompanyRow) => number | null) => rows.map(f).filter((v): v is number => v !== null)
  return {
    rows,
    dist: {
      contributionProfit: distributionOf(rows.map((r) => r.contributionProfit)),
      cpRate: distributionOf(nums((r) => r.cpRate)),
      poas: distributionOf(nums((r) => r.poas)),
    },
  }
}

const rowOf = (l: PerfLine, id: string, name: string, influencerId: string, isSubject: boolean, rankByContribution: number, rankByGmv: number): CompanyRow => {
  const m = metricsOf(l)
  return { id, name, influencerId, isSubject, gmv: l.gmv, adSpend: l.adSpend, contributionProfit: l.contributionProfit, cpRate: m.cpRate, poas: m.poas, roas: m.roas, rankByContribution, rankByGmv }
}

/** 순위(1 = 가장 큼) */
function ranks(values: number[]): number[] {
  return values.map((v) => 1 + values.filter((o) => o > v).length)
}

export interface BuildInputArgs {
  profitability: ProfitabilityData
  perf: PerformanceResult | null
  subject: { influencerId: string; campaignId?: string }
  allocation: ShareCompare | null
  fees: { feeType?: string | null; fixedFeeKrw?: number | null; performanceFeeKrw?: number | null; performanceRate?: number | null; hasPerfFee?: boolean }
}

export function buildJudgmentInput(a: BuildInputArgs): JudgmentInput {
  const p = a.perf
  const camps = p?.byCampaign ?? []
  const cr = ranks(camps.map((c) => c.contributionProfit)), gr = ranks(camps.map((c) => c.gmv))
  const campaigns = view(camps.map((c, i) => rowOf(c, c.campaignId, c.campaignName, c.influencerId, c.campaignId === a.subject.campaignId, cr[i], gr[i])))
  const infs = p?.byInfluencer ?? []
  const influencers = view(infs.map((i) => rowOf(i, i.influencerId, i.influencerName, i.influencerId, i.influencerId === a.subject.influencerId && !a.subject.campaignId, i.rankByContribution, i.rankByGmv)))
  const rateKnown = Number(a.fees.performanceRate ?? 0) > 0
  return {
    caseInfo: { kind: a.profitability.kind, subjectName: a.profitability.subjectName, basis: a.profitability.basis },
    profitability: a.profitability,
    company: { campaigns, influencers },
    allocation: a.allocation,
    fees: {
      feeType: a.fees.feeType ?? a.profitability.subjectFeeType,
      fixedFeeKrw: a.fees.fixedFeeKrw ?? null,
      performanceFeeKrw: a.fees.performanceFeeKrw ?? null,
      performanceRate: rateKnown ? Number(a.fees.performanceRate) : null,
      performanceRateUnknown: Boolean(a.fees.hasPerfFee) && !rateKnown,
    },
  }
}
