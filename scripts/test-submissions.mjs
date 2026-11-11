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
  ATTACHMENT_KINDS, CATEGORIES, acceptSubmission, checksFor, fileCheckId, contributionFromInput, getFile, listFiles, listSubmissions, returnSubmission, submitIntake,
} from '@/lib/modules/intake/submissions'

const { sql, cfg } = await getEngine()
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }
const user = (roles) => ({ authenticated: true, email: 'x', name: 'x', roles, isAdmin: false })
const doc = (kind, name = `${kind}.txt`) => ({ kind, filename: name, mime: 'text/plain', content: Buffer.from(`시험 ${kind}`) })
const REQUIRED_FILES = ['draft', 'estimate'].map((k) => doc(k))
const custom = (label, name = `${label}.txt`) => ({ ...doc('custom', name), label })
const CONTRIB = { gmvMan: '10000', refundMan: '1000', cogsMan: '3000', channelFeeMan: '700', shippingMan: '400', returnLogisticsMan: '100' }
const campaignValues = (over = {}) => ({ settlementDate: '2026-09-10', contractDeadline: '2026-07-10', requestedMan: '1500', memo: '시험', ...CONTRIB, ...over })
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
      assert.equal(canAcceptCategory(user(['masil_ceo']), c.acceptRole), true)
    }
  })
  await t('제출: 필수 첨부·ID 형식·날짜·공헌이익 빈칸이 하나라도 문제면 거부한다', async () => {
    await assert.rejects(() => submit({ files: [doc('draft')] }), /비용 및 성과 추계서/)
    await assert.rejects(() => submit({ refId: 'CMP-1' }), /형식/)
    await assert.rejects(() => submit({ refId: 'CMP-9999' }), /찾을 수 없어요/)
    await assert.rejects(() => submit({ values: campaignValues({ contractDeadline: '7월 10일' }) }), /YYYY-MM-DD/)
    await assert.rejects(() => submit({ values: campaignValues({ cogsMan: '' }) }), /모두 채워/)
    await assert.rejects(() => submit({ values: campaignValues({ requestedMan: '0' }) }), /0보다/)
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
    assert.deepEqual(files.map((f) => f.kind).sort(), ['draft', 'estimate'])
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
  await t('전속계약 접수: 인플루언서 제출은 계약 안건이 되고 현 계약 만료일이 필요하다 (인플루언서 계약만 체크리스트에 계약서·조건 확인 항목이 있다)', async () => {
    assert.ok(checksFor('influencer').some((c) => c.id === 'terms')); assert.ok(!checksFor('campaign').some((c) => c.id === 'terms'))
    const values = { settlementDate: '2026-09-15', contractDeadline: '2026-07-22', requestedMan: '80000', currentExpiry: '2026-09-30', memo: '시험', ...CONTRIB }
    await assert.rejects(() => submitIntake(sql, { category: 'influencer', refId: 'INF-003', values: { ...values, currentExpiry: '' }, files: REQUIRED_FILES, by: '팀원' }), /현 계약 만료일/)
    const s = await submitIntake(sql, { category: 'influencer', refId: 'INF-003', values, files: [...REQUIRED_FILES, doc('contract')], by: '팀원' })
    const r = await acceptSubmission(sql, cfg, s.id, '팀장', await allChecks(s.id, 'influencer'))
    const v = await E.getCaseView(sql, r.caseId)
    assert.equal(v.case.caseType, 'w02.contract_renewal'); assert.equal(v.case.authority, 'masil_ceo', '연 8억 + 지급일 구간 밖 → Masil 대표')
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
    const inf = (over = {}) => ({ settlementDate: '2026-09-15', contractDeadline: '2026-07-26', requestedMan: '30000', memo: '시험', ...CONTRIB, isNewRef: '1', refName: '새별', ...over })
    const go = (values, refId = 'INF-011', category = 'influencer') => submitIntake(sql, { category, refId, values, files: REQUIRED_FILES, by: '팀원' })
    await assert.rejects(() => go(inf({ refName: '' })), /이름/)
    await assert.rejects(() => go(inf(), 'INF-1'), /형식/)
    await assert.rejects(() => go(inf(), 'INF-001'), /이미 있는 ID/)
    const s = await go(inf())
    assert.match(s.title, /새별\(INF-011\).*\[신규 ID\]/)
    await assert.rejects(() => go(inf({ refName: '다른이름' })), /다른 신규 제출/)
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
    const base = { settlementDate: '2026-09-10', contractDeadline: '2026-07-11', requestedMan: '500', memo: '시험', ...CONTRIB, isNewRef: '1', refName: '새 캠페인' }
    const go = (values) => submitIntake(sql, { category: 'campaign', refId: 'CMP-0026', values, files: REQUIRED_FILES, by: '팀원' })
    await assert.rejects(() => go({ ...base, parentInfluencerId: 'INF-999' }), /소속 인플루언서/)
    const s = await go({ ...base, parentInfluencerId: 'INF-002' })
    const r = await acceptSubmission(sql, cfg, s.id, '팀장', await allChecks(s.id, 'campaign', true))
    const v = await E.getCaseView(sql, r.caseId)
    assert.equal(v.case.subjectRefs.campaign, 'CMP-0026'); assert.equal(v.case.subjectRefs.influencer, 'INF-002'); assert.match(v.case.title, /새 캠페인/)
  })
  await t('첨부 종류: 기안서·추계서는 필수, 계약서는 선택이고, 그 밖에는 종류 이름을 직접 적어 여러 개 추가할 수 있다', async () => {
    assert.deepEqual(ATTACHMENT_KINDS.filter((k) => k.required).map((k) => k.id), ['draft', 'estimate'])
    assert.deepEqual(ATTACHMENT_KINDS.filter((k) => !k.required).map((k) => k.id), ['contract'])
    const s = await submit({ refId: 'CMP-0006', files: [...REQUIRED_FILES, custom('예상 GMV', 'gmv.csv'), custom('예상 GMV', 'gmv2.csv'), custom('주문 기록', 'orders.csv')] })
    const f = await listFiles(sql, s.id)
    assert.deepEqual(f.filter((x) => x.kind === 'custom').map((x) => `${x.label}:${x.filename}`).sort(), ['예상 GMV:gmv.csv', '예상 GMV:gmv2.csv', '주문 기록:orders.csv'])
  })

  console.log(`\n${n}개 시험 모두 통과`)
} finally {
  await sql.end()
}
