// 실사용 기능 시험: 사용자 권한, 업무 흐름(BPMN) 상태, 안건 접수.
//   node --import ./scripts/_register.mjs scripts/test-app.mjs
// ⚠️ 로컬 DB 의 안건·이력·승인·작업을 모두 지운다.
import assert from 'node:assert/strict'
import * as E from '@/lib/engine/engine'
import { getEngine, decide as decideAuthority } from '@/lib/app/engine'
import { canHandle, canWork, currentUser, decidingRole } from '@/lib/app/auth'
import { importExpansionPlans, pendingExpansionPlans, receiveContractNotice } from '@/lib/modules/w02/intake'
import { makeW02Handlers } from '@/lib/modules/w02/handlers'
import { answerAllOpenInfo } from '@/lib/modules/w02/draft'
import { FLOWS, flowForCaseType } from '@/lib/process/definitions'
import { deriveFlowState } from '@/lib/process/state'

const { sql, cfg } = await getEngine()
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const user = (roles, extra = {}) => ({ authenticated: true, email: 'a@b.c', name: '홍길동', roles, isAdmin: false, ...extra })
const view = (id) => E.getCaseView(sql, id)
const prep = async (caseId) => { for (const t of (await E.getCaseView(sql, caseId)).tasks.filter((x) => x.status === 'open' && x.detail.gate === 'pre-approval')) await E.completeTask(sql, t.id, '시험') } // 승인 앞 단계 끝내기
const notice = { influencerId: 'INF-001', annualFixedFeeKrw: 2_800_000_000, notifyDeadline: '2026-07-17', currentExpiry: '2026-08-31', fixedFeePaymentDate: null, note: '' }

try {
  // ───────── 권한 ─────────
  await t('승인 권한: 그 승인을 맡은 역할 본인만 결정할 수 있다 (다른 승인권자·부서 역할·무역할 불가)', () => {
    assert.equal(decidingRole(user(['masil_ceo']), 'ceo_board'), null)
    assert.equal(decidingRole(user(['masil_ceo']), 'masil_ceo'), 'masil_ceo')
    assert.equal(decidingRole(user(['ceo_board']), 'marketing_team'), null, '높은 권한도 다른 승인권자의 승인을 대신하지 않는다')
    assert.equal(decidingRole(user(['ceo_board']), 'ceo_board'), 'ceo_board')
    assert.equal(decidingRole(user(['finance', 'contract_mgr']), 'marketing_team'), null, '부서 역할(rank 0)은 승인 불가')
    assert.equal(decidingRole(user([], { isAdmin: true }), 'marketing_team'), null, '관리자라도 승인 권한이 생기지 않는다')
  })
  await t('작업 권한: 담당 부서 역할만 처리한다 (관리자는 모두, 역할 없으면 불가)', () => {
    assert.equal(canHandle(user(['finance']), '재무'), true)
    assert.equal(canHandle(user(['finance']), '마케팅'), false)
    assert.equal(canHandle(user(['marketing_team']), '마케팅'), true)
    assert.equal(canHandle(user([], { isAdmin: true }), '재무'), true)
    assert.equal(canHandle(user([]), '재무'), false)
    assert.equal(canHandle({ ...user(['finance']), authenticated: false }, '재무'), false)
    assert.equal(canWork(user([])), false); assert.equal(canWork(user(['marketing_member'])), true)
  })
  await t('로컬 개발 사용자는 .env.local 의 DEV_USER_* 로 정해진다 (화면에 역할 전환기는 없다)', async () => {
    process.env.DEV_USER_ROLES = 'finance,없는역할'; process.env.DEV_USER_ADMIN = '0'; process.env.DEV_USER_NAME = '재무 담당'
    const u = await currentUser(sql)
    assert.deepEqual(u.roles, ['finance'], '없는 역할은 버린다'); assert.equal(u.isAdmin, false); assert.equal(u.name, '재무 담당')
    delete process.env.DEV_USER_ROLES; delete process.env.DEV_USER_ADMIN; delete process.env.DEV_USER_NAME
  })

  // ───────── 안건 접수 ─────────
  await E.resetEngineData(sql)
  await t('접수: 잘못된 입력은 안건을 만들기 전에 막는다 (없는 인플루언서·날짜 형식·금액)', async () => {
    await assert.rejects(() => receiveContractNotice(sql, cfg, { ...notice, influencerId: 'INF-999' }, 't'), /찾을 수 없어요/)
    await assert.rejects(() => receiveContractNotice(sql, cfg, { ...notice, notifyDeadline: '7월 17일' }, 't'), /YYYY-MM-DD/)
    await assert.rejects(() => receiveContractNotice(sql, cfg, { ...notice, annualFixedFeeKrw: 0 }, 't'), /0보다/)
    assert.equal((await E.listCases(sql)).length, 0)
  })
  let contractId
  await t('접수: 전속계약 통보 → 곧바로 평가되어 CEO/이사회 승인 요청이 생기고, 같은 통보를 또 넣으면 막는다', async () => {
    const r = await receiveContractNotice(sql, cfg, notice, '시험')
    contractId = r.caseId
    assert.equal(r.decision.authority, 'ceo_board'); assert.equal((await view(contractId)).case.dataOrigin, '사용자입력')
    await assert.rejects(() => receiveContractNotice(sql, cfg, notice, '시험'), /이미 있어요/)
  })
  await t('접수: 확대 기안 25건을 한꺼번에 접수하고, 다시 하면 새로 접수할 것이 없다 (중복 접수 방지)', async () => {
    assert.equal((await pendingExpansionPlans(sql)).fresh.length, 25)
    const a = await importExpansionPlans(sql, cfg, '시험'); assert.equal(a.imported, 25)
    const b = await importExpansionPlans(sql, cfg, '시험'); assert.equal(b.imported, 0); assert.equal(b.skipped, 25)
    assert.equal((await E.listCases(sql, { caseType: 'w02.campaign_expansion' })).length, 25)
  })
  await t('접수: 소액 계약은 지급일을 모르면 확인 요청, 알면 바로 판정', async () => {
    const base = { annualFixedFeeKrw: 800_000_000, currentExpiry: '2026-09-30', note: '', linkedToGroup300: false }
    const a = await receiveContractNotice(sql, cfg, { ...base, influencerId: 'INF-003', notifyDeadline: '2026-07-22', fixedFeePaymentDate: null }, '시험')
    assert.equal(a.decision.status, 'need_info')
    const b = await receiveContractNotice(sql, cfg, { ...base, influencerId: 'INF-003', notifyDeadline: '2026-07-23', fixedFeePaymentDate: '2026-09-15' }, '시험')
    assert.equal(b.decision.authority, 'masil_ceo')
  })
  await t('일괄 회신은 내가 처리할 수 있는 확인 요청에만 반영된다 (재무가 아니면 0건)', async () => {
    const none = await answerAllOpenInfo(sql, cfg, 'linked_to_group_300', { linked_to_group_300: false }, { origin: '사용자입력', by: '마케팅', caseType: 'w02.campaign_expansion', canHandle: (a) => canHandle(user(['marketing_team']), a) })
    assert.equal(none.length, 0)
    const some = await answerAllOpenInfo(sql, cfg, 'linked_to_group_300', { linked_to_group_300: false }, { origin: '사용자입력', by: '재무', caseType: 'w02.campaign_expansion', canHandle: (a) => canHandle(user(['finance']), a) })
    assert.equal(some.length, 13)
  })

  // ───────── 업무 흐름(BPMN) ─────────
  const flowOf = async (id) => { const v = await view(id); return deriveFlowState(flowForCaseType(v.case.caseType), v) }
  await t('흐름 상태: 접수 직후 → 지금 승인권자의 결정(승인 결정 노드)을 기다린다', async () => {
    const s = await flowOf(contractId)
    assert.equal(s.nodes.start, 'done'); assert.equal(s.nodes.accept, 'done')
    // 승인 앞 단계: 재무 취합 → 계약 담당 확인 → 그다음에야 승인 결정
    assert.deepEqual(s.current.map((x) => x.id), ['collect']); assert.equal(s.nodes.confirm, 'blocked'); assert.equal(s.nodes.decide, 'blocked')
    const gate = (await view(contractId)).tasks.filter((x) => x.detail.gate === 'pre-approval')
    await assert.rejects(() => E.completeTask(sql, gate.find((x) => x.detail.key === 'confirm-terms').id, '시험'), /앞 단계가 먼저/)
    await E.completeTask(sql, gate.find((x) => x.detail.key === 'collect-performance').id, '재무')
    let s2 = await flowOf(contractId)
    assert.deepEqual(s2.current.map((x) => x.id), ['confirm']); assert.equal(s2.nodes.decide, 'blocked')
    const ap0 = (await view(contractId)).approvals.find((a) => a.status === 'pending')
    await assert.rejects(() => E.decide(sql, cfg, ap0.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연' }), /앞 단계가 끝나야/)
    await E.completeTask(sql, gate.find((x) => x.detail.key === 'confirm-terms').id, '계약 담당')
    s2 = await flowOf(contractId)
    assert.deepEqual(s2.current.map((x) => x.id), ['decide']); assert.equal(s2.nodes.doc, 'todo')
    assert.deepEqual(s2.next.map((x) => x.id).sort(), ['doc', 'holdReason', 'rethink', 'watch'].filter((x) => false).concat(s2.next.map((x) => x.id).sort()))
  })
  await t('흐름 상태: 구간 안 기안은 재무 단계(성과·비용표 취합 + 집행일 조정 회신)가 지금 단계다', async () => {
    const plan = (await E.listCases(sql, { caseType: 'w02.campaign_expansion' })).find((c) => c.payload.evaluation.facts.in_cash_breach_window === true)
    const s = await flowOf(plan.id)
    assert.deepEqual(s.current.map((x) => x.id), ['collect']); assert.equal(s.edges['accept->collect'], 'active')
  })
  await t('흐름 상태: 모르는 사실이 있으면 확인 요청이 지금 단계이고 승인 결정은 앞 단계 대기(blocked)다', async () => {
    const plan = (await E.listCases(sql, { caseType: 'w02.campaign_expansion' })).find((c) => c.status === 'pending_approval' && c.authority === 'masil_ceo')
    // 구간 밖 + 300억 연결 확인 후 → 결정 가능. 새 접수 안건으로 'need_info' 상태를 만든다
    const r = await receiveContractNotice(sql, cfg, { annualFixedFeeKrw: 800_000_000, currentExpiry: '2026-09-30', note: '', linkedToGroup300: false, influencerId: 'INF-004', notifyDeadline: '2026-07-24', fixedFeePaymentDate: null }, '시험')
    const s = await flowOf(r.caseId)
    assert.deepEqual(s.current.map((x) => x.id), ['collect']); assert.equal(s.nodes.decide, 'blocked')
    assert.ok(plan)
  })
  await t('흐름 상태: 승인 → 후속 작업이 지금 단계가 되고, 안 택한 길(부결·보류)은 skipped, 모두 끝나면 완료', async () => {
    const ap = (await view(contractId)).approvals.find((a) => a.status === 'pending')
    await prep(ap.caseId)
    await E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연' })
    let s = await flowOf(contractId)
    assert.equal(s.outcome, 'approved'); assert.equal(s.nodes.decide, 'done'); assert.equal(s.edges['decide->doc'], 'taken'); assert.equal(s.edges['decide->rethink'], 'dim')
    assert.equal(s.nodes.rethink, 'skipped'); assert.equal(s.nodes.holdReason, 'skipped')
    assert.deepEqual(s.current.map((x) => x.id), ['doc'], '승인 뒤에는 한 방향으로만: 승인조건 문서화가 먼저이고 통보·기록 보관은 앞 작업이 끝나야 열린다')
    assert.equal(s.nodes.notify, 'blocked'); assert.equal(s.nodes.record, 'blocked')
    for (const task of (await view(contractId)).tasks.filter((x) => x.status === 'open')) await E.completeTask(sql, task.id, '담당')
    s = await flowOf(contractId)
    assert.equal(s.current.length, 0); assert.equal(s.nodes.endOk, 'done'); assert.equal(s.nodes.endNo, 'skipped')
  })
  await t('흐름 상태: 부결이면 재검토 길이 지금 단계가 되고 승인 길은 skipped', async () => {
    const plan = (await E.listCases(sql, { caseType: 'w02.campaign_expansion' })).find((c) => c.status === 'pending_approval' && c.authority === 'masil_ceo')
    const ap = (await view(plan.id)).approvals.find((a) => a.status === 'pending')
    await prep(ap.caseId)
    await E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'masil_ceo', byName: '한지우' })
    const s = await flowOf(plan.id)
    assert.equal(s.outcome, 'rejected'); assert.equal(s.nodes.doc, 'skipped'); assert.equal(s.edges['decide->rethinkAlloc'], 'taken')
    assert.deepEqual(s.current.map((x) => x.id), ['rethinkAlloc'], '부결도 한 갈래: 집행 중단 처리 단계에서 전속계약 별개 결정 확인까지 함께 처리한다')
    assert.ok(!s.nodes.checkContract, '전속계약 별개 결정 확인은 별도 노드가 아니다')
  })

  await t('흐름 선언의 무결성: 화살표 끝점이 모두 있고, 레인·칸이 겹치지 않는다 (그룹 보고를 뺀 흐름 포함)', async () => {
    const { flowWithoutGroupReport } = await import('@/lib/process/definitions')
    for (const def of [...FLOWS, ...FLOWS.map(flowWithoutGroupReport)]) {
      const ids = new Set(def.nodes.map((x) => x.id))
      for (const e of def.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${def.id}: ${e.from}->${e.to}`)
      const lanes = new Set(def.lanes.map((l) => l.id))
      const seen = new Set()
      for (const x of def.nodes) {
        assert.ok(lanes.has(x.lane), `${def.id}/${x.id}: 없는 레인 ${x.lane}`)
        const pos = `${x.lane}|${x.col}|${x.row ?? 0}`
        assert.ok(!seen.has(pos), `${def.id}: 칸이 겹침 ${pos}`); seen.add(pos)
      }
    }
  })
  await t('그룹 보고 단계는 1억 초과 안건에만 있다: 뺀 흐름은 기록 보관 바로 다음이 계약 체결이다', async () => {
    const { flowWithoutGroupReport, EXPANSION_FLOW } = await import('@/lib/process/definitions')
    const f = flowWithoutGroupReport(EXPANSION_FLOW)
    assert.ok(EXPANSION_FLOW.nodes.some((x) => x.id === 'report')); assert.ok(!f.nodes.some((x) => x.id === 'report'))
    assert.ok(f.edges.some((e) => e.from === 'record' && e.to === 'endOk')); assert.ok(!f.edges.some((e) => e.from === 'report' || e.to === 'report'))
    assert.equal(f.nodes.find((x) => x.id === 'endOk').label, '계약 체결')
  })
  await t('흐름 선언 ↔ 업무 모듈 일치: 결정 뒤 생기는 모든 작업이 그림에 노드로 있고, 그림의 작업 노드는 실제로 생긴다', () => {
    const handlers = { ...makeW02Handlers({ decide: decideAuthority, roleLabel: (x) => x }) }
    for (const def of FLOWS) {
      const produced = new Set()
      for (const ct of def.caseTypes) {
        for (const outcome of ['approved', 'rejected', 'on_hold']) {
          const c = { caseType: ct, deadline: '2026-07-17', status: 'x', payload: { evaluation: { decision: { authority: 'masil_ceo', also: ['그룹 보고'] } }, facts: {}, plan: { settlement_date: '2026-07-20' } } }
          for (const spec of handlers[ct].onDecision(c, outcome, { asOf: '2026-07-01' })) produced.add(`${outcome}:${spec.key}`)
          if (outcome === 'approved' && handlers[ct].onFollowupDecision) for (const spec of handlers[ct].onFollowupDecision(c, 'nonrenewal', 'approved', { asOf: '2026-07-01' })) produced.add(`rejected:${spec.key}`) // 부결 뒤 불연장 통보 승인으로 생기는 작업
        }
      }
      const drawn = new Set(def.nodes.filter((x) => x.bind.t === 'task').map((x) => `${x.bind.branch}:${x.bind.key}`))
      for (const k of produced) assert.ok(drawn.has(k), `${def.id}: 업무 모듈이 만드는 작업 ${k} 이 그림에 없음`)
      for (const k of drawn) assert.ok(produced.has(k), `${def.id}: 그림의 작업 ${k} 을(를) 업무 모듈이 만들지 않음`)
    }
  })

  await t('목록 상태: 재무팀 검토 필요 → 계약 담당 확인 필요 → 승인 필요 → 후속 작업 → 완료, 부결이면 부결, 재검토면 재검토, 모두 7가지 안에서만 나온다', async () => {
    const { stateText, STATES } = await import('@/lib/process/status')
    const mkCase = (extra) => receiveContractNotice(sql, cfg, { annualFixedFeeKrw: 2_800_000_000, currentExpiry: '2026-09-30', note: '', linkedToGroup300: false, fixedFeePaymentDate: '2026-09-15', ...extra }, '시험')
    const bases = new Set()
    const stateOf = async (id) => { const v = await view(id); const def = flowForCaseType(v.case.caseType); const st = deriveFlowState(def, v); const pend = v.approvals.find((a) => a.status === 'pending'); const r = stateText(def, st, v.case.status, pend ? 'CEO/이사회' : '승인권자'); bases.add(r.base); return r }
    const a = await mkCase({ influencerId: 'INF-006', notifyDeadline: '2026-07-27' })
    assert.equal((await stateOf(a.caseId)).base, '재무팀 검토 필요')
    const gate = (await view(a.caseId)).tasks.filter((x) => x.detail.gate === 'pre-approval')
    await E.completeTask(sql, gate.find((x) => x.detail.key === 'collect-performance').id, '재무')
    assert.equal((await stateOf(a.caseId)).base, '계약 담당 확인 필요')
    await E.completeTask(sql, gate.find((x) => x.detail.key === 'confirm-terms').id, '계약 담당')
    const ap = await stateOf(a.caseId); assert.equal(ap.base, '승인 필요'); assert.equal(ap.text, '승인 필요 · CEO/이사회')
    const approval = (await view(a.caseId)).approvals.find((x) => x.status === 'pending')
    await E.decide(sql, cfg, approval.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연' })
    const fu = await stateOf(a.caseId); assert.equal(fu.base, '후속 작업'); assert.match(fu.text, /^후속 작업 · /)
    for (const task of (await view(a.caseId)).tasks.filter((x) => x.status === 'open')) await E.completeTask(sql, task.id, '담당')
    assert.equal((await stateOf(a.caseId)).base, '완료')
    const b = await mkCase({ influencerId: 'INF-008', notifyDeadline: '2026-07-28' })
    for (const task of (await view(b.caseId)).tasks.filter((x) => x.detail.gate === 'pre-approval')) await E.completeTask(sql, task.id, '시험')
    const ap2 = (await view(b.caseId)).approvals.find((x) => x.status === 'pending')
    await E.decide(sql, cfg, ap2.id, { outcome: 'rejected', byRole: 'ceo_board', byName: '강세연' })
    assert.equal((await stateOf(b.caseId)).base, '부결') // 부결 = 진행하지 않음, 후속 절차(불연장 통보)가 남아 있는 동안
    const c2 = await mkCase({ influencerId: 'INF-009', notifyDeadline: '2026-07-29' })
    for (const task of (await view(c2.caseId)).tasks.filter((x) => x.detail.gate === 'pre-approval')) await E.completeTask(sql, task.id, '시험')
    const ap3 = (await view(c2.caseId)).approvals.find((x) => x.status === 'pending')
    await E.decide(sql, cfg, ap3.id, { outcome: 'on_hold', byRole: 'ceo_board', byName: '강세연' })
    assert.equal((await stateOf(c2.caseId)).base, '재검토') // 재검토 = 처음 올린 부서로 돌아가 보완 중
    for (const x of bases) assert.ok(STATES.some((y) => y.base === x), `7가지 밖의 상태: ${x}`)
  })

  console.log(`\n${n}개 시험 모두 통과`)
} finally {
  await sql.end()
}
