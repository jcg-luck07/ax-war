// W02 시연용 안건 만들기: 혜인 전속계약 1건 + 캠페인 확대 기안 25건.
// 기안은 mkt_budget_plan_ms.csv(DB 복사본)의 행에서 만들고, 계약은 통보서 값에서 만든다.
import type { Sql } from 'postgres'
import { openCase, type EngineConfig, type EvalResult } from '@/lib/engine/engine'
import { getSourceRows } from '@/lib/ingest/query'
import { CONTRACT_CASE_TYPE, CONTRACT_NOTICE, EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'

const won = (n: number) => `${Math.round(n / 10_000).toLocaleString()}만 원`

export interface SeedResult {
  contract: EvalResult
  plans: EvalResult[]
}

export async function seedW02(sql: Sql, cfg: EngineConfig): Promise<SeedResult> {
  const [plans, campaigns, influencers] = await Promise.all([
    getSourceRows('02_masil/marketing/mkt_budget_plan_ms.csv'),
    getSourceRows('02_masil/master/m_campaign_ms.csv'),
    getSourceRows('02_masil/master/m_influencer_ms.csv'),
  ])
  if (plans.length === 0) throw new Error('원본 자료가 DB 에 없어요. `node scripts/ingest.mjs` 로 먼저 복사해 주세요.')
  const campById = new Map(campaigns.map((c) => [c.campaign_id, c]))
  const inflById = new Map(influencers.map((i) => [i.influencer_id, i]))
  const draftTotal = plans.reduce((s, p) => s + Number(p.requested_budget_krw), 0)

  // 전속계약 (원본 문서 값)
  const contract = await openCase(sql, cfg, {
    caseType: CONTRACT_CASE_TYPE,
    title: `${CONTRACT_NOTICE.influencerName}(${CONTRACT_NOTICE.influencerId}) 연간 전속계약 갱신 — 고정 피 연 ${CONTRACT_NOTICE.annualFixedFeeKrw / 1e8}억 원`,
    deadline: CONTRACT_NOTICE.notifyDeadline,
    subjectRefs: { influencer: CONTRACT_NOTICE.influencerId },
    payload: {
      facts: {
        annual_contract_value_krw: CONTRACT_NOTICE.annualFixedFeeKrw,
        creates_cash_outflow: true,
        fixed_fee_payment_date: null, // 문서에 지급 일정 없음 → 미확인
        linked_to_group_300: null,
      },
      contract: { ...CONTRACT_NOTICE },
    },
    dataOrigin: '원본',
    actorName: '시드',
  })

  // 캠페인 확대 기안 25건
  const results: EvalResult[] = []
  for (const p of plans) {
    const camp = campById.get(p.campaign_id)
    const infl = camp ? inflById.get(camp.influencer_id) : undefined
    const amount = Number(p.requested_budget_krw)
    results.push(
      await openCase(sql, cfg, {
        caseType: EXPANSION_CASE_TYPE,
        title: `${p.plan_id} ${camp?.campaign_name ?? p.campaign_id} 확대 — 요청 ${won(amount)}`,
        deadline: p.contract_deadline,
        subjectRefs: { plan: p.plan_id, campaign: p.campaign_id, influencer: camp?.influencer_id ?? 'NONE' },
        payload: {
          facts: {
            per_plan_amount_krw: amount,
            draft_total_krw: draftTotal,
            creates_cash_outflow: true,
            linked_to_group_300: null, // 회의에서 정리되지 않음 → 미확인
          },
          plan: { ...p, influencer_name: infl?.influencer_name ?? null },
        },
        dataOrigin: '원본',
        actorName: '시드',
      }),
    )
  }
  return { contract, plans: results }
}
