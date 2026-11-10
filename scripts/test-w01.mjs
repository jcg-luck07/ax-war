// 두 번째 업무 예시(재고 발주 승인) 시험 — 엔진 코드는 그대로이고 규칙(AUTH-PO-SCM)과 handler 만 추가했다.
//   node --import ./scripts/_register.mjs scripts/test-w01.mjs
// ⚠️ 로컬 DB 의 안건·이력·승인·작업을 모두 지운다. W01 전체가 아니라 '발주 승인 권한' 한 가지만 구현한 최소 예시다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as E from '@/lib/engine/engine'
import { getEngine } from '@/lib/app/engine'
import { PO_CASE_TYPE } from '@/lib/modules/w01/handlers'

const { sql, cfg, cash } = await getEngine()
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const mk = (date) => E.openCase(sql, cfg, { caseType: PO_CASE_TYPE, title: `시험 발주 ${date ?? '(지급일 모름)'}`, dataOrigin: '가상입력', payload: { facts: { creates_cash_outflow: true, payment_due_date: date, linked_to_group_300: false } } })

try {
  await E.resetEngineData(sql)

  await t('엔진 코드에 W01·W02 업무 이름이 없다 (엔진은 업무를 모른다)', () => {
    const src = readFileSync(new URL('../lib/engine/engine.ts', import.meta.url), 'utf8')
    for (const w of ['w01', 'w02', 'INF-', '혜인', '발주']) assert.ok(!src.includes(w), `engine.ts 에 "${w}" 가 있음`)
  })
  await t('평시: 하회 구간 밖(9/15) 대금 지급 발주 → SCM 승인', async () => {
    const r = await mk('2026-09-15')
    assert.equal(r.decision.status, 'decided'); assert.equal(r.decision.authority, 'scm')
  })
  await t('같은 발주라도 지급일이 하회 구간 안(7/28)이면 → 평시 SCM 전결이 무력화되고 그룹 CEO', async () => {
    const r = await mk('2026-07-28')
    assert.equal(r.decision.authority, 'group_ceo')
    assert.ok(r.decision.matched.some((m) => m.ruleId === 'AUTH-PO-SCM'), 'SCM 규칙도 적용되었지만 더 높은 권한이 이긴다')
  })
  let unknownId
  await t('지급일을 모르면 SCM 으로 확정하지 않고 확인 요청(재무)', async () => {
    const r = await mk(null); unknownId = r.caseId
    assert.equal(r.decision.status, 'need_info')
    const task = (await E.getCaseView(sql, unknownId)).tasks.find((x) => x.taskType === 'info_request')
    assert.equal(task.assigneeRole, '재무'); assert.equal(task.detail.answerFields[0].name, 'payment_due_date')
  })
  await t('회신(지급일 9/15) → 재평가 → SCM 으로 확정되고, SCM 이 승인하면 발주 전달·현금 반영 작업이 생긴다', async () => {
    const task = (await E.getCaseView(sql, unknownId)).tasks.find((x) => x.taskType === 'info_request')
    const r = await E.provideInfo(sql, cfg, task.id, { answers: { payment_due_date: '2026-09-15' }, origin: '가상입력', by: '재무(모의)' })
    assert.equal(r.decision.authority, 'scm')
    const ap = (await E.getCaseView(sql, unknownId)).approvals.find((a) => a.status === 'pending')
    const d = await E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'scm', byName: '' })
    assert.equal(d.taskIds.length, 2)
    const v = await E.getCaseView(sql, unknownId)
    assert.match(v.approvals.find((a) => a.status === 'approved').decidedBy, /^SCM$/, '결정자 표시에 역할 이름이 중복되지 않는다')
  })
  await t('하회 구간은 W02 와 같은 현금 재전망에서 온다 (두 업무가 같은 판단 기준을 공유)', () => {
    assert.ok(cash.windows.length > 0)
    console.log(`   공통 하회 구간: ${cash.windows[0].start} ~ ${cash.windows[0].end}`)
  })

  console.log(`\n${n}개 시험 모두 통과`)
} finally {
  await sql.end()
}
