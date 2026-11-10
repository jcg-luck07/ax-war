// 성과 계산을 DB 의 원본 복사본에 연결하는 얇은 층 (서버 전용).
// 계산 자체는 performance.ts 의 순수 함수가 한다.
import { getSourceRows } from '@/lib/ingest/query'
import {
  computePerformance,
  DEFAULT_ASSUMPTIONS,
  type PerfAssumptions,
  type PerformanceResult,
} from '@/lib/metrics/performance'

export async function getPerformance(
  assumptions: PerfAssumptions = DEFAULT_ASSUMPTIONS,
): Promise<PerformanceResult> {
  const [orders, returns, adSpend, costMaster, campaigns, influencers] = await Promise.all([
    getSourceRows('02_masil/marketing/mkt_orders_ms.csv'),
    getSourceRows('02_masil/marketing/mkt_returns_ms.csv'),
    getSourceRows('02_masil/marketing/mkt_ad_spend_ms.csv'),
    getSourceRows('02_masil/marketing/mkt_cost_master_ms.csv'),
    getSourceRows('02_masil/master/m_campaign_ms.csv'),
    getSourceRows('02_masil/master/m_influencer_ms.csv'),
  ])
  if (orders.length === 0 || campaigns.length === 0) {
    throw new Error('원본 자료가 DB 에 없어요. `node scripts/ingest.mjs` 로 먼저 복사해 주세요.')
  }
  return computePerformance({ orders, returns, adSpend, costMaster, campaigns, influencers }, assumptions)
}
