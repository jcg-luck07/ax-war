// 안건별 공헌이익 — 수익성 검증 칸의 "이 대상" 값과 같은 값이다 (기존 실적이 있으면 실적, 없으면 제출한 추계서 값). 미확정 안건 목록의 맨 오른쪽 열에 쓴다 (서버 전용).
import type { Sql } from 'postgres'
import { listCases } from '@/lib/engine/engine'
import { MASIL_MODEL } from '@/lib/semantic/model'
import { entityRows } from '@/lib/semantic/run'
import { EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'
import { buildProfitability } from '@/lib/modules/w02/profitability'
import { tryPerformance } from './queries'

export async function contributionOfCases(sql: Sql, caseIds: number[]): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>()
  if (caseIds.length === 0) return out
  const [perf, campRows, infRows, cases] = await Promise.all([
    tryPerformance(),
    entityRows(sql, MASIL_MODEL, 'campaign').catch(() => []),
    entityRows(sql, MASIL_MODEL, 'influencer').catch(() => []),
    listCases(sql),
  ])
  const campaigns = campRows.map((r) => ({ id: String(r.campaign_id), name: String(r.campaign_name), influencerId: String(r.influencer_id), productLine: String(r.product_line) }))
  const influencers = infRows.map((r) => ({ id: String(r.influencer_id), name: String(r.influencer_name), feeType: r.fee_type ? String(r.fee_type) : null }))
  for (const c of cases.filter((x) => caseIds.includes(x.id))) {
    const sub = (c.payload as { submission?: { calc?: { inputs?: { gmv: number | null; refund: number | null; marketingSpend: number | null }; result: { netRevenue: number; contributionProfit: number } | null; missing?: string[] } } }).submission?.calc
    // 추계서에 비어 있는 칸이 있으면 0 으로 채워 계산하지 않고 제외한다
    const estimateMissing = sub ? (sub.missing?.length ? sub.missing : sub.result === null ? ['공헌이익 계산 칸'] : []) : []
    const d = buildProfitability({
      kind: c.caseType === EXPANSION_CASE_TYPE ? 'campaign' : 'influencer',
      influencerId: String(c.subjectRefs.influencer ?? ''),
      campaignId: c.subjectRefs.campaign ? String(c.subjectRefs.campaign) : undefined,
      perf, campaigns, influencers,
      estimate: sub?.inputs && sub.result && estimateMissing.length === 0 ? { cp: sub.result.contributionProfit, netRevenue: sub.result.netRevenue, gmv: sub.inputs.gmv ?? 0, spend: sub.inputs.marketingSpend ?? 0, refund: sub.inputs.refund ?? 0 } : null,
      estimateMissing,
    })
    out.set(c.id, d.columns[0]?.m?.cp ?? null)
  }
  return out
}
