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

  await t('근거: 기안 총액 1.81억(>1억) → 건당 금액이 작아도 대표급 이상, 구간 안이면 그룹 CEO, 구간 밖은 300억 연결 여부 확인 필요', async () => {
    const plans = await E.listCases(sql, { caseType: EXPANSION_CASE_TYPE })
    const inWin = plans.filter((p) => p.payload.evaluation.facts.in_cash_breach_window === true)
    const outWin = plans.filter((p) => p.payload.evaluation.facts.in_cash_breach_window === false)
    assert.ok(inWin.length > 0 && outWin.length > 0)
    assert.ok(inWin.every((p) => p.authority === 'group_ceo' && p.status === 'pending_approval'))
    assert.ok(outWin.every((p) => p.status === 'need_info'))
    console.log(`   구간 안 ${inWin.length}건 → 그룹 CEO / 구간 밖 ${outWin.length}건 → 확인 필요(300억 연결 여부)`)
  })

  await t('다른 부서 영향: 구간 안 기안마다 재무에 "집행 예정일 조정" 확인 요청이 자동 생성된다 (조정 시 승인권자 시뮬레이션 포함)', async () => {
    const plans = await E.listCases(sql, { caseType: EXPANSION_CASE_TYPE })
    const p = plans.find((x) => x.payload.evaluation.facts.in_cash_breach_window === true)
    const task = await infoTask(p.id, 'settlement_date')
    assert.ok(task); assert.equal(task.assigneeRole, '재무'); assert.ok(task.detail.whatIf.authorityLabel); assert.equal(task.detail.dept, '재무')
  })

  // ───────────── 상황 1: 정상 ─────────────
  await t('[상황 1 정상] 계약: CEO/이사회 승인 → 후속 작업 3개 → 모두 완료하면 안건이 닫힌다', async () => {
    const ap = (await view(contractId)).approvals.find((a) => a.status === 'pending')
    await assert.rejects(() => E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'masil_ceo', byName: '한지우' }), /권한이 부족/)
    const d = await E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연', comment: '실질 공헌이익 확인 후 조건 변경 통보' })
    assert.equal(d.statusAfter, 'approved'); assert.equal(d.taskIds.length, 3)
    const v = await view(contractId)
    assert.deepEqual(v.tasks.filter((x) => x.status === 'open').map((x) => x.assigneeRole).sort(), ['계약 담당', '계약 담당', '마케팅'])
    assert.ok(v.tasks.every((x) => x.dueDate === '2026-07-17'))
    for (const task of v.tasks) await E.completeTask(sql, task.id, task.assigneeRole)
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
  await t('[상황 3 반대 회신] 같은 질문에 "지급일 7/28(하회 구간 안)"이라고 답했다면 → 그룹 CEO (금액 8억이어도)', async () => {
    const r0 = await E.openCase(sql, cfg, { caseType: CONTRACT_CASE_TYPE, title: '시험용 8억 계약', deadline: '2026-07-17', payload: { facts: { annual_contract_value_krw: 800_000_000, creates_cash_outflow: true, fixed_fee_payment_date: null, linked_to_group_300: false } } })
    assert.equal(r0.decision.status, 'need_info')
    const task = await infoTask(r0.caseId, 'in_cash_breach_window')
    const r = await E.provideInfo(sql, cfg, task.id, { answers: { fixed_fee_payment_date: '2026-07-28' }, origin: '사용자입력', by: '재무팀(모의)' })
    assert.equal(r.decision.authority, 'group_ceo')
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

  await t('[다른 부서 영향] 재무가 집행일을 8/24(구간 밖)로 조정하면 → 승인권자가 그룹 CEO에서 Masil 대표로 내려가고 기존 요청은 대체된다', async () => {
    const plans = await E.listCases(sql, { caseType: EXPANSION_CASE_TYPE })
    const p = plans.find((x) => x.payload.evaluation.facts.in_cash_breach_window === true)
    assert.equal(p.authority, 'group_ceo')
    const task = await infoTask(p.id, 'settlement_date')
    const r = await E.provideInfo(sql, cfg, task.id, { answers: { settlement_date: '2026-08-24' }, origin: '사용자입력', by: '재무팀(모의)' })
    // 집행일이 구간 밖이 되어 그룹 CEO 사유는 사라졌지만, 이 기안은 300억 연결 여부를 아직 모른다 → 바로 확정하지 않고 다시 확인
    assert.equal(r.decision.authority, 'masil_ceo'); assert.equal(r.authorityChanged, true); assert.equal(r.decision.status, 'need_info')
    let v = await view(p.id)
    assert.ok(v.approvals.some((a) => a.status === 'superseded' && a.requiredRole === 'group_ceo'))
    assert.equal(v.approvals.filter((a) => a.status === 'pending').length, 0)
    const link = await infoTask(p.id, 'linked_to_group_300')
    assert.ok(link, '300억 연결 여부 확인 요청이 새로 생김')
    const r2 = await E.provideInfo(sql, cfg, link.id, { answers: { linked_to_group_300: false }, origin: '사용자입력', by: '재무팀(모의)' })
    assert.equal(r2.decision.status, 'decided')
    v = await view(p.id)
    assert.equal(v.approvals.filter((a) => a.status === 'pending')[0].requiredRole, 'masil_ceo')
    // 제약은 남아 있다: 확정기한(계약)은 그대로이고, 새 집행일도 이력에 남는다
    assert.equal(v.case.deadline, p.deadline)
    assert.ok(v.events.some((e) => e.eventType === 'info_received' && e.detail.answers.settlement_date === '2026-08-24'))
  })

  await t('[승인 거절] 대표가 기안을 부결 → rejected + 재검토·전속계약 별개 확인 작업 → 재상신하면 새 승인 요청', async () => {
    const plans = await E.listCases(sql, { caseType: EXPANSION_CASE_TYPE })
    const p = plans.find((x) => x.authority === 'masil_ceo' && x.status === 'pending_approval')
    const ap = (await view(p.id)).approvals.find((a) => a.status === 'pending')
    const d = await E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'masil_ceo', byName: '한지우', comment: '실질 공헌이익이 낮은 인플루언서 비중이 큼' })
    assert.equal(d.statusAfter, 'rejected')
    const v = await view(p.id)
    const titles = v.tasks.map((x) => x.title)
    assert.ok(titles.some((s) => s.includes('[제안]'))); assert.ok(titles.some((s) => s.includes('전속계약은 별개')))
    assert.equal(v.tasks.find((x) => x.title.includes('[제안]')).dataOrigin, '가정') // 원본에 없는 제안임을 표시
    const r = await E.resubmitCase(sql, cfg, p.id, { by: '마케팅', reason: '배분안 수정 후 재상신' })
    assert.equal(r.statusAfter, 'pending_approval')
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
