// 승인권한 규칙집 시험.  node scripts/test-rules.mjs
// 기대값은 approval_authority_policy.md / covenant_terms_ms.md 의 문장에서 직접 가져왔다.
import assert from 'node:assert/strict'
import { decideAuthority } from '../lib/rules/evaluate.ts'
import { AUTHORITY_RULES, ROLES } from '../lib/rules/authority.rules.ts'

const run = (type, facts) => decideAuthority(type, facts, AUTHORITY_RULES, ROLES)
let n = 0
const t = (name, fn) => { fn(); n++; console.log('✔', name) }

// ── 전속계약 ──
t('전속계약 28억(10억 초과) → CEO/이사회', () => {
  const d = run('w02.contract_renewal', { annual_contract_value_krw: 2_800_000_000, creates_cash_outflow: true, in_cash_breach_window: false, linked_to_group_300: false })
  assert.equal(d.status, 'decided'); assert.equal(d.authority, 'ceo_board')
})
t('전속계약 8억(10억 이하) → Masil 대표', () => {
  const d = run('w02.contract_renewal', { annual_contract_value_krw: 800_000_000, creates_cash_outflow: true, in_cash_breach_window: false, linked_to_group_300: false })
  assert.equal(d.authority, 'masil_ceo')
})
t('전속계약 8억 + 하회 구간 안 → 평시 전결(Masil 대표)이 효력을 잃고 CEO/이사회', () => {
  const d = run('w02.contract_renewal', { annual_contract_value_krw: 800_000_000, creates_cash_outflow: true, in_cash_breach_window: true, linked_to_group_300: false })
  assert.equal(d.authority, 'ceo_board')
})
t('전속계약 28억 + 하회 여부 모름 → 이미 최고 권한이라 묻지 않고 확정', () => {
  const d = run('w02.contract_renewal', { annual_contract_value_krw: 2_800_000_000, creates_cash_outflow: true, in_cash_breach_window: null, linked_to_group_300: null })
  assert.equal(d.status, 'decided'); assert.equal(d.unresolved.length, 0)
})

// ── 캠페인 확대 기안 ──
t('기안 500만 원 + 총액 5천만 원 → 마케팅팀', () => {
  const d = run('w02.campaign_expansion', { per_plan_amount_krw: 5_000_000, draft_total_krw: 50_000_000, creates_cash_outflow: true, in_cash_breach_window: false, linked_to_group_300: false })
  assert.equal(d.authority, 'marketing_team'); assert.deepEqual(d.also, [])
})
t('기안 500만 원이라도 총액 1.81억(1억 초과) → Masil 대표 + 그룹 보고', () => {
  const d = run('w02.campaign_expansion', { per_plan_amount_krw: 5_000_000, draft_total_krw: 180_803_272, creates_cash_outflow: true, in_cash_breach_window: false, linked_to_group_300: false })
  assert.equal(d.authority, 'masil_ceo'); assert.deepEqual(d.also, ['그룹 보고'])
})
t('기안 500만 원 + 총액 5천만 원 + 하회 구간 안 → 금액이 작아도 CEO/이사회', () => {
  const d = run('w02.campaign_expansion', { per_plan_amount_krw: 5_000_000, draft_total_krw: 50_000_000, creates_cash_outflow: true, in_cash_breach_window: true, linked_to_group_300: false })
  assert.equal(d.authority, 'ceo_board')
})

// ── 정보 부족 ──
t('하회 구간 여부를 모르면 → 마케팅팀으로 확정하지 않고 확인 필요', () => {
  const d = run('w02.campaign_expansion', { per_plan_amount_krw: 5_000_000, draft_total_krw: 50_000_000, creates_cash_outflow: true, in_cash_breach_window: null, linked_to_group_300: false })
  assert.equal(d.status, 'need_info')
  assert.ok(d.unresolved.some((u) => u.missingFacts.includes('in_cash_breach_window')))
})
t('300억 연결 여부를 모르면 → 확인 필요, 답이 "연결됨"이면 CEO/이사회', () => {
  const base = { per_plan_amount_krw: 5_000_000, draft_total_krw: 50_000_000, creates_cash_outflow: true, in_cash_breach_window: false }
  const d1 = run('w02.campaign_expansion', { ...base, linked_to_group_300: null })
  assert.equal(d1.status, 'need_info')
  assert.ok(d1.unresolved.some((u) => u.missingFacts.includes('linked_to_group_300')))
  const d2 = run('w02.campaign_expansion', { ...base, linked_to_group_300: true })
  assert.equal(d2.status, 'decided'); assert.equal(d2.authority, 'ceo_board')
  const d3 = run('w02.campaign_expansion', { ...base, linked_to_group_300: false })
  assert.equal(d3.authority, 'marketing_team')
})

// ── 규칙 없음 ──
t('규칙이 없는 안건 유형 → 임의로 정하지 않고 no_rule', () => {
  const d = run('unknown.type', {})
  assert.equal(d.status, 'no_rule'); assert.equal(d.authority, null)
})

// ── 설명(trace) ──
t('판정마다 근거 설명(trace)이 남는다', () => {
  const d = run('w02.contract_renewal', { annual_contract_value_krw: 2_800_000_000, creates_cash_outflow: true, in_cash_breach_window: false, linked_to_group_300: false })
  assert.ok(d.trace.some((s) => s.includes('approval_authority_policy.md')))
  console.log('   trace 예:', d.trace.join(' | '))
})

console.log(`\n${n}개 시험 모두 통과`)
