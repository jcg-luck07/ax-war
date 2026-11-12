// W02 세 가지 시연 상황을 실제 원본 데이터·DB·엔진으로 끝까지 돌린다.
//   node --import ./scripts/_register.mjs scripts/test-w02.mjs
// ⚠️ 로컬 DB 의 안건·이력·승인·작업을 모두 지우고 시작한다(원본 복사본 source_rows 는 유지).
import assert from 'node:assert/strict'
import * as E from '@/lib/engine/engine'
import { getEngine } from '@/lib/app/engine'
import { importExpansionPlans, receiveContractNotice } from '@/lib/modules/w02/intake'
import { answerAllOpenInfo } from '@/lib/modules/w02/draft'
import { CONTRACT_CASE_TYPE, EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'

const { sql, cfg, cash } = await getEngine()
// 안건 접수: 통보서 값으로 전속계약, 기안 파일에서 확대 기안 25건
const seedW02 = async () => {
  const contract = await receiveContractNotice(sql, cfg, { influencerId: 'INF-001', annualFixedFeeKrw: 2_800_000_000, notifyDeadline: '2026-07-17', currentExpiry: '2026-08-31', fixedFeePaymentDate: null, note: '' }, '시험')
  const r = await importExpansionPlans(sql, cfg, '시험')
  return { contract, plans: { length: r.imported } }
}
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const view = (id) => E.getCaseView(sql, id)
const prep = async (caseId) => { for (const t of (await E.getCaseView(sql, caseId)).tasks.filter((x) => x.status === 'open' && x.detail.gate === 'pre-approval')) await E.completeTask(sql, t.id, '시험') } // 승인 앞 단계 끝내기
const find = async (type, pred = () => true) => (await E.listCases(sql, { caseType: type })).find(pred)
const planCase = async (planId) => find(EXPANSION_CASE_TYPE, (c) => c.subjectRefs.plan === planId)
const infoTask = async (id, fact) => (await view(id)).tasks.find((x) => x.taskType === 'info_request' && x.status === 'open' && x.detail.fact === fact)

try {
  await E.resetEngineData(sql)

  console.log('현금 하회 구간(기준선):', cash.windows.map((w) => `${w.start}~${w.end}`).join(', '), `· 최저 ${(cash.minBalance / 1e8).toFixed(2)}억\n`)

  let contractId
  await t('접수: 전속계약 1건 + 확대 기안 25건이 접수·평가된다', async () => {
    const r = await seedW02()
    contractId = r.contract.caseId
    assert.equal(r.plans.length, 25)
    const all = await E.listCases(sql)
    assert.equal(all.length, 26)
    const by = {}
    for (const c of all) { const k = `${c.caseType.split('.')[1]}|${c.status}|${c.authority}`; by[k] = (by[k] ?? 0) + 1 }
    console.log('   분포:', JSON.stringify(by))
    assert.equal(r.contract.decision.authority, 'ceo_board'); assert.equal(r.contract.statusAfter, 'pending_approval')
  })

  await t('근거: 기안 총액 1.81억(>1억) → 건당 금액이 작아도 대표급 이상, 구간 안이면 CEO/이사회, 구간 밖은 300억 연결 여부 확인 필요', async () => {
    const plans = await E.listCases(sql, { caseType: EXPANSION_CASE_TYPE })
    const inWin = plans.filter((p) => p.payload.evaluation.facts.in_cash_breach_window === true)
    const outWin = plans.filter((p) => p.payload.evaluation.facts.in_cash_breach_window === false)
    assert.ok(inWin.length > 0 && outWin.length > 0)
    assert.ok(inWin.every((p) => p.authority === 'ceo_board' && p.status === 'pending_approval'))
    assert.ok(outWin.every((p) => p.status === 'need_info'))
    console.log(`   구간 안 ${inWin.length}건 → CEO/이사회 / 구간 밖 ${outWin.length}건 → 확인 필요(300억 연결 여부)`)
  })

  // ───────────── 상황 1: 정상 ─────────────
  await t('[상황 1 정상] 계약: CEO/이사회 승인 → 후속 작업 3개 → 모두 완료하면 안건이 닫힌다', async () => {
    const ap = (await view(contractId)).approvals.find((a) => a.status === 'pending')
    await assert.rejects(() => E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'masil_ceo', byName: '한지우' }), /권한이 부족/)
    await prep(ap.caseId)
    const d = await E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연', comment: '실질 공헌이익 확인 후 조건 변경 통보' })
    assert.equal(d.statusAfter, 'approved'); assert.equal(d.taskIds.length, 3)
    const v = await view(contractId)
    assert.deepEqual(v.tasks.filter((x) => x.status === 'open').map((x) => x.assigneeRole).sort(), ['계약 담당', '계약 담당', '마케팅'])
    assert.ok(v.tasks.every((x) => x.dueDate === '2026-07-17'))
    for (const task of v.tasks.filter((x) => x.status === 'open')) await E.completeTask(sql, task.id, task.assigneeRole)
    assert.equal((await view(contractId)).case.status, 'closed')
  })

  // ───────────── 상황 2: 조건 변경 (+재시드로 독립) ─────────────
  await E.resetEngineData(sql)
  const s2 = await seedW02()
  contractId = s2.contract.caseId

  await t('[상황 2 조건 변경 A] 고정 피 28억→20억: 여전히 10억 초과 → 결론 유지, 같은 승인 요청이 그대로 유효', async () => {
    const before = (await view(contractId)).approvals.find((a) => a.status === 'pending')
    const r = await E.updateFacts(sql, cfg, contractId, { patch: { annual_contract_value_krw: 2_000_000_000 }, reason: '혜인 측 고정 피 인하 제안(20억)', origin: '사용자입력', by: '계약 담당' })
    assert.equal(r.authorityChanged, false); assert.equal(r.decision.authority, 'ceo_board')
    const after = (await view(contractId)).approvals.find((a) => a.status === 'pending')
    assert.equal(after.id, before.id, '승인 요청이 새로 만들어지지 않고 유지됨')
    assert.deepEqual(Object.keys(r.changedFacts), ['annual_contract_value_krw'])
  })

  await t('[상황 2 조건 변경 B] 고정 피 20억→8억: 10억 이하라 Masil 대표 전결이 되려 하지만, 현금 유출일·300억 연결 여부를 모르면 확정 불가 → 기존 승인 요청은 대체되고 확인 요청 2건', async () => {
    const r = await E.updateFacts(sql, cfg, contractId, { patch: { annual_contract_value_krw: 800_000_000 }, reason: '혜인 측 추가 인하 제안(8억)', origin: '사용자입력', by: '계약 담당' })
    assert.equal(r.authorityChanged, true); assert.equal(r.decision.status, 'need_info')
    const v = await view(contractId)
    assert.equal(v.approvals.filter((a) => a.status === 'pending').length, 0)
    const open = v.tasks.filter((x) => x.taskType === 'info_request' && x.status === 'open').map((x) => x.detail.fact).sort()
    assert.deepEqual(open, ['in_cash_breach_window', 'linked_to_group_300'])
  })

  // ───────────── 상황 3: 정보 부족 → 회신 → 이어서 처리 ─────────────
  await t('[상황 3 정보 부족] 재무 회신(고정 피 지급일 9/15 = 하회 구간 밖)만으로는 부족 — 300억 연결 여부가 남아 계속 확인 필요', async () => {
    const task = await infoTask(contractId, 'in_cash_breach_window')
    const r = await E.provideInfo(sql, cfg, task.id, { answers: { fixed_fee_payment_date: '2026-09-15' }, origin: '사용자입력', by: '재무팀(모의)' })
    assert.equal(r.decision.status, 'need_info')
    assert.deepEqual(r.decision.unresolved.map((u) => u.missingFacts).flat(), ['linked_to_group_300'])
  })
  await t('[상황 3 이어서] 300억과 무관하다는 회신 → 재평가 → Masil 대표로 확정, 새 승인 요청', async () => {
    const task = await infoTask(contractId, 'linked_to_group_300')
    const r = await E.provideInfo(sql, cfg, task.id, { answers: { linked_to_group_300: false }, origin: '사용자입력', by: '재무팀(모의)' })
    assert.equal(r.decision.status, 'decided'); assert.equal(r.decision.authority, 'masil_ceo')
    const ap = (await view(contractId)).approvals.find((a) => a.status === 'pending')
    assert.equal(ap.requiredRole, 'masil_ceo')
  })
  await t('[상황 3 반대 회신] 같은 질문에 "지급일 7/28(하회 구간 안)"이라고 답했다면 → CEO/이사회 (금액 8억이어도)', async () => {
    const r0 = await E.openCase(sql, cfg, { caseType: CONTRACT_CASE_TYPE, title: '시험용 8억 계약', deadline: '2026-07-17', payload: { facts: { annual_contract_value_krw: 800_000_000, creates_cash_outflow: true, fixed_fee_payment_date: null, linked_to_group_300: false } } })
    assert.equal(r0.decision.status, 'need_info')
    const task = await infoTask(r0.caseId, 'in_cash_breach_window')
    const r = await E.provideInfo(sql, cfg, task.id, { answers: { fixed_fee_payment_date: '2026-07-28' }, origin: '사용자입력', by: '재무팀(모의)' })
    assert.equal(r.decision.authority, 'ceo_board')
  })

  await t('[상황 3 기안 묶음] 25건이 같은 질문(300억 연결?)을 하므로 한 번의 회신으로 구간 밖 기안 모두 확정된다', async () => {
    const res = await answerAllOpenInfo(sql, cfg, 'linked_to_group_300', { linked_to_group_300: false }, { origin: '사용자입력', by: '재무팀(모의)', caseType: EXPANSION_CASE_TYPE })
    assert.ok(res.length > 0)
    const plans = await E.listCases(sql, { caseType: EXPANSION_CASE_TYPE })
    assert.ok(plans.every((p) => p.status === 'pending_approval'), '남은 need_info 가 없어야 함')
    const outWin = plans.filter((p) => p.payload.evaluation.facts.in_cash_breach_window === false)
    assert.ok(outWin.every((p) => p.authority === 'masil_ceo'))
    assert.ok(outWin.every((p) => p.payload.evaluation.decision.also.includes('그룹 보고')))
    console.log(`   회신 ${res.length}건 반영 → 구간 밖 ${outWin.length}건은 Masil 대표 + 그룹 보고`)
  })

  await t('[승인 거절] 대표가 기안을 부결 → rejected + 재검토·전속계약 별개 확인 작업 → 재상신하면 새 승인 요청', async () => {
    const plans = await E.listCases(sql, { caseType: EXPANSION_CASE_TYPE })
    const p = plans.find((x) => x.authority === 'masil_ceo' && x.status === 'pending_approval')
    const ap = (await view(p.id)).approvals.find((a) => a.status === 'pending')
    await prep(ap.caseId)
    const d = await E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'masil_ceo', byName: '한지우', comment: '실질 공헌이익이 낮은 인플루언서 비중이 큼' })
    assert.equal(d.statusAfter, 'rejected')
    const v = await view(p.id)
    const titles = v.tasks.map((x) => x.title)
    assert.ok(titles.some((s) => s.includes('집행 중단'))); assert.ok(titles.some((s) => s.includes('전속계약은 별개')))
    assert.ok(v.tasks.filter((x) => x.title.includes('집행 중단') || x.title.includes('전속계약은 별개')).every((x) => x.assigneeRole === '계약 담당'), '부결 뒤 절차는 계약 담당이 맡는다')
    assert.equal(v.tasks.find((x) => x.title.includes('집행 중단')).dataOrigin, '가정') // 원본에 없는 절차임을 표시
    // 집행 중단 처리 단계에서도 상대방 통보 수령 증빙을 붙이고 뺄 수 있다
    const { addCaseFile, removeCaseFile, listCaseFiles } = await import('@/lib/modules/w02/handoff')
    const fid = await addCaseFile(sql, { caseId: p.id, kind: 'notice', filename: '수령확인.txt', mime: 'text/plain', content: Buffer.from('x'), by: '계약 담당' })
    assert.equal((await listCaseFiles(sql, p.id)).filter((f) => f.kind === 'notice').length, 1)
    await removeCaseFile(sql, fid, '계약 담당')
    assert.equal((await listCaseFiles(sql, p.id)).length, 0)
    const r = await E.resubmitCase(sql, cfg, p.id, { by: '마케팅', reason: '배분안 수정 후 재상신' })
    assert.equal(r.statusAfter, 'pending_approval')
  })

  await t('[승인 전 보완요청] 이전 팀으로 되돌리면 내 단계가 멈추고, 그 팀이 끝내야 다시 열린다. 이전에 거쳐 온 팀만 고를 수 있다', async () => {
    const { requestRework } = await import('@/lib/modules/w02/handoff')
    const r = await receiveContractNotice(sql, cfg, { influencerId: 'INF-008', annualFixedFeeKrw: 2_800_000_000, notifyDeadline: '2026-07-30', currentExpiry: '2026-09-30', fixedFeePaymentDate: '2026-09-15', note: '', linkedToGroup300: false }, '시험')
    const id = r.caseId
    await assert.rejects(() => requestRework(sql, id, { fromKey: 'collect-performance', toRole: '계약 담당', note: '', by: '재무' }), /보완을 요청할 수 있는 팀이 아니에요/)
    await requestRework(sql, id, { fromKey: 'collect-performance', toRole: '마케팅', note: '추계서 보완', by: '재무' })
    await assert.rejects(() => requestRework(sql, id, { fromKey: 'collect-performance', toRole: '마케팅', note: '', by: '재무' }), /이미 보완을 요청/)
    let v = await view(id)
    const collect = v.tasks.find((x) => x.detail.key === 'collect-performance')
    const rework = v.tasks.find((x) => x.detail.key === 'rework:collect-performance')
    assert.equal(rework.assigneeRole, '마케팅'); assert.match(rework.title, /추계서 보완/)
    await assert.rejects(() => E.completeTask(sql, collect.id, '재무'), /앞 단계가 먼저/)
    await E.completeTask(sql, rework.id, '마케팅')
    await E.completeTask(sql, collect.id, '재무') // 보완이 끝나 다시 열린다
    // 계약 담당은 재무팀·마케팅팀 중에서 고를 수 있다
    await requestRework(sql, id, { fromKey: 'confirm-terms', toRole: '재무', note: '', by: '계약 담당' })
  })

  await t('[부결] 계약 안건: 계약 담당이 불연장 통보를 상신하면 같은 승인권자에게 새 승인이 가고, 승인해야 통보할 수 있다. 부결은 재상신하지 않는다', async () => {
    const { requestNonrenewalApproval } = await import('@/lib/modules/w02/handoff')
    const r = await receiveContractNotice(sql, cfg, { influencerId: 'INF-009', annualFixedFeeKrw: 2_800_000_000, notifyDeadline: '2026-08-03', currentExpiry: '2026-09-30', fixedFeePaymentDate: '2026-09-15', note: '', linkedToGroup300: false }, '시험')
    const id = r.caseId
    await prep(id)
    const ap = (await view(id)).approvals.find((a) => a.status === 'pending')
    await E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'ceo_board', byName: '강세연' })
    let v = await view(id)
    assert.equal(v.case.status, 'rejected'); assert.ok(v.tasks.some((x) => x.detail.key === 'request-nonrenewal' && x.assigneeRole === '계약 담당'))
    const res = await requestNonrenewalApproval(sql, cfg, id, '계약 담당')
    assert.equal(res.requiredLabel, 'CEO/이사회')
    v = await view(id)
    const second = v.approvals.find((a) => a.status === 'pending')
    assert.equal(second.kind, 'nonrenewal'); assert.equal(second.requiredRole, 'ceo_board'); assert.equal(v.case.status, 'rejected', '안건은 여전히 부결 상태')
    await assert.rejects(() => E.decide(sql, cfg, second.id, { outcome: 'rejected', byRole: 'ceo_board', byName: '강세연' }), /승인 또는 재검토만/)
    await E.decide(sql, cfg, second.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연' })
    v = await view(id)
    const send = v.tasks.find((x) => x.detail.key === 'send-nonrenewal'); assert.ok(send); assert.equal(send.assigneeRole, '계약 담당')
    assert.equal(v.case.status, 'rejected', '통보를 보내기 전에는 닫히지 않는다')
    await E.completeTask(sql, send.id, '계약 담당')
    assert.equal((await view(id)).case.status, 'closed', '후속 작업이 모두 끝나면 부결 안건도 닫힌다')
  })

  await t('[재검토] 승인권자가 재검토하면 처음 올린 마케팅으로 돌아가 보완하고, 재상신하면 새 승인 요청이 만들어진다', async () => {
    const r = await receiveContractNotice(sql, cfg, { influencerId: 'INF-010', annualFixedFeeKrw: 2_800_000_000, notifyDeadline: '2026-08-05', currentExpiry: '2026-09-30', fixedFeePaymentDate: '2026-09-15', note: '', linkedToGroup300: false }, '시험')
    const id = r.caseId
    await prep(id)
    const ap = (await view(id)).approvals.find((a) => a.status === 'pending')
    await E.decide(sql, cfg, ap.id, { outcome: 'on_hold', byRole: 'ceo_board', byName: '강세연', comment: '조건 보완 필요' })
    const v = await view(id)
    assert.equal(v.case.status, 'on_hold'); assert.ok(v.tasks.some((x) => x.detail.key === 'hold-reason' && x.assigneeRole === '마케팅' && /재검토/.test(x.title)))
    const re = await E.resubmitCase(sql, cfg, id, { by: '마케팅', reason: '보완 후 다시 보고' })
    assert.equal(re.statusAfter, 'pending_approval')
    // 재검토 뒤에는 재무팀부터 처음부터 다시 거친다: 승인 앞 단계가 새로 열리고, 그 전에는 승인권자가 결정할 수 없다
    const v2 = await view(id)
    const open = v2.tasks.filter((x) => x.status === 'open' && x.detail.gate === 'pre-approval').map((x) => x.detail.key).sort()
    assert.deepEqual(open, ['collect-performance', 'confirm-terms'])
    assert.ok(!v2.tasks.some((x) => x.status === 'open' && x.detail.key === 'hold-reason'), '보완 요청 일은 다시 보고하면서 끝난다')
    const ap2 = v2.approvals.find((a) => a.status === 'pending')
    await assert.rejects(() => E.decide(sql, cfg, ap2.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연' }), /앞 단계가 끝나야/)
    await assert.rejects(() => E.completeTask(sql, v2.tasks.find((x) => x.status === 'open' && x.detail.key === 'confirm-terms').id, '계약 담당'), /앞 단계가 먼저/) // 재무팀 다음에 계약 담당
    await prep(id)
    await E.decide(sql, cfg, ap2.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연' })
    // 승인 뒤: 승인조건 문서화 → 상대방에 계약 통보(마케팅) → 통보·회신 기록 보관 순서로만 열린다
    const v3 = await view(id)
    const byKey = (k) => v3.tasks.find((x) => x.detail.key === k)
    assert.equal(byKey('notify-counterparty').assigneeRole, '마케팅')
    await assert.rejects(() => E.completeTask(sql, byKey('notify-counterparty').id, '마케팅'), /앞 단계가 먼저/)
    await E.completeTask(sql, byKey('doc-conditions').id, '계약 담당')
    await E.completeTask(sql, byKey('notify-counterparty').id, '마케팅')
    await E.completeTask(sql, byKey('record-reply').id, '계약 담당')
    assert.equal((await view(id)).case.status, 'closed')
  })

  await t('[수정 보고] 변동 5% 이내는 최초 승인권자에게 바로, 5% 초과는 재무팀 절차부터 다시. 승인권한 기준을 넘나들어도 승인권자는 바뀌지 않고, 원 금액·원 첨부는 그대로 쌓인다', async () => {
    const { reportRevision } = await import('@/lib/modules/w02/revision')
    const { financeRefer, listCaseFiles } = await import('@/lib/modules/w02/handoff')
    const mk = (infl, fee, dl) => receiveContractNotice(sql, cfg, { influencerId: infl, annualFixedFeeKrw: fee, notifyDeadline: dl, currentExpiry: '2026-09-30', fixedFeePaymentDate: '2026-09-15', note: '', linkedToGroup300: false }, '시험')
    const file = { filename: '수정계약서.txt', mime: 'text/plain', content: Buffer.from('수정') }

    // ① 5% 이내 → 최초 승인권자(CEO/이사회)에게 바로
    const a = (await mk('INF-005', 2_800_000_000, '2026-08-07')).caseId
    await prep(a)
    const ap1 = (await view(a)).approvals.find((x) => x.status === 'pending')
    await E.decide(sql, cfg, ap1.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연' })
    await assert.rejects(() => reportRevision(sql, cfg, { caseId: a, newAmount: 2_800_000_000, reason: '', files: [], by: '마케팅' }), /원래 금액과 같아요/)
    const r1 = await reportRevision(sql, cfg, { caseId: a, newAmount: 2_940_000_000, reason: '고정 피 5% 인상', files: [file], by: '마케팅' }) // 정확히 +5%
    assert.equal(r1.route, 'direct')
    let v = await view(a)
    assert.equal(v.case.status, 'pending_approval'); assert.equal(v.case.payload.facts.annual_contract_value_krw, 2_940_000_000)
    assert.equal(v.case.payload.originalAmount, 2_800_000_000, '원 금액은 그대로 남는다')
    const pend = v.approvals.find((x) => x.status === 'pending')
    assert.equal(pend.requiredRole, 'ceo_board')
    assert.equal(v.tasks.filter((x) => x.status === 'open' && x.detail.gate === 'pre-approval').length, 0, '바로 보고: 재무팀 절차를 다시 거치지 않는다')
    assert.equal(v.tasks.filter((x) => x.status === 'open' && x.detail.key === 'doc-conditions').length, 0, '이전 결정의 열린 후속 작업은 닫힌다')
    const files = await listCaseFiles(sql, a)
    assert.deepEqual(files.filter((f) => f.kind === 'revision').map((f) => `${f.revision}:${f.filename}`), ['1:수정계약서.txt'])
    await E.decide(sql, cfg, pend.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연' })
    assert.ok((await view(a)).tasks.some((x) => x.status === 'open' && x.detail.key === 'doc-conditions'), '새 승인 뒤 후속 작업이 다시 열린다')

    // ② 5% 초과 + 기준(연 10억)을 넘나듦 → 재무팀부터 다시, 승인권자는 최초(Masil 대표) 그대로
    const b = (await mk('INF-006', 800_000_000, '2026-08-11')).caseId
    await prep(b)
    const ap2 = (await view(b)).approvals.find((x) => x.status === 'pending')
    assert.equal(ap2.requiredRole, 'masil_ceo')
    await E.decide(sql, cfg, ap2.id, { outcome: 'approved', byRole: 'masil_ceo', byName: '한지우' })
    const r2 = await reportRevision(sql, cfg, { caseId: b, newAmount: 1_200_000_000, reason: '', files: [], by: '마케팅' })
    assert.equal(r2.route, 'restart')
    v = await view(b)
    assert.deepEqual(v.tasks.filter((x) => x.status === 'open' && x.detail.gate === 'pre-approval').map((x) => x.detail.key).sort(), ['collect-performance', 'confirm-terms'])
    await financeRefer(sql, cfg, b, { linked: false, by: '재무팀' }) // 재평가가 일어나도
    v = await view(b)
    const pend2 = v.approvals.filter((x) => x.status === 'pending')
    assert.equal(pend2.length, 1); assert.equal(pend2[0].requiredRole, 'masil_ceo', '12억은 원래 CEO/이사회 기준이지만 최초 승인권자(Masil 대표)가 그대로 맡는다')
    // 두 번째 수정 보고는 직전 금액 대비로 계산되고 내역이 쌓인다
    await prep(b)
    await E.decide(sql, cfg, pend2[0].id, { outcome: 'rejected', byRole: 'masil_ceo', byName: '한지우' })
    const r3 = await reportRevision(sql, cfg, { caseId: b, newAmount: 1_230_000_000, reason: '', files: [], by: '마케팅' })
    assert.equal(r3.route, 'direct'); assert.equal(r3.no, 2)
    v = await view(b)
    assert.deepEqual(v.case.payload.revisions.map((x) => [x.fromAmount, x.toAmount]), [[800_000_000, 1_200_000_000], [1_200_000_000, 1_230_000_000]])
    assert.equal(v.case.payload.originalAmount, 800_000_000)
    // 결정이 나지 않은 안건은 수정 보고할 수 없다
    const d = (await mk('INF-007', 700_000_000, '2026-08-13')).caseId
    await assert.rejects(() => reportRevision(sql, cfg, { caseId: d, newAmount: 710_000_000, reason: '', files: [], by: '마케팅' }), /승인 또는 부결이 난 안건만/)
  })

  await t('모든 상태 변화가 이력에 남는다 (이력만 보고 경위를 재구성할 수 있다)', async () => {
    const v = await view(contractId)
    const kinds = new Set(v.events.map((e) => e.eventType))
    for (const k of ['created', 'evaluated', 'facts_changed', 'approval_requested', 'approval_superseded', 'task_created', 'info_received']) assert.ok(kinds.has(k), k)
    assert.ok(v.events.filter((e) => e.eventType === 'evaluated').every((e) => Array.isArray(e.detail.trace)))
  })

  console.log(`\n${n}개 시험 모두 통과`)
} finally {
  await sql.end()
}
