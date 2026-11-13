// 안건 제출(보고)·접수 시험.  node --import ./scripts/_register.mjs scripts/test-submissions.mjs
// ⚠️ 로컬 DB 의 안건·이력·승인·작업·접수 대기를 모두 지운다 (원본 복사본은 유지).
import assert from 'node:assert/strict'
import * as E from '@/lib/engine/engine'
import { getEngine } from '@/lib/app/engine'
import { canAcceptCategory, canSubmitCategory } from '@/lib/app/auth'
import { calcContribution, validateContribution } from '@/lib/metrics/contribution-calc'
import { getPerformance } from '@/lib/metrics/service'
import { DEFAULT_ASSUMPTIONS } from '@/lib/metrics/performance'
import {
  ATTACHMENT_KINDS, CATEGORIES, acceptSubmission, checksFor, kindsFor, requiredKinds, missingRequired, fileCheckId, contributionFromInput, getFile, listFiles, listSubmissions, returnSubmission, submitIntake,
} from '@/lib/modules/intake/submissions'

const { sql, cfg } = await getEngine()
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const user = (roles) => ({ authenticated: true, email: 'x', name: 'x', roles, isAdmin: false })
const doc = (kind, name = `${kind}.txt`) => ({ kind, filename: name, mime: 'text/plain', content: Buffer.from(`시험 ${kind}`) })
const NEW_FILES = ['draft', 'estimate'].map((k) => doc(k)) // 신규 ID: 기존 계약이 없어 기존 계약서 칸이 없다
const REQUIRED_FILES = [...NEW_FILES, doc('contract')] // 갱신·확대(원본에 있는 대상): 기존 계약서가 필수 (확정 계약서는 승인 뒤 계약 담당이 만든다)
const INF_FILES = REQUIRED_FILES
const custom = (label, name = `${label}.txt`) => ({ ...doc('custom', name), label })
const CONTRIB = { gmv: '100000000', refund: '10000000', cogs: '30000000', channelFee: '7000000', shipping: '4000000', returnLogistics: '1000000' }
const campaignValues = (over = {}) => ({ settlementDate: '2026-09-10', contractDeadline: '2026-07-10', requested: '15000000', memo: '시험', ...CONTRIB, ...over })
// 접수할 때 확인해야 하는 모든 항목 (체크리스트 + 파일마다 하나씩)
const allChecks = async (id, category, isNew = false) => [...checksFor(category, isNew).map((c) => c.id), ...(await listFiles(sql, id)).map((f) => fileCheckId(f.id))]
const submit = (over = {}) => submitIntake(sql, { category: 'campaign', refId: 'CMP-0004', values: campaignValues(), files: REQUIRED_FILES, by: '마케팅 팀원', ...over })

try {
  await E.resetEngineData(sql)

  await t('공헌이익 식은 시맨틱 레이어의 정의와 같다: 캠페인 실적 줄을 넣으면 같은 값이 나온다', async () => {
    const perf = await getPerformance(DEFAULT_ASSUMPTIONS, sql)
    const c = perf.byCampaign.find((x) => x.campaignId === 'CMP-0003')
    const r = calcContribution({ gmv: c.gmv, refund: c.refund, cogs: c.cogs, channelFee: c.channelFee, shipping: c.shipping, returnLogistics: c.returnLogistics, marketingSpend: c.adSpend })
    assert.ok(Math.abs(r.contributionProfit - c.contributionProfit) < 1e-6 * Math.abs(c.contributionProfit) + 1)
    assert.ok(Math.abs(r.netRevenue - c.netRevenue) < 1)
  })
  await t('공헌이익 계산: 손으로 계산한 값과 같고, 빈칸·음수·환불>GMV 는 막는다', () => {
    const r = calcContribution({ gmv: 100_000_000, refund: 10_000_000, cogs: 30_000_000, channelFee: 7_000_000, shipping: 4_000_000, returnLogistics: 1_000_000, marketingSpend: 15_000_000 })
    assert.equal(r.netRevenue, 90_000_000); assert.equal(r.contributionProfit, 33_000_000)
    assert.equal(r.realRoas, 2.2); assert.equal(r.returnRate, 0.1)
    const keys = ['gmv', 'refund', 'cogs']
    assert.match(validateContribution({ gmv: '100', refund: '', cogs: '1' }, keys), /모두 채워/)
    assert.match(validateContribution({ gmv: '100', refund: '-1', cogs: '1' }, keys), /0 이상/)
    assert.match(validateContribution({ gmv: '100', refund: '200', cogs: '1' }, keys), /GMV 보다/)
    assert.equal(validateContribution({ gmv: '100', refund: '0', cogs: '0' }, keys), null)
  })
  await t('권한: 마케팅 팀원·팀장은 제출할 수 있고, 재무·계약 담당은 제출할 수 없다. 접수는 팀장 이상만', () => {
    for (const c of CATEGORIES) {
      assert.equal(canSubmitCategory(user(['marketing_member']), c.submitRoles, c.acceptRole), true)
      assert.equal(canSubmitCategory(user(['finance']), c.submitRoles, c.acceptRole), false)
      assert.equal(canSubmitCategory(user(['contract_mgr']), c.submitRoles, c.acceptRole), false)
      assert.equal(canAcceptCategory(user(['marketing_member']), c.acceptRole), false)
      assert.equal(canAcceptCategory(user(['marketing_team']), c.acceptRole), true)
      assert.equal(canAcceptCategory(user(['masil_ceo']), c.acceptRole), false, '다른 승인권자는 기안을 대신 접수하지 않는다')
    }
  })
  await t('제출: 필수 첨부·ID 형식·날짜·공헌이익 빈칸이 하나라도 문제면 거부한다', async () => {
    await assert.rejects(() => submit({ files: [doc('draft')] }), /비용 및 성과 추계서/)
    await assert.rejects(() => submit({ refId: 'CMP-1' }), /형식/)
    await assert.rejects(() => submit({ refId: 'CMP-9999' }), /찾을 수 없어요/)
    await assert.rejects(() => submit({ values: campaignValues({ contractDeadline: '7월 10일' }) }), /YYYY-MM-DD/)
    await assert.rejects(() => submit({ values: campaignValues({ cogs: '' }) }), /모두 채워/)
    await assert.rejects(() => submit({ values: campaignValues({ requested: '0' }) }), /0보다/)
    await assert.rejects(() => submit({ files: [...REQUIRED_FILES, doc('draft', 'run.exe')] }), /형식/)
    await assert.rejects(() => submit({ files: [...REQUIRED_FILES, custom('', 'a.txt')] }), /종류 이름/)
    await assert.rejects(() => submit({ files: [...REQUIRED_FILES, custom('가'.repeat(31), 'a.txt')] }), /30자/)
    assert.equal((await listSubmissions(sql)).length, 0, '거부된 제출은 아무것도 남기지 않는다')
  })
  let subId
  await t('제출: 모두 채우면 접수 대기(보고)가 만들어지고 첨부파일이 그대로 저장된다', async () => {
    const s = await submit()
    subId = s.id
    assert.equal(s.status, 'pending'); assert.equal(s.acceptRole, 'marketing_team'); assert.equal(s.submittedBy, '마케팅 팀원')
    const files = await listFiles(sql, s.id)
    assert.deepEqual(files.map((f) => f.kind).sort(), ['contract', 'draft', 'estimate'])
    assert.equal((await getFile(sql, files[0].id)).content.toString(), `시험 ${files[0].kind}`)
    assert.equal((await E.listCases(sql)).length, 0, '접수 전에는 안건이 아니다')
    const c = contributionFromInput(s.input)
    assert.equal(c.marketingSpend, 15_000_000); assert.equal(calcContribution(c).contributionProfit, 33_000_000)
  })
  await t('접수: 체크리스트를 하나라도 빼면 접수되지 않고, 모두 확인하면 안건이 되어 규칙집이 평가한다', async () => {
    const all = await allChecks(subId, 'campaign')
    await assert.rejects(() => acceptSubmission(sql, cfg, subId, '마케팅 팀장', all.slice(1)), /확인하지 않은 항목/)
    await assert.rejects(() => acceptSubmission(sql, cfg, subId, '마케팅 팀장', all.filter((x) => !x.startsWith('file:'))), /첨부 /) // 파일을 하나라도 안 열어 봤으면 안 된다
    await assert.rejects(() => acceptSubmission(sql, cfg, subId, '마케팅 팀장', all.filter((x, i) => i !== all.length - 1)), /첨부 /)
    await assert.rejects(() => acceptSubmission(sql, cfg, subId, '마케팅 팀장', []), /확인하지 않은 항목/)
    assert.equal((await E.listCases(sql)).length, 0)
    const r = await acceptSubmission(sql, cfg, subId, '마케팅 팀장', all)
    const v = await E.getCaseView(sql, r.caseId)
    assert.equal(v.case.payload.submission.submittedBy, '마케팅 팀원')
    assert.equal(v.case.payload.submission.checklist.by, '마케팅 팀장'); assert.equal(v.case.payload.submission.checklist.items.length, all.length)
    await assert.rejects(() => acceptSubmission(sql, cfg, subId, '팀장', []), /이미 처리/)
    assert.equal(v.case.payload.submission.calc.result.contributionProfit, 33_000_000)
    assert.equal(v.case.deadline, '2026-07-10')
    assert.ok(v.tasks.some((x) => x.detail.key === 'collect-performance'), '접수 뒤 승인 앞 단계(재무 취합)가 생긴다')
    await assert.rejects(() => acceptSubmission(sql, cfg, subId, '마케팅 팀장', all), /이미 처리/)
    assert.equal((await listSubmissions(sql)).find((x) => x.id === subId).status, 'accepted')
  })
  await t('전속계약 접수: 인플루언서 제출은 계약 안건이 되고 현 계약 만료일이 필요하다 (갱신·확대는 체크리스트에 기존 계약서·조건 확인 항목이 있고, 신규 ID 는 없다)', async () => {
    assert.ok(checksFor('influencer').some((c) => c.id === 'terms')); assert.ok(checksFor('campaign').some((c) => c.id === 'terms')); assert.ok(!checksFor('campaign', true).some((c) => c.id === 'terms'))
    const values = { settlementDate: '2026-09-15', contractDeadline: '2026-07-22', requested: '800000000', currentExpiry: '2026-09-30', autoRenew: '자동 갱신', memo: '시험', ...CONTRIB }
    await assert.rejects(() => submitIntake(sql, { category: 'influencer', refId: 'INF-003', values: { ...values, currentExpiry: '' }, files: REQUIRED_FILES, by: '팀원' }), /현 계약 만료일/)
    const s = await submitIntake(sql, { category: 'influencer', refId: 'INF-003', values, files: INF_FILES, by: '팀원' })
    const r = await acceptSubmission(sql, cfg, s.id, '팀장', await allChecks(s.id, 'influencer'))
    const v = await E.getCaseView(sql, r.caseId)
    assert.equal(v.case.caseType, 'w02.contract_renewal'); assert.equal(v.case.authority, 'masil_ceo', '연 8억 + 지급일 구간 밖 → Masil 대표')
    assert.equal(v.case.payload.contract.autoRenew, true, '자동 갱신 여부가 안건에 남는다')
  })
  await t('자동 갱신 여부: 갱신 제출에는 필수이고 정해진 값만 받으며, "자동 갱신 아님"이면 아니오로 남는다', async () => {
    const values = { settlementDate: '2026-09-15', contractDeadline: '2026-07-23', requested: '800000000', currentExpiry: '2026-09-30', memo: '시험', ...CONTRIB }
    await assert.rejects(() => submitIntake(sql, { category: 'influencer', refId: 'INF-005', values, files: INF_FILES, by: '팀원' }), /자동 갱신 여부/)
    await assert.rejects(() => submitIntake(sql, { category: 'influencer', refId: 'INF-005', values: { ...values, autoRenew: '아마도' }, files: INF_FILES, by: '팀원' }), /자동 갱신 여부/)
    const s = await submitIntake(sql, { category: 'influencer', refId: 'INF-005', values: { ...values, autoRenew: '자동 갱신 아님' }, files: INF_FILES, by: '팀원' })
    const r = await acceptSubmission(sql, cfg, s.id, '팀장', await allChecks(s.id, 'influencer'))
    assert.equal((await E.getCaseView(sql, r.caseId)).case.payload.contract.autoRenew, false)
  })
  await t('반려: 반려하면 안건이 만들어지지 않고 사유가 남는다', async () => {
    const s = await submit({ refId: 'CMP-0005' })
    await returnSubmission(sql, s.id, '마케팅 팀장', '추계서 보완 필요')
    const row = (await listSubmissions(sql)).find((x) => x.id === s.id)
    assert.equal(row.status, 'returned'); assert.equal(row.note, '추계서 보완 필요')
    const again = await allChecks(s.id, 'campaign')
    await assert.rejects(() => acceptSubmission(sql, cfg, s.id, '팀장', again), /이미 처리/)
  })
  await t('신규 ID: 원본에 없는 인플루언서·캠페인 ID 로 제출·접수할 수 있고, 이름·형식·중복을 검사한다', async () => {
    const inf = (over = {}) => ({ settlementDate: '2026-09-15', contractDeadline: '2026-07-26', requested: '300000000', memo: '시험', ...CONTRIB, isNewRef: '1', refName: '새별', ...over })
    const go = (values, refId = 'INF-011', category = 'influencer') => submitIntake(sql, { category, refId, values, files: NEW_FILES, by: '팀원' })
    await assert.rejects(() => go(inf({ refName: '' })), /이름/)
    await assert.rejects(() => go(inf(), 'INF-1'), /형식/)
    await assert.rejects(() => go(inf(), 'INF-001'), /이미 있는 분류ID입니다/)
    const s = await go(inf())
    assert.match(s.title, /새별\(INF-011\) 연간 전속계약 신규 — 고정 피 연 300,000,000원/)
    await assert.rejects(() => go(inf({ refName: '다른이름' })), /이미 있는 분류ID입니다/)
    assert.ok(checksFor('influencer', true).some((c) => c.id === 'newref')); assert.ok(!checksFor('influencer', false).some((c) => c.id === 'newref'))
    const need = await allChecks(s.id, 'influencer', true)
    await assert.rejects(() => acceptSubmission(sql, cfg, s.id, '팀장', need.filter((x) => x !== 'newref')), /확인하지 않은 항목/)
    const r = await acceptSubmission(sql, cfg, s.id, '팀장', need)
    const v = await E.getCaseView(sql, r.caseId)
    assert.equal(v.case.subjectRefs.influencer, 'INF-011'); assert.match(v.case.title, /새별\(INF-011\)/)
    assert.equal(v.case.payload.contract.currentExpiry, null, '신규 인플루언서는 현 계약 만료일이 없다')
    assert.match(v.case.title, /신규 전속계약 체결|새별/)
    assert.equal(v.case.payload.submission.newRef.name, '새별'); assert.equal(v.case.authority, 'masil_ceo', '3억(10억 이하)·지급일 구간 밖 → Masil 대표')
  })
  await t('신규 캠페인 ID: 소속 인플루언서(기존 또는 NONE)가 필요하고, 안건에 소속이 남는다', async () => {
    const base = { settlementDate: '2026-09-10', contractDeadline: '2026-07-11', requested: '5000000', memo: '시험', ...CONTRIB, isNewRef: '1', refName: '새 캠페인', productLine: '색조' }
    const go = (values) => submitIntake(sql, { category: 'campaign', refId: 'CMP-0026', values, files: NEW_FILES, by: '팀원' })
    await assert.rejects(() => go({ ...base, parentInfluencerId: 'INF-999' }), /소속 인플루언서/)
    await assert.rejects(() => go({ ...base, parentInfluencerId: 'INF-002', productLine: '' }), /제품 종류/)
    await assert.rejects(() => go({ ...base, parentInfluencerId: 'INF-002', productLine: '가구' }), /제품 종류는/)
    const s = await go({ ...base, parentInfluencerId: 'INF-002' })
    const r = await acceptSubmission(sql, cfg, s.id, '팀장', await allChecks(s.id, 'campaign', true))
    const v = await E.getCaseView(sql, r.caseId)
    assert.equal(v.case.subjectRefs.campaign, 'CMP-0026'); assert.equal(v.case.subjectRefs.influencer, 'INF-002'); assert.match(v.case.title, /SUB-\d+ 초혜핏 색조 캠페인4 신규 — 요청/); assert.equal(v.case.payload.submission.newRef.name, '초혜핏 색조 캠페인4')
  })
  await t('제목 자동 생성(원본 이름 방식): 캠페인은 "이름 확대|신규", 전속계약은 "이름(ID) 연간 전속계약 신규|갱신"이고, 겹치면 확대2·확대3 처럼 번호가 올라간다', async () => {
    const a = await submit({ refId: 'CMP-0007', values: campaignValues({ dealType: '확대' }) })
    assert.equal(a.title, '토모카 기초 캠페인1 확대 — 요청 15,000,000원'); assert.equal(a.input.productLine, '기초')
    const b = await submit({ refId: 'CMP-0007', values: campaignValues({ dealType: '확대' }) })
    assert.equal(b.title, '토모카 기초 캠페인1 확대2 — 요청 15,000,000원')
    const c = await submit({ refId: 'CMP-0007', values: campaignValues({ dealType: '확대', requested: '9000000' }) }) // 금액이 달라도 목록에 보이는 제목이 같으면 번호를 올린다
    assert.equal(c.title, '토모카 기초 캠페인1 확대3 — 요청 9,000,000원')
    const d = await submit({ refId: 'CMP-0007', values: campaignValues({ dealType: '신규' }) })
    assert.equal(d.title, '토모카 기초 캠페인1 신규 — 요청 15,000,000원')
    await assert.rejects(() => submit({ refId: 'CMP-0007', values: campaignValues({ dealType: '갱신' }) }), /구분은/)
    await assert.rejects(() => submit({ refId: 'CMP-0099', values: campaignValues({ dealType: '확대', isNewRef: '1', parentInfluencerId: 'NONE', productLine: '색조' }) }), /신규"로만/)
    // 새 캠페인: 이름 칸 없이 "인플루언서 제품종류 캠페인N"(N = 그 인플루언서의 다음 번호). 이미 제출된 새 캠페인도 번호에 센다.
    const nv = (over = {}) => ({ settlementDate: '2026-09-10', contractDeadline: '2026-07-11', requested: '5000000', memo: '시험', ...CONTRIB, isNewRef: '1', parentInfluencerId: 'INF-001', productLine: '색조', ...over })
    const n1 = await submitIntake(sql, { category: 'campaign', refId: 'CMP-0027', values: nv({ refName: '무시됨' }), files: NEW_FILES, by: '팀원' })
    assert.equal(n1.input.refName, '혜인 색조 캠페인4'); assert.equal(n1.title, '혜인 색조 캠페인4 신규 — 요청 5,000,000원')
    const n2 = await submitIntake(sql, { category: 'campaign', refId: 'CMP-0028', values: nv({ productLine: '기초' }), files: NEW_FILES, by: '팀원' })
    assert.equal(n2.input.refName, '혜인 기초 캠페인5'); assert.equal(n2.title, '혜인 기초 캠페인5 신규 — 요청 5,000,000원')
    // 전속계약: 구분 "신규"는 현 계약 만료일 없이도 올릴 수 있고, "갱신"은 만료일이 필요하다
    const base = { settlementDate: '2026-09-15', contractDeadline: '2026-07-26', feeType: '고정 피', fixedFee: '800000000', memo: '시험', ...CONTRIB }
    const e = await submitIntake(sql, { category: 'influencer', refId: 'INF-003', values: { ...base, dealType: '신규' }, files: INF_FILES, by: '팀원' })
    assert.equal(e.title, '토모카(INF-003) 연간 전속계약 신규 — 고정 피 연 800,000,000원'); assert.equal(e.input.currentExpiry, '')
    await assert.rejects(() => submitIntake(sql, { category: 'influencer', refId: 'INF-003', values: { ...base, dealType: '갱신' }, files: INF_FILES, by: '팀원' }), /현 계약 만료일/)
    // 구분이 "신규"면 기존 계약서가 없어 첨부하지 않아도 된다 (갱신이면 필수)
    await submitIntake(sql, { category: 'influencer', refId: 'INF-004', values: { ...base, dealType: '신규' }, files: NEW_FILES, by: '팀원' })
    await assert.rejects(() => submitIntake(sql, { category: 'influencer', refId: 'INF-004', values: { ...base, dealType: '갱신', currentExpiry: '2026-09-30', autoRenew: '자동 갱신' }, files: NEW_FILES, by: '팀원' }), /기존 계약서/)
    const f = await submitIntake(sql, { category: 'influencer', refId: 'INF-003', values: { ...base, dealType: '갱신', currentExpiry: '2026-09-30', autoRenew: '자동 갱신' }, files: INF_FILES, by: '팀원' })
    assert.match(f.title, /토모카\(INF-003\) 연간 전속계약 갱신\d* — 고정 피 연 800,000,000원/)
    const g = await submitIntake(sql, { category: 'influencer', refId: 'INF-003', values: { ...base, dealType: '갱신', currentExpiry: '2026-09-30', autoRenew: '자동 갱신' }, files: INF_FILES, by: '팀원' })
    assert.notEqual(g.title, f.title); assert.match(g.title, /갱신\d+ — /)
    // 접수하면 안건 제목도 이 제목을 쓴다 (캠페인은 앞에 SUB-번호)
    const r = await acceptSubmission(sql, cfg, f.id, '팀장', await allChecks(f.id, 'influencer'))
    assert.equal((await E.getCaseView(sql, r.caseId)).case.title, f.title)
    const r2 = await acceptSubmission(sql, cfg, a.id, '팀장', await allChecks(a.id, 'campaign'))
    assert.equal((await E.getCaseView(sql, r2.caseId)).case.title, `SUB-${a.id} ${a.title}`)
  })
  await t('첨부 종류: 기안서·추계서는 필수, 기존 계약서는 갱신·확대에서만 필수(신규 ID 는 칸 없음), 그 밖에는 종류 이름을 직접 적어 여러 개 추가할 수 있다', async () => {
    assert.deepEqual(ATTACHMENT_KINDS.filter((k) => k.required).map((k) => k.id), ['draft', 'estimate'])
    assert.deepEqual(ATTACHMENT_KINDS.filter((k) => !k.required).map((k) => k.id), ['contract', 'consult'])
    assert.deepEqual(requiredKinds('campaign').map((k) => k.id), ['draft', 'estimate', 'contract'])
    assert.deepEqual(requiredKinds('campaign', true).map((k) => k.id), ['draft', 'estimate'])
    assert.deepEqual(kindsFor(true).map((k) => k.id), ['draft', 'estimate', 'consult'])
    // 갱신(원본에 있는 인플루언서)·확대(원본에 있는 캠페인)는 기존 계약서 없이 올릴 수 없다
    await assert.rejects(() => submit({ refId: 'CMP-0005', files: NEW_FILES }), /기존 계약서/)
    await assert.rejects(() => submitIntake(sql, { category: 'influencer', refId: 'INF-003', values: { settlementDate: '2026-09-15', contractDeadline: '2026-08-22', requested: '500000000', currentExpiry: '2026-10-31', autoRenew: '자동 갱신', memo: '시험', ...CONTRIB }, files: NEW_FILES, by: '팀원' }), /기존 계약서/)
    // 신규 ID 는 기존 계약이 없어서 기존 계약서를 올릴 수 없다
    await assert.rejects(() => submitIntake(sql, { category: 'campaign', refId: 'CMP-0029', values: { settlementDate: '2026-09-10', contractDeadline: '2026-07-11', requested: '5000000', memo: '시험', ...CONTRIB, isNewRef: '1', parentInfluencerId: 'NONE', productLine: '색조' }, files: REQUIRED_FILES, by: '팀원' }), /기존 계약이 없어서/)
    // 필수 항목을 채우지 않고 제출한 건의 부족 목록에도 반영된다
    assert.ok(missingRequired('campaign', { isNewRef: '' }, ['draft', 'estimate']).includes('첨부: 기존 계약서'))
    assert.ok(!missingRequired('campaign', { isNewRef: '1' }, ['draft', 'estimate']).includes('첨부: 기존 계약서'))
    // 접수 체크: 기존 계약서 확인 항목은 갱신·확대에만 있다
    assert.ok(checksFor('influencer').some((c) => c.id === 'terms') && checksFor('campaign').some((c) => c.id === 'terms'))
    assert.ok(!checksFor('influencer', true).some((c) => c.id === 'terms') && !checksFor('campaign', true).some((c) => c.id === 'terms'))
    const s = await submit({ refId: 'CMP-0006', files: [...REQUIRED_FILES, custom('예상 GMV', 'gmv.csv'), custom('예상 GMV', 'gmv2.csv'), custom('주문 기록', 'orders.csv')] })
    const f = await listFiles(sql, s.id)
    assert.deepEqual(f.filter((x) => x.kind === 'custom').map((x) => `${x.label}:${x.filename}`).sort(), ['예상 GMV:gmv.csv', '예상 GMV:gmv2.csv', '주문 기록:orders.csv'])
  })

  await t('기안 접수 → 재무팀 회부(300억 판정) → 계약 담당 회부(계약서 첨부) → 승인권자 결정 순서로만 흘러간다', async () => {
    // 전속계약 갱신: 기존 계약서를 첨부해 제출·접수한다 (협의서는 선택)
    const noContract = await submitIntake(sql, { category: 'influencer', refId: 'INF-004', values: { settlementDate: '2026-09-15', contractDeadline: '2026-08-22', requested: '500000000', currentExpiry: '2026-10-31', autoRenew: '자동 갱신', memo: '시험', ...CONTRIB }, files: REQUIRED_FILES, by: '팀원' })
    await acceptSubmission(sql, cfg, noContract.id, '팀장', await allChecks(noContract.id, 'influencer'))
    // 팀원들이 올린 안건을 하나의 기안에 모아 접수한다
    const first = await submit({ refId: 'CMP-0007' })
    const r1 = await acceptSubmission(sql, cfg, first.id, '팀장', await allChecks(first.id, 'campaign'))
    const [d1] = await sql`SELECT draft_id FROM decision_cases WHERE id = ${r1.caseId}`
    const second = await submit({ refId: 'CMP-0008' })
    const r2 = await acceptSubmission(sql, cfg, second.id, '팀장', await allChecks(second.id, 'campaign'), Number(d1.draft_id))
    const [d2] = await sql`SELECT draft_id FROM decision_cases WHERE id = ${r2.caseId}`
    assert.equal(d2.draft_id, d1.draft_id, '같은 기안에 모인다')
    const third = await submit({ refId: 'CMP-0009' })
    const thirdChecks = await allChecks(third.id, 'campaign')
    await assert.rejects(() => acceptSubmission(sql, cfg, third.id, '팀장', thirdChecks, 99999), /기안/)

    const { financeRefer, contractRefer, addCaseFile, listCaseFiles } = await import('@/lib/modules/w02/handoff')
    const v0 = await E.getCaseView(sql, r2.caseId)
    assert.equal(v0.approvals.find((a) => a.status === 'pending'), undefined, '300억 연결 여부를 모르면 승인권자가 정해지지 않아 승인 요청도 없다')
    // 재무 회부 전에는 계약서를 올릴 수도, 계약 담당이 회부할 수도 없다
    await assert.rejects(() => contractRefer(sql, r2.caseId, '계약 담당'), /재무팀 회부 전|계약서/)
    // 재무 회부: 300억 검토 대상으로 처리 → 승인권자가 CEO/이사회
    const f = await financeRefer(sql, cfg, r2.caseId, { linked: true, by: '재무팀' })
    assert.equal(f.authorityLabel, 'CEO/이사회')
    await assert.rejects(() => financeRefer(sql, cfg, r2.caseId, { linked: true, by: '재무팀' }), /재무팀이 처리할 단계가 아니에요/)
    // 계약 담당: 계약서 없이는 회부할 수 없다
    await assert.rejects(() => contractRefer(sql, r2.caseId, '계약 담당'), /계약서를 먼저/)
    await addCaseFile(sql, { caseId: r2.caseId, kind: 'contract', filename: 'contract.txt', mime: 'text/plain', content: Buffer.from('계약서'), by: '계약 담당' })
    assert.equal((await listCaseFiles(sql, r2.caseId)).length, 1)
    await contractRefer(sql, r2.caseId, '계약 담당')
    const v1 = await E.getCaseView(sql, r2.caseId)
    const ap2 = v1.approvals.find((a) => a.status === 'pending')
    assert.equal(ap2.requiredRole, 'ceo_board')
    const dec = await E.decide(sql, cfg, ap2.id, { outcome: 'approved', byRole: 'ceo_board', byName: 'CEO' })
    assert.equal(dec.outcome, 'approved')
    // 300억 '대상 아님'으로 정한 안건은 승인권자가 평시 규정을 따른다
    const f2 = await financeRefer(sql, cfg, r1.caseId, { linked: false, by: '재무팀' })
    assert.notEqual(f2.authorityLabel, null)
  })

  await t('필수 항목 없이 제출: 허용 표시를 하면 비어 있어도 제출되지만, 형식 오류는 막고 접수는 보완 전까지 못 한다', async () => {
    const bare = { category: 'campaign', refId: 'CMP-0010', values: { memo: '일부만' }, files: [], by: '팀원' }
    await assert.rejects(() => submitIntake(sql, bare), /입력해 주세요/) // 허용하지 않으면 그대로 막힌다
    await assert.rejects(() => submitIntake(sql, { ...bare, values: { settlementDate: '7월 1일' }, allowIncomplete: true }), /YYYY-MM-DD/) // 형식은 여전히 검사
    const s = await submitIntake(sql, { ...bare, allowIncomplete: true })
    assert.match(s.title, /금액 미입력/); assert.equal(s.input.incomplete, '1')
    const checks = await allChecks(s.id, 'campaign')
    await assert.rejects(() => acceptSubmission(sql, cfg, s.id, '팀장', checks), /필수 항목이 비어 있어/)
    await returnSubmission(sql, s.id, '마케팅 팀장', '필수 항목 보완 필요')
    assert.equal((await listSubmissions(sql)).find((x) => x.id === s.id).status, 'returned')
  })

  await t('연관 안건 경고: 캠페인은 전속계약 불승인이 1건이라도 있으면, 전속계약은 최근 캠페인이 불승인이거나 최근 5건 중 2건 이상 불승인이면 경고한다', async () => {
    const { relatedWarning } = await import('@/lib/app/related-warning')
    const row = (id, category, status, deadline, influencerId = 'INF-001') => ({ id, title: `T${id}`, code: `C${id}`, category, status, outcome: status === 'open' ? null : status, deadline, influencerId })
    const camp = { category: 'campaign', influencerId: 'INF-001', id: 100 }
    const contract = { category: 'influencer', influencerId: 'INF-001', id: 200 }
    // 캠페인: 전속계약 불승인 1건
    assert.equal(relatedWarning(camp, [row(1, 'influencer', 'approved', '2025-01-01')], '혜인'), null)
    assert.match(relatedWarning(camp, [row(1, 'influencer', 'rejected', '2025-01-01')], '혜인'), /전속계약 갱신이 부결된 안건이 1건/)
    assert.equal(relatedWarning(camp, [row(1, 'influencer', 'rejected', '2025-01-01', 'INF-002')], '혜인'), null, '다른 인플루언서는 해당 없음')
    // 전속계약: 가장 최근 캠페인 불승인
    assert.match(relatedWarning(contract, [row(1, 'campaign', 'approved', '2025-01-01'), row(2, 'campaign', 'rejected', '2025-06-01')], '혜인'), /가장 최근 캠페인/)
    // 최근 5건 중 2건 이상 (가장 최근은 승인)
    const five = [row(1, 'campaign', 'approved', '2025-06-01'), row(2, 'campaign', 'rejected', '2025-05-01'), row(3, 'campaign', 'approved', '2025-04-01'), row(4, 'campaign', 'rejected', '2025-03-01'), row(5, 'campaign', 'approved', '2025-02-01')]
    assert.match(relatedWarning(contract, five, '혜인'), /5건 중 2건/)
    // 6번째(5건 밖)의 불승인은 세지 않고, 아직 결정 안 된 안건도 세지 않는다
    assert.equal(relatedWarning(contract, [...five.map((r) => (r.status === 'rejected' && r.id === 4 ? { ...r, status: 'approved', outcome: 'approved' } : r)), row(6, 'campaign', 'rejected', '2024-01-01'), row(7, 'campaign', 'open', '2025-12-01')], '혜인'), null)
  })

  await t('계약 담당이 올린 계약서는 그 단계가 열려 있는 동안 뺄 수 있고, 다음 단계로 넘어가면 뺄 수 없다', async () => {
    const { addCaseFile, removeCaseFile, listCaseFiles, contractRefer, financeRefer } = await import('@/lib/modules/w02/handoff')
    const s = await submitIntake(sql, { category: 'influencer', refId: 'INF-005', values: { settlementDate: '2026-09-15', contractDeadline: '2026-08-24', requested: '400000000', currentExpiry: '2026-10-31', autoRenew: '자동 갱신', memo: '시험', ...CONTRIB }, files: INF_FILES, by: '팀원' })
    const r = await acceptSubmission(sql, cfg, s.id, '팀장', await allChecks(s.id, 'influencer'))
    const id = await addCaseFile(sql, { caseId: r.caseId, kind: 'contract', filename: 'c.txt', mime: 'text/plain', content: Buffer.from('x'), by: '계약 담당' })
    assert.equal((await listCaseFiles(sql, r.caseId)).length, 1)
    await removeCaseFile(sql, id, '계약 담당')
    assert.equal((await listCaseFiles(sql, r.caseId)).length, 0)
    await assert.rejects(() => addCaseFile(sql, { caseId: r.caseId, kind: 'notice', filename: 'n.txt', mime: 'text/plain', content: Buffer.from('x'), by: '계약 담당' }), /단계가 아니라서 통보 회신 증빙/)
    const id2 = await addCaseFile(sql, { caseId: r.caseId, kind: 'contract', filename: 'c2.txt', mime: 'text/plain', content: Buffer.from('x'), by: '계약 담당' })
    await financeRefer(sql, cfg, r.caseId, { linked: false, by: '재무팀' })
    await contractRefer(sql, r.caseId, '계약 담당')
    await assert.rejects(() => removeCaseFile(sql, id2, '계약 담당'), /다음 단계로 넘어가서/)
  })

  await t('성과 피 비율: 선택 입력이고, 적으면 0 초과 100 이하여야 하며 계약 안건에 남는다', async () => {
    const vals = { settlementDate: '2026-09-15', contractDeadline: '2026-08-25', currentExpiry: '2026-10-31', autoRenew: '자동 갱신', memo: '시험', ...CONTRIB, feeType: '혼합 피', fixedFee: '300000000', performanceFee: '50000000' }
    const go = (over = {}) => submitIntake(sql, { category: 'influencer', refId: 'INF-006', values: { ...vals, ...over }, files: REQUIRED_FILES, by: '팀원' })
    await assert.rejects(() => go({ performanceRate: '150' }), /0보다 크고 100 이하/)
    await assert.rejects(() => go({ performanceRate: '0' }), /0보다 크고 100 이하/)
    const noRate = await go(); assert.equal(noRate.input.performanceRate, '') // 비율은 몰라도 제출된다
    const s = await submitIntake(sql, { category: 'influencer', refId: 'INF-007', values: { ...vals, performanceRate: '5' }, files: REQUIRED_FILES, by: '팀원' })
    assert.equal(s.input.performanceRate, '5')
    const r = await acceptSubmission(sql, cfg, s.id, '팀장', await allChecks(s.id, 'influencer'))
    const v = await E.getCaseView(sql, r.caseId)
    assert.equal(v.case.payload.contract.performanceRate, 5); assert.equal(v.case.payload.contract.feeType, '혼합 피')
    // 고정 피 방식이면 비율은 버려진다
    const fixedOnly = await submitIntake(sql, { category: 'influencer', refId: 'INF-008', values: { ...vals, feeType: '고정 피', performanceFee: '', performanceRate: '5' }, files: REQUIRED_FILES, by: '팀원' })
    assert.equal(fixedOnly.input.performanceRate, '')
  })

  console.log(`\n${n}개 시험 모두 통과`)
} finally {
  await sql.end()
}
