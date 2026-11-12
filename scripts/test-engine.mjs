// 엔진 핵심 시험.  node scripts/test-engine.mjs
// ⚠️ 로컬 DB 의 안건·이력·승인·작업을 모두 지우고 시작한다(원본 복사본 source_rows 는 그대로).
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { applyCoreSchema } from '../lib/engine/schema.ts'
import * as E from '../lib/engine/engine.ts'
import { decideAuthority } from '../lib/rules/evaluate.ts'
import { AUTHORITY_RULES, ROLES } from '../lib/rules/authority.rules.ts'

const root = resolve(import.meta.dirname, '..')
let url = process.env.DATABASE_URL
if (!url && existsSync(resolve(root, '.env.local'))) url = readFileSync(resolve(root, '.env.local'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
if (!url) throw new Error('DATABASE_URL 이 없어요')
const sql = postgres(url, { max: 1, onnotice: () => {} })

// 업무 모듈 흉내: 승인되면 작업 2개, 모르는 사실 질문 문구
const handler = {
  caseType: 'w02.contract_renewal',
  describeFact: (f) => f === 'in_cash_breach_window'
    ? { title: '고정 피 지급일이 현금 하회 구간 안인지 확인', assigneeRole: '재무', question: '고정 피는 언제 나가나요?' } : undefined,
  onDecision: (c, outcome) => outcome === 'approved'
    ? [{ key: 'notify', taskType: 'notify', title: '상대방에 결과 통보', assigneeRole: '마케팅' },
       { key: 'record', taskType: 'record', title: '통보·회신 기록 보관', assigneeRole: '계약 담당' }]
    : outcome === 'rejected' ? [{ key: 'rethink', taskType: 'review', title: '기한 전 재검토', assigneeRole: '마케팅' }] : [],
}
const label = (id) => ROLES.find((r) => r.id === id)?.label ?? id
const cfg = {
  decide: (type, facts) => decideAuthority(type, facts, AUTHORITY_RULES, ROLES),
  roleRank: (id) => ROLES.find((r) => r.id === id).rank,
  roleLabel: label,
  handlers: { [handler.caseType]: handler },
  ctx: { asOf: '2026-07-01' },
}
const newContract = (fee) => ({
  caseType: 'w02.contract_renewal', title: `혜인 전속계약 갱신 (고정 피 ${fee / 1e8}억)`, deadline: '2026-07-17',
  subjectRefs: { influencer: 'INF-001' },
  payload: { facts: { annual_contract_value_krw: fee, creates_cash_outflow: true, in_cash_breach_window: null, linked_to_group_300: false } },
})

let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const events = async (id) => (await sql`select event_type from case_events where case_id=${id} order by id`).map((r) => r.event_type)

try {
  await applyCoreSchema(sql)
  await E.resetEngineData(sql)

  let c1
  await t('접수 → 평가 → 승인 요청 생성 (28억은 CEO/이사회)', async () => {
    const r = await E.openCase(sql, cfg, newContract(2_800_000_000))
    c1 = r.caseId
    assert.equal(r.decision.status, 'decided'); assert.equal(r.statusAfter, 'pending_approval')
    assert.equal(r.decision.authority, 'ceo_board')
    const v = await E.getCaseView(sql, c1)
    assert.equal(v.approvals.length, 1); assert.equal(v.approvals[0].requiredRole, 'ceo_board'); assert.equal(v.approvals[0].status, 'pending')
  })

  await t('권한 부족한 사람의 승인은 거부된다 (Masil 대표가 CEO/이사회 건을 승인 불가)', async () => {
    const ap = (await E.getCaseView(sql, c1)).approvals[0]
    await assert.rejects(() => E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'masil_ceo', byName: '한지우' }), /권한이 부족/)
    assert.equal((await E.getCaseView(sql, c1)).case.status, 'pending_approval') // 상태 그대로
  })

  await t('CEO/이사회 승인 → 상태 approved, 후속 작업 2개 생성, 이력 기록', async () => {
    const ap = (await E.getCaseView(sql, c1)).approvals[0]
    const r = await E.decide(sql, cfg, ap.id, { outcome: 'approved', byRole: 'ceo_board', byName: '강세연', comment: '조건 확인함' })
    assert.equal(r.statusAfter, 'approved'); assert.equal(r.taskIds.length, 2)
    const v = await E.getCaseView(sql, c1)
    assert.equal(v.approvals[0].status, 'approved'); assert.match(v.approvals[0].decidedBy, /강세연/)
    assert.ok((await events(c1)).includes('decided'))
  })

  await t('같은 승인 요청을 다시 처리할 수 없다', async () => {
    const ap = (await E.getCaseView(sql, c1)).approvals[0]
    await assert.rejects(() => E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'ceo_board', byName: 'x' }), /이미 처리/)
  })

  await t('후속 작업을 모두 끝내면 안건이 closed 로 닫힌다', async () => {
    const tasks = (await E.getCaseView(sql, c1)).tasks.filter((x) => x.status === 'open')
    let last
    for (const task of tasks) last = await E.completeTask(sql, task.id, '계약 담당')
    assert.equal(last.caseClosed, true)
    assert.equal((await E.getCaseView(sql, c1)).case.status, 'closed')
  })

  await t('확정된 안건은 조건이 바뀌어도 상태를 건드리지 않고 판정만 기록한다 (finalized)', async () => {
    const r = await E.updateFacts(sql, cfg, c1, { patch: { annual_contract_value_krw: 100 }, reason: '사후 정정', origin: '사용자입력', by: '시험' })
    assert.equal(r.finalized, true); assert.equal((await E.getCaseView(sql, c1)).case.status, 'closed')
  })

  // ── 조건 변경 → 재평가 → 정보 부족 → 회신 ──
  let c2
  await t('조건 변경: 고정 피가 8억으로 내려가면 승인권자가 바뀌고 기존 승인 요청은 대체된다', async () => {
    const r0 = await E.openCase(sql, cfg, newContract(2_800_000_000)); c2 = r0.caseId
    const r = await E.updateFacts(sql, cfg, c2, { patch: { annual_contract_value_krw: 800_000_000 }, reason: '혜인 측 고정 피 인하 제안', origin: '사용자입력', by: '계약 담당' })
    assert.equal(r.authorityChanged, true)
    assert.equal(r.decision.status, 'need_info', '10억 이하 → Masil 대표인데, 현금 하회 여부를 모르면 CEO/이사회 가능성이 남아 확정 불가')
    const v = await E.getCaseView(sql, c2)
    assert.equal(v.approvals.filter((a) => a.status === 'pending').length, 0)
    assert.ok(v.approvals.some((a) => a.status === 'superseded'))
    const info = v.tasks.filter((x) => x.taskType === 'info_request')
    assert.equal(info.length, 1); assert.equal(info[0].detail.fact, 'in_cash_breach_window'); assert.equal(info[0].assigneeRole, '재무')
    assert.equal(v.case.status, 'need_info')
  })

  await t('같은 평가를 또 해도 확인 요청 작업이 중복 생성되지 않는다', async () => {
    await E.evaluateCase(sql, cfg, c2, '재확인'); await E.evaluateCase(sql, cfg, c2, '재확인')
    assert.equal((await E.getCaseView(sql, c2)).tasks.filter((x) => x.taskType === 'info_request').length, 1)
  })

  await t('모의 회신(구간 밖) → 재평가 → 승인권자 Masil 대표로 확정, 새 승인 요청', async () => {
    const task = (await E.getCaseView(sql, c2)).tasks.find((x) => x.taskType === 'info_request')
    const r = await E.provideInfo(sql, cfg, task.id, { answers: { in_cash_breach_window: false }, origin: '사용자입력', by: '재무팀(모의)' })
    assert.equal(r.decision.status, 'decided'); assert.equal(r.decision.authority, 'masil_ceo')
    const v = await E.getCaseView(sql, c2)
    assert.equal(v.case.status, 'pending_approval'); assert.equal(v.approvals.filter((a) => a.status === 'pending')[0].requiredRole, 'masil_ceo')
    const done = v.tasks.find((x) => x.id === task.id)
    assert.equal(done.status, 'done'); assert.equal(done.dataOrigin, '사용자입력')
    await assert.rejects(() => E.provideInfo(sql, cfg, task.id, { answers: {}, origin: '사용자입력', by: 'x' }), /이미 처리/)
  })

  await t('모의 회신(구간 안)이면 반대로 CEO/이사회 로 올라간다 — 금액이 같아도 결론이 달라짐', async () => {
    const r0 = await E.openCase(sql, cfg, newContract(800_000_000))
    assert.equal(r0.decision.status, 'need_info')
    const task = (await E.getCaseView(sql, r0.caseId)).tasks.find((x) => x.taskType === 'info_request')
    const r = await E.provideInfo(sql, cfg, task.id, { answers: { in_cash_breach_window: true }, origin: '사용자입력', by: '재무팀(모의)' })
    assert.equal(r.decision.authority, 'ceo_board')
  })

  // ── 거절 → 재검토 → 재상신 ──
  await t('승인 거절 → rejected + 재검토 작업 → 재상신하면 새 승인 요청', async () => {
    const r0 = await E.openCase(sql, cfg, newContract(2_800_000_000))
    const ap = (await E.getCaseView(sql, r0.caseId)).approvals[0]
    const d = await E.decide(sql, cfg, ap.id, { outcome: 'rejected', byRole: 'ceo_board', byName: '강세연', comment: '성과 대비 과다' })
    assert.equal(d.statusAfter, 'rejected'); assert.equal(d.taskIds.length, 1)
    await assert.rejects(() => E.resubmitCase(sql, cfg, c1, { by: 'x', reason: 'x' }), /상태에서만/)
    const r = await E.resubmitCase(sql, cfg, r0.caseId, { by: '마케팅', reason: '조건 수정 후 재상신' })
    assert.equal(r.statusAfter, 'pending_approval')
    const v = await E.getCaseView(sql, r0.caseId)
    assert.equal(v.approvals.filter((a) => a.status === 'pending').length, 1); assert.equal(v.approvals.length, 2)
  })

  await t('이력은 추가만 된다 (사건 종류와 순서 보존)', async () => {
    const ev = await events(c2)
    assert.equal(ev[0], 'created') // 항상 접수가 가장 먼저
    for (const k of ['evaluated', 'facts_changed', 'approval_superseded', 'task_created', 'info_received', 'approval_requested']) assert.ok(ev.includes(k), k)
    // id 순서 = 발생 순서 (추가만 되므로 뒤바뀌지 않는다)
    const ids = (await sql`select id from case_events where case_id=${c2} order by id`).map((r) => Number(r.id))
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b))
  })

  await t('마감까지 남은 일수 계산 (기준일 2026-07-01 → 07-17 = 16일)', async () => {
    assert.equal(E.daysUntil('2026-07-17', '2026-07-01'), 16); assert.equal(E.daysUntil(null, '2026-07-01'), null)
  })

  await t('초기화하면 안건·이력·승인·작업이 모두 비고 원본 복사본은 남는다', async () => {
    const before = (await sql`select count(*)::int n from source_rows`)[0].n
    await E.resetEngineData(sql)
    const left = await sql`select (select count(*) from decision_cases)::int a, (select count(*) from case_events)::int b, (select count(*) from approvals)::int c, (select count(*) from tasks)::int d`
    assert.deepEqual(Object.values(left[0]), [0, 0, 0, 0])
    assert.equal((await sql`select count(*)::int n from source_rows`)[0].n, before)
  })

  console.log(`\n${n}개 시험 모두 통과`)
} finally {
  await sql.end()
}
