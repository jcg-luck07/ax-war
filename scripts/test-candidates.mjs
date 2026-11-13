// 미확정(후보) 안건 시험.  node --import ./scripts/_register.mjs scripts/test-candidates.mjs
// ⚠️ 로컬 시험 DB(_test)의 안건·이력을 모두 지운다.
import assert from 'node:assert/strict'
import * as E from '@/lib/engine/engine'
import { getEngine } from '@/lib/app/engine'
import { acceptSubmission, checksFor, fileCheckId, listFiles, submitIntake } from '@/lib/modules/intake/submissions'
import { addCaseFile } from '@/lib/modules/w02/handoff'
import { addCandidate, changeCandidates, confirmCandidates, getCandidate, groupKey, groupLabel, listCandidates, removeCandidates } from '@/lib/modules/w02/candidates'

const { sql, cfg } = await getEngine()
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const user = (roles, name = '시험') => ({ authenticated: true, email: 'x', name, roles, isAdmin: false })
const finance = user(['finance'], '재무'), contract = user(['contract_mgr'], '계약'), member = user(['marketing_member'], '팀원'), masil = user(['masil_ceo'], '대표'), ceo = user(['ceo_board'], 'CEO')
const CONTRIB = { gmv: '100000000', refund: '10000000', cogs: '30000000', channelFee: '7000000', shipping: '4000000', returnLogistics: '1000000' }
const files = ['draft', 'estimate', 'contract'].map((k) => ({ kind: k, filename: `${k}.txt`, mime: 'text/plain', content: Buffer.from(k) }))
const newCase = async (refId, requested = '15000000') => {
  const s = await submitIntake(sql, { category: 'campaign', refId, values: { settlementDate: '2026-09-10', contractDeadline: '2026-07-10', requested, memo: '', ...CONTRIB }, files, by: '팀원' })
  const checks = [...checksFor('campaign', false).map((c) => c.id), ...(await listFiles(sql, s.id)).map((f) => fileCheckId(f.id))]
  return (await acceptSubmission(sql, cfg, s.id, '팀장', checks)).caseId
}
const snapshot = async (id) => {
  const v = await E.getCaseView(sql, id)
  return JSON.stringify({ status: v.case.status, tasks: v.tasks.map((x) => [x.id, x.status]), ap: v.approvals.map((x) => [x.id, x.status]), ev: v.events.length })
}

try {
  await E.resetEngineData(sql)
  const a = await newCase('CMP-0004'), b = await newCase('CMP-0005'), c = await newCase('CMP-0006')

  await t('후보로 넣어도 안건의 진행 상태·작업·승인·이력은 바뀌지 않는다 (분류 이름이 목적지를 담는다)', async () => {
    const before = await snapshot(a)
    const r = await addCandidate(sql, finance, { caseId: a, kind: 'proceed', params: { linked: false } })
    assert.equal(r.target, '계약 담당')
    assert.equal(await snapshot(a), before)
    const cand = await getCandidate(sql, a)
    assert.equal(cand.kind, 'proceed'); assert.equal(groupKey(cand), 'proceed:계약 담당'); assert.equal(groupLabel(groupKey(cand)), '회부 후보 — 계약 담당')
  })
  await t('권한·단계: 그 단계를 맡은 역할만 후보로 넣을 수 있고, 아직 승인 단계가 아니면 승인 후보로 넣을 수 없다', async () => {
    await assert.rejects(() => addCandidate(sql, member, { caseId: b, kind: 'proceed', params: { linked: false } }), /재무팀이 처리|내 역할/)
    await assert.rejects(() => addCandidate(sql, contract, { caseId: b, kind: 'proceed', params: {} }), /재무팀이 처리|내 역할/)
    await assert.rejects(() => addCandidate(sql, masil, { caseId: b, kind: 'approve' }), /승인 결정 단계|앞 단계/)
    await assert.rejects(() => addCandidate(sql, finance, { caseId: b, kind: 'proceed', params: {} }), /300억/)
    await assert.rejects(() => addCandidate(sql, finance, { caseId: b, kind: 'rework', params: { toRole: '재무' } }), /보완을 요청할 수 있는 팀/)
    assert.equal(await getCandidate(sql, b), null)
  })
  await t('한 안건에는 후보가 하나 — 다른 후보로 넣으면 바뀐다 (보완요청 후보 → 회부 후보)', async () => {
    await addCandidate(sql, finance, { caseId: b, kind: 'rework', params: { toRole: '마케팅', note: '반품률 근거 보완' } })
    assert.equal(groupKey(await getCandidate(sql, b)), 'rework:마케팅팀')
    await addCandidate(sql, finance, { caseId: b, kind: 'proceed', params: { linked: false } })
    assert.equal((await listCandidates(sql)).filter((x) => x.caseId === b).length, 1)
    assert.equal(groupKey(await getCandidate(sql, b)), 'proceed:계약 담당')
  })
  await t('여러 안건을 다른 후보로 한꺼번에 바꾼다 (한 건이 안 되면 그 건만 실패)', async () => {
    const res = await changeCandidates(sql, finance, [a, b, 99999], 'rework', { toRole: '마케팅', note: '' })
    assert.deepEqual(res.map((x) => x.ok), [true, true, false])
    assert.equal(groupKey(await getCandidate(sql, a)), 'rework:마케팅팀')
    await changeCandidates(sql, finance, [a, b], 'proceed', { linked: false })
  })
  await t('확정(재무 회부): 안건 상태가 실제로 바뀌고 후보에서 빠진다. 권한이 없는 사람은 확정할 수 없고 후보는 그대로 남는다', async () => {
    const [bad] = await confirmCandidates(sql, cfg, member, [a])
    assert.equal(bad.ok, false); assert.ok(await getCandidate(sql, a))
    const res = await confirmCandidates(sql, cfg, finance, [a, b])
    assert.deepEqual(res.map((x) => x.ok), [true, true])
    assert.equal(await getCandidate(sql, a), null)
    const v = await E.getCaseView(sql, a)
    assert.ok(!v.tasks.some((x) => x.status === 'open' && x.detail.key === 'collect-performance'))
    assert.ok(v.tasks.some((x) => x.status === 'open' && x.detail.key === 'confirm-terms'))
  })
  await t('계약 담당 회부 후보: 계약서가 없으면 확정이 막히고 후보가 남는다. 계약서를 올리면 승인권자에게 넘어간다', async () => {
    const r = await addCandidate(sql, contract, { caseId: a, kind: 'proceed', params: {} })
    assert.match(r.target, /Masil 대표|CEO/)
    const [bad] = await confirmCandidates(sql, cfg, contract, [a])
    assert.equal(bad.ok, false); assert.match(bad.message, /계약서/); assert.ok(await getCandidate(sql, a))
    await addCaseFile(sql, { caseId: a, kind: 'contract', filename: 'c.pdf', mime: 'application/pdf', content: Buffer.from('x'), by: '계약' })
    const [ok] = await confirmCandidates(sql, cfg, contract, [a])
    assert.equal(ok.ok, true); assert.equal(await getCandidate(sql, a), null)
  })
  await t('승인·부결·재검토 후보: 승인권자만 넣고 확정할 수 있고, 확정하면 안건이 결정된다 (후보 단계에서는 상태가 그대로)', async () => {
    const before = await snapshot(a)
    await assert.rejects(() => addCandidate(sql, member, { caseId: a, kind: 'approve' }), /내 역할/)
    await assert.rejects(() => addCandidate(sql, ceo, { caseId: a, kind: 'approve' }), /내 역할/)
    await addCandidate(sql, masil, { caseId: a, kind: 'approve', params: { comment: '공헌이익 양호' } })
    assert.equal(await snapshot(a), before)
    assert.equal(groupLabel(groupKey(await getCandidate(sql, a))), '승인 후보')
    await changeCandidates(sql, masil, [a], 'reject', { comment: '철회' })
    assert.equal(groupLabel(groupKey(await getCandidate(sql, a))), '부결 후보')
    const [r] = await confirmCandidates(sql, cfg, masil, [a])
    assert.equal(r.ok, true)
    const v = await E.getCaseView(sql, a)
    assert.equal(v.case.status, 'rejected'); assert.equal(await getCandidate(sql, a), null)
  })
  await t('후보에서 빼기', async () => {
    await addCandidate(sql, finance, { caseId: c, kind: 'proceed', params: { linked: true } })
    assert.equal(await removeCandidates(sql, [c]), 1)
    assert.equal(await getCandidate(sql, c), null)
  })
  console.log(`\n${n}개 시험 모두 통과`)
  process.exit(0)
} catch (e) {
  console.error(e)
  process.exit(1)
}
