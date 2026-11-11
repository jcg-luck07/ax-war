// 원본 자료에서 나온 안건만 남기고 로컬 DB 의 안건 데이터를 모두 바꾼다 (합성·시험·직접 만든 안건·접수 대기·첨부는 지워진다).
//   node --import ./scripts/_register.mjs scripts/seed-original.mjs
// 적재하는 것 (모두 원본 자료가 근거):
//   1) 마케팅 확대 기안 25건 — 02_masil/marketing/mkt_budget_plan_ms.csv
//   2) 혜인(INF-001) 전속계약 갱신 통보 1건 — 02_masil/marketing/inf001_exclusive_contract_notice.md (문서에 없는 고정 피 지급일은 비워 두어 재무 확인 요청이 된다)
// 원본 복사본(source_rows)과 원본 파일은 건드리지 않는다.
import { getEngine } from '@/lib/app/engine'
import { CONTRACT_NOTICE } from '@/lib/modules/w02/contract-notice'
import { assignDrafts } from '@/lib/app/drafts'
import { importExpansionPlans, receiveContractNotice } from '@/lib/modules/w02/intake'

const { sql, cfg } = await getEngine()
const [{ n }] = await sql`SELECT count(*)::int AS n FROM source_rows`
if (n === 0) throw new Error('원본 복사본이 DB 에 없어요. 먼저 node scripts/ingest.mjs 를 실행하세요.')

// 안건·승인·작업·이력·접수 대기·첨부를 모두 지운다 (원본 복사본 source_rows 는 그대로).
// resetEngineData 는 시험용 DB 에서만 쓰도록 막혀 있어서(엔진의 안전장치) 거기를 거치지 않고, 이 스크립트가 직접 지운다 — 원본으로 바꾸려고 일부러 부르는 스크립트이기 때문이다.
await sql`TRUNCATE decision_cases, submissions, submission_files, case_files, drafts RESTART IDENTITY CASCADE`

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
await assignDrafts(sql) // 확대 안건 25개 → "마케팅팀 캠페인 확대 기안1", 전속계약 안건 → "혜인 연간 전속계약 갱신1"

const [{ total }] = await sql`SELECT count(*)::int AS total FROM decision_cases`
const [{ other }] = await sql`SELECT count(*)::int AS other FROM decision_cases WHERE data_origin <> '원본'`
console.log(`확대 기안 ${plans.imported}건 + 전속계약 통보 1건 = 안건 ${total}건 (원본이 아닌 안건 ${other}건)`)
await sql.end()
