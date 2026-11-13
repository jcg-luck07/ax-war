// 그룹 300억 배분 대상 안건 시험.  node --import ./scripts/_register.mjs scripts/test-group300.mjs
//  · 재무팀이 300억 대상으로 정하면 CEO/이사회가 결정한다. 승인 = 최종 승인.
//  · CEO/이사회가 부결하면 300억 배분 대상에서 빠지고(대상 아님), 일반 승인 규칙의 승인권자(Masil 대표)가 재결정한다.
// ⚠️ 로컬 시험 DB(_test)의 안건·이력을 모두 지운다.
import assert from 'node:assert/strict'
import * as E from '@/lib/engine/engine'
import { getEngine } from '@/lib/app/engine'
import { acceptSubmission, checksFor, fileCheckId, listFiles, submitIntake } from '@/lib/modules/intake/submissions'
import { addCaseFile, contractRefer, financeRefer } from '@/lib/modules/w02/handoff'
import { EXPANSION_FLOW, flowWithGroup300, flowWithoutGroupReport, usesGroup300Flow } from '@/lib/process/definitions'
import { deriveFlowState } from '@/lib/process/state'
import { stateText } from '@/lib/process/status'

const { sql, cfg } = await getEngine()
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const CONTRIB = { gmv: '100000000', refund: '10000000', cogs: '30000000', channelFee: '7000000', shipping: '4000000', returnLogistics: '1000000' }
const files = ['draft', 'estimate', 'contract'].map((k) => ({ kind: k, filename: `${k}.txt`, mime: 'text/plain', content: Buffer.from(k) }))
// 접수 → 재무 회부(300억 대상 여부) → 계약 담당 회부 까지 마친 안건 (승인권자 결정 단계)
const readyCase = async (refId, linked) => {
  const s = await submitIntake(sql, { category: 'campaign', refId, values: { settlementDate: '2026-09-10', contractDeadline: '2026-07-10', requested: '15000000', memo: '', ...CONTRIB }, files, by: '팀원' })
  const checks = [...checksFor('campaign', false).map((c) => c.id), ...(await listFiles(sql, s.id)).map((f) => fileCheckId(f.id))]
  const id = (await acceptSubmission(sql, cfg, s.id, '팀장', checks)).caseId
  await financeRefer(sql, cfg, id, { linked, by: '재무' })
  await addCaseFile(sql, { caseId: id, kind: 'contract', filename: 'c.pdf', mime: 'application/pdf', content: Buffer.from('x'), by: '계약' })
  await contractRefer(sql, id, '계약')
  return id
}
const flowOf = async (id) => {
  const v = await E.getCaseView(sql, id)
  const last = [...v.approvals].reverse().find((a) => a.status === 'approved' || a.status === 'rejected' || a.status === 'on_hold')
  const base = v.case.authority === 'masil_ceo' ? EXPANSION_FLOW : flowWithoutGroupReport(EXPANSION_FLOW)
  const def = usesGroup300Flow(v.case.payload, last?.status ?? null) ? flowWithGroup300(base) : base
  return { v, def, st: deriveFlowState(def, v) }
}

try {
  await E.resetEngineData(sql)

  await t('300억 대상으로 정하면 CEO/이사회가 승인권자이고, 업무 흐름표에도 CEO/이사회 결정 → 재결정 단계가 있다', async () => {
    const id = await readyCase('CMP-0004', true)
    const { v, def, st } = await flowOf(id)
    assert.equal(v.case.authority, 'ceo_board'); assert.equal(v.approvals.find((a) => a.status === 'pending').requiredRole, 'ceo_board')
    assert.ok(def.nodes.some((x) => x.id === 'redecide'))
    assert.equal(st.nodes.decide, 'current'); assert.equal(st.nodes.redecide, 'todo')
    assert.equal(stateText(def, st, v.case.status, 'CEO/이사회').text, '승인 필요 · CEO/이사회')
  })
  await t('앞 단계(계약 담당 확인) 중에는 상태에 "이후 CEO/이사회 결정 (300억)"이 함께 보이고, 지금 단계는 계약 담당 확인이다', async () => {
    const s = await submitIntake(sql, { category: 'campaign', refId: 'CMP-0007', values: { settlementDate: '2026-09-10', contractDeadline: '2026-07-10', requested: '15000000', memo: '', ...CONTRIB }, files, by: '팀원' })
    const checks = [...checksFor('campaign', false).map((c) => c.id), ...(await listFiles(sql, s.id)).map((f) => fileCheckId(f.id))]
    const id = (await acceptSubmission(sql, cfg, s.id, '팀장', checks)).caseId
    await financeRefer(sql, cfg, id, { linked: true, by: '재무' })
    const { v, def, st } = await flowOf(id)
    assert.equal(st.nodes.confirm, 'current'); assert.equal(st.nodes.decide, 'blocked')
    assert.equal(stateText(def, st, v.case.status, 'CEO/이사회').text, '계약 담당 확인 필요 · 이후 CEO/이사회 결정 (300억)')
    assert.equal(stateText(def, st, v.case.status, 'CEO/이사회').base, '계약 담당 확인 필요')
  })
  await t('CEO/이사회가 승인하면 그대로 최종 승인이다 (재결정 없음)', async () => {
    const id = await readyCase('CMP-0005', true)
    const ap = (await E.getCaseView(sql, id)).approvals.find((a) => a.status === 'pending')
    await E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'ceo_board', byName: 'CEO' })
    const { v, st } = await flowOf(id)
    assert.equal(v.case.status, 'approved'); assert.equal(st.outcome, 'approved'); assert.equal(st.nodes.redecide, 'todo')
  })
  await t('CEO/이사회가 부결하면 안건이 끝나지 않고 300억 대상에서 빠져 Masil 대표가 재결정한다 (업무 흐름표·상태도 재결정 단계)', async () => {
    const id = await readyCase('CMP-0006', true)
    const ap = (await E.getCaseView(sql, id)).approvals.find((a) => a.status === 'pending')
    const r = await E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'ceo_board', byName: 'CEO', comment: '300억에 넣지 않음' })
    assert.notEqual(r.statusAfter, 'rejected')
    const { v, def, st } = await flowOf(id)
    assert.equal(v.case.status, 'pending_approval'); assert.equal(v.case.payload.facts.linked_to_group_300, false)
    assert.ok(v.case.payload.group300Excluded); assert.equal(v.case.authority, 'masil_ceo')
    assert.equal(v.approvals.find((a) => a.status === 'pending').requiredRole, 'masil_ceo')
    assert.equal(v.approvals.find((a) => a.id === ap.id).status, 'superseded', 'CEO 의 부결 요청은 부결 기록으로 남기지 않는다(안건이 부결된 것이 아니므로)')
    assert.equal(st.nodes.decide, 'done'); assert.equal(st.nodes.redecide, 'current'); assert.equal(st.edges['decide->redecide'], 'taken')
    assert.equal(st.outcome, null)
    assert.equal(stateText(def, st, v.case.status, 'Masil 대표').text, '승인 필요 · Masil 대표 (300억 제외 후 재결정)')
    assert.ok(v.events.some((e) => e.eventType === 'decided' && e.detail.reroute === 'group300_excluded'))
    // 재결정: Masil 대표가 승인하면 최종 승인, CEO 는 더 이상 결정할 수 없다
    await assert.rejects(() => E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'ceo_board', byName: 'CEO' }), /이미 처리/)
    const ap2 = v.approvals.find((a) => a.status === 'pending')
    await E.decide(sql, cfg, ap2.id, { outcome: 'approved', byRole: 'masil_ceo', byName: '대표' })
    const f = await flowOf(id)
    assert.equal(f.v.case.status, 'approved'); assert.equal(f.st.nodes.redecide, 'done'); assert.equal(f.st.edges['redecide->doc'], 'taken'); assert.equal(f.st.edges['decide->doc'], 'dim')
  })
  await t('재결정에서 Masil 대표가 부결하면 그때는 안건이 부결된다', async () => {
    const id = await readyCase('CMP-0008', true)
    const ap = (await E.getCaseView(sql, id)).approvals.find((a) => a.status === 'pending')
    await E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'ceo_board', byName: 'CEO' })
    const ap2 = (await E.getCaseView(sql, id)).approvals.find((a) => a.status === 'pending')
    await E.decide(sql, cfg, ap2.id, { outcome: 'rejected', byRole: 'masil_ceo', byName: '대표' })
    const { v, st } = await flowOf(id)
    assert.equal(v.case.status, 'rejected'); assert.equal(st.outcome, 'rejected'); assert.equal(st.edges['redecide->rethinkAlloc'], 'taken')
  })
  await t('300억 대상이 아닌 안건과 다른 승인권자의 부결은 그대로 부결이다', async () => {
    const id = await readyCase('CMP-0009', false)
    const ap = (await E.getCaseView(sql, id)).approvals.find((a) => a.status === 'pending')
    assert.equal(ap.requiredRole, 'masil_ceo')
    await E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'masil_ceo', byName: '대표' })
    const { v, def } = await flowOf(id)
    assert.equal(v.case.status, 'rejected'); assert.ok(!def.nodes.some((x) => x.id === 'redecide'))
  })
  console.log(`\n${n}개 시험 모두 통과`)
  process.exit(0)
} catch (e) {
  console.error(e)
  process.exit(1)
}
