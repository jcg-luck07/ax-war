// 그룹 300억 배분 대상 안건 시험.  node --import ./scripts/_register.mjs scripts/test-group300.mjs
//  · 재무팀이 300억 대상으로 정하면 CEO/이사회가 결정한다. 승인 = 최종 승인.
//  · CEO/이사회가 부결하면 그대로 부결(집행 중단 처리). 재결정 단계는 없다.
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

  await t('300억 대상으로 정하면 CEO/이사회가 승인권자이고, 업무 흐름표에는 CEO/이사회 결정 단계가 있고 재결정 단계는 없다', async () => {
    const id = await readyCase('CMP-0004', true)
    const { v, def, st } = await flowOf(id)
    assert.equal(v.case.authority, 'ceo_board'); assert.equal(v.approvals.find((a) => a.status === 'pending').requiredRole, 'ceo_board')
    assert.ok(!def.nodes.some((x) => x.id === 'redecide'))
    assert.equal(st.nodes.decide, 'current')
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
    assert.equal(v.case.status, 'approved'); assert.equal(st.outcome, 'approved')
  })
  await t('CEO/이사회가 부결하면 그대로 부결이고 집행 중단 처리로 이어진다 (재결정 단계 없음)', async () => {
    const id = await readyCase('CMP-0006', true)
    const ap = (await E.getCaseView(sql, id)).approvals.find((a) => a.status === 'pending')
    const r = await E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'ceo_board', byName: 'CEO', comment: '부결' })
    assert.equal(r.statusAfter, 'rejected')
    const { v, st } = await flowOf(id)
    assert.equal(v.case.status, 'rejected'); assert.equal(st.outcome, 'rejected'); assert.equal(st.edges['decide->rethinkAlloc'], 'taken')
    assert.equal(v.approvals.find((a) => a.id === ap.id).status, 'rejected')
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
