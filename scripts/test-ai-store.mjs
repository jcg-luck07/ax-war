// AI 판단 저장·재사용 시험.  node --import ./scripts/_register.mjs scripts/test-ai-store.mjs
// ⚠️ 로컬 시험 DB(_test)의 안건·이력을 모두 지운다.
import assert from 'node:assert/strict'
import * as E from '@/lib/engine/engine'
import { getEngine } from '@/lib/app/engine'
import { EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'
import { getSavedJudgment, hashJudgmentInput, saveJudgment } from '@/lib/modules/w02/ai-store'

const { sql, cfg } = await getEngine()
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const input = (cp) => ({ caseInfo: { kind: 'campaign', subjectName: '혜인 기초 캠페인3', basis: '기존 실적' }, profitability: { columns: [{ label: '이 캠페인', m: { cp } }], missing: [] }, company: { campaigns: { rows: [], dist: {} }, influencers: { rows: [], dist: {} } }, allocation: null, fees: { feeType: '고정 피' } })
const judgment = (text) => ({ status: 'ok', lines: [{ tone: 'bad', label: '나쁨 -60점', text }] })

try {
  await E.resetEngineData(sql)
  const open = () => E.openCase(sql, cfg, {
    caseType: EXPANSION_CASE_TYPE, title: '시험 안건', deadline: '2026-07-20', subjectRefs: { plan: 'T-1', campaign: 'CMP-0003', influencer: 'INF-001' },
    payload: { facts: { per_plan_amount_krw: 5_000_000, draft_total_krw: 5_000_000, creates_cash_outflow: true, linked_to_group_300: null }, plan: { plan_id: 'T-1' } }, dataOrigin: '사용자입력', actorName: '시험',
  })
  const a = (await open()).caseId
  const b = (await open()).caseId

  await t('판단 입력의 지문: 내용이 같으면 같고, 숫자 하나만 달라져도 달라진다 (누가·어느 단계에서 보는지와 무관)', () => {
    assert.equal(hashJudgmentInput(input(-30_000_000)), hashJudgmentInput(input(-30_000_000)))
    assert.notEqual(hashJudgmentInput(input(-30_000_000)), hashJudgmentInput(input(-30_000_001)))
  })
  await t('저장: 안건마다 가장 최근 판단 한 건만 남고, 다른 안건과 섞이지 않는다', async () => {
    assert.equal(await getSavedJudgment(sql, a), null)
    const h1 = hashJudgmentInput(input(1))
    await saveJudgment(sql, { caseId: a, inputHash: h1, judgment: judgment('첫 판단'), model: 'm', inputTokens: 10, outputTokens: 5 })
    const s1 = await getSavedJudgment(sql, a)
    assert.equal(s1.inputHash, h1); assert.equal(s1.judgment.lines[0].text, '첫 판단'); assert.equal(s1.inputTokens, 10)
    assert.equal(await getSavedJudgment(sql, b), null, '다른 안건에는 보이지 않는다')
    const h2 = hashJudgmentInput(input(2))
    await saveJudgment(sql, { caseId: a, inputHash: h2, judgment: judgment('다시 한 판단'), model: 'm', inputTokens: 11, outputTokens: 6 })
    const s2 = await getSavedJudgment(sql, a)
    assert.equal(s2.inputHash, h2); assert.equal(s2.judgment.lines[0].text, '다시 한 판단')
    assert.equal(Number((await sql`SELECT count(*) AS n FROM ai_judgments WHERE case_id = ${a}`)[0].n), 1)
  })
  await t('안건을 지우면(초기화) 저장된 판단도 함께 사라진다', async () => {
    await E.resetEngineData(sql)
    assert.equal(Number((await sql`SELECT count(*) AS n FROM ai_judgments`)[0].n), 0)
  })
  console.log(`\n${n}개 시험 모두 통과`)
  process.exit(0)
} catch (e) {
  console.error(e)
  process.exit(1)
}
