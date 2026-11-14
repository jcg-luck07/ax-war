// 배포 DB 가 처음 켜질 때, 안건이 하나도 없으면 원본 자료에서 나온 안건만 넣는다 (서버 전용).
//   1) 마케팅 확대 기안 25건 — 02_masil/marketing/mkt_budget_plan_ms.csv
//   2) 혜인(INF-001) 전속계약 갱신 통보 1건 — inf001_exclusive_contract_notice.md (고정 피 지급일은 원본에 없어 비워 두고 재무 확인 요청이 된다)
// 합성 안건은 넣지 않는다. 안건이 이미 있으면 아무것도 하지 않는다(심사자가 만든 안건을 건드리지 않음).
// scripts/seed-original.mjs 와 같은 내용이지만, 그 스크립트와 달리 지우지 않고 "비어 있을 때만" 넣는다.
import postgres from 'postgres'
import { getEngine } from '@/lib/app/engine'
import { assignDrafts } from '@/lib/app/drafts'
import { CONTRACT_NOTICE } from '@/lib/modules/w02/contract-notice'
import { importExpansionPlans, receiveContractNotice } from '@/lib/modules/w02/intake'

export async function seedOriginalIfEmpty(): Promise<'seeded' | 'skipped'> {
  const { sql: pool, cfg } = await getEngine()
  const count = async (s: typeof pool) => {
    const [{ n }] = await s<{ n: number }[]>`SELECT (SELECT count(*) FROM decision_cases)::int + (SELECT count(*) FROM submissions)::int AS n`
    return n
  }
  if ((await count(pool)) > 0) return 'skipped'

  // 여러 파드가 동시에 켜져도 한 곳만 넣도록 전용 연결(세션)에 advisory lock 을 건다.
  const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || ''
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await sql`SELECT pg_advisory_lock(7420032)`
    if ((await count(sql)) > 0) return 'skipped' // 기다리는 동안 다른 파드가 이미 넣었다
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM source_rows`
    if (n === 0) throw new Error('원본 복사본이 DB 에 없어서 원본 안건을 넣지 못했어요.')

    const plans = await importExpansionPlans(sql, cfg, '원본 자료 (mkt_budget_plan_ms.csv)')
    const contract = await receiveContractNotice(sql, cfg, {
      influencerId: CONTRACT_NOTICE.influencerId,
      annualFixedFeeKrw: CONTRACT_NOTICE.annualFixedFeeKrw,
      notifyDeadline: CONTRACT_NOTICE.notifyDeadline,
      currentExpiry: CONTRACT_NOTICE.currentExpiry,
      fixedFeePaymentDate: null, // 원본에 없음 → 미확인(확인 요청)
      note: `원본 통보서: ${CONTRACT_NOTICE.sourceFile}`,
    }, '원본 자료 (inf001_exclusive_contract_notice.md)')
    await sql`UPDATE decision_cases SET data_origin = '원본' WHERE id = ${contract.caseId}`
    await sql`UPDATE decision_cases SET data_origin = '원본' WHERE case_type = 'w02.campaign_expansion'`
    await assignDrafts(sql)
    console.log(`[원본 안건 적재] 확대 기안 ${plans.imported}건 + 전속계약 통보 1건`)
    return 'seeded'
  } finally {
    await sql`SELECT pg_advisory_unlock(7420032)`.catch(() => {})
    await sql.end()
  }
}
