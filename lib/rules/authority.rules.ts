// 승인권한 규칙 "데이터". 판정 로직은 evaluate.ts 에 있고 여기에는 표만 있다.
// 규칙을 고치거나 다른 업무의 규칙을 추가할 때는 이 파일만 건드린다.
//
// 출처: 04_원본데이터/00_common/approval_authority_policy.md,
//       04_원본데이터/02_masil/financials/covenant_terms_ms.md
//
// 사실(facts)로 쓰는 이름 (안건을 만드는 쪽이 채워 준다. 모르면 null):
//   annual_contract_value_krw  전속계약 연 고정 피(원)
//   per_plan_amount_krw        기안 한 건의 요청액(원)
//   draft_total_krw            같은 기안 묶음의 요청 총액(원)
//   creates_cash_outflow       이 결정이 현금 유출을 만드는가
//   in_cash_breach_window      그 유출일이 현금 하회 예상 구간 안인가 (현금 재전망 결과)
//   linked_to_group_300        그룹 300억 배분 사업과 연결되는가
import type { Role, Rule } from './types'

export const ROLES: readonly Role[] = [
  { id: 'marketing_team', label: '마케팅팀', rank: 1 },
  { id: 'scm', label: 'SCM', rank: 2 },
  { id: 'masil_ceo', label: 'Masil 대표', rank: 2 },
  { id: 'ceo_board', label: 'CEO/이사회', rank: 3 },
  { id: 'group_ceo', label: '그룹 CEO', rank: 3 },
]

const POLICY = '00_common/approval_authority_policy.md'
const COVENANT = '02_masil/financials/covenant_terms_ms.md'

const TEN_MILLION = 10_000_000 // 1천만 원
const HUNDRED_MILLION = 100_000_000 // 1억 원
const ONE_BILLION = 1_000_000_000 // 10억 원

export const AUTHORITY_RULES: readonly Rule[] = [
  // ── 업무 규칙 ────────────────────────────────────────────────
  {
    id: 'AUTH-CONTRACT-OVER-10E',
    title: '인플루언서 연간 전속계약, 연 10억 원 초과',
    appliesTo: ['w02.contract_renewal'],
    all: [{ fact: 'annual_contract_value_krw', op: 'gt', value: ONE_BILLION }],
    outcome: { authority: 'ceo_board' },
    layer: 'business',
    source: { file: POLICY, note: '연 10억원 초과 시 CEO/이사회. 미통보 자동 갱신도 체결로 본다' },
    origin: '원본',
    remark: '연 금액은 고정 피 기준이다. 성과 피(GMV 연동)는 계약 원문이 없어 더하지 않았다 → 실제 금액은 이보다 클 수 있다.',
  },
  {
    id: 'AUTH-CONTRACT-UNDER-10E',
    title: '인플루언서 연간 전속계약, 연 10억 원 이하',
    appliesTo: ['w02.contract_renewal'],
    all: [{ fact: 'annual_contract_value_krw', op: 'lte', value: ONE_BILLION }],
    outcome: { authority: 'masil_ceo' },
    layer: 'business',
    source: { file: POLICY, note: '10억원 이하는 Masil 대표' },
    origin: '원본',
  },
  {
    id: 'AUTH-EXPANSION-SMALL',
    title: '캠페인 확대 기안, 건당 1천만 원 이하이고 기안 총액 1억 원 이하',
    appliesTo: ['w02.campaign_expansion'],
    all: [
      { fact: 'per_plan_amount_krw', op: 'lte', value: TEN_MILLION },
      { fact: 'draft_total_krw', op: 'lte', value: HUNDRED_MILLION },
    ],
    outcome: { authority: 'marketing_team' },
    layer: 'business',
    source: { file: POLICY, note: '건별 1천만원 이하는 마케팅팀 전결' },
    origin: '원본',
  },
  {
    id: 'AUTH-EXPANSION-LARGE',
    title: '캠페인 확대 기안, 건당 1천만 원 초과 또는 기안 총액 1억 원 초과',
    appliesTo: ['w02.campaign_expansion'],
    any: [
      { fact: 'per_plan_amount_krw', op: 'gt', value: TEN_MILLION },
      { fact: 'draft_total_krw', op: 'gt', value: HUNDRED_MILLION },
    ],
    outcome: { authority: 'masil_ceo', also: ['그룹 보고'] },
    layer: 'business',
    source: { file: POLICY, note: '초과 또는 기안 총액 1억원 초과 시 Masil 대표 승인 + 그룹 보고' },
    origin: '원본',
    remark:
      '"기안 총액"은 mkt_budget_plan_ms.csv 의 요청액 합계(약 1.81억)로 해석했다. 회의록도 "총액 기준상 전결 범위를 넘는지 확인 필요"라고만 한다 → 해석 가정.',
  },

  // ── 두 번째 업무 예: 재고 발주 (W01) — 엔진은 그대로이고 규칙만 추가했다 ──────
  {
    id: 'AUTH-PO-SCM',
    title: '재고 발주 승인 (평시)',
    appliesTo: ['w01.purchase_order'],
    all: [{ fact: 'creates_cash_outflow', op: 'eq', value: true }],
    outcome: { authority: 'scm' },
    layer: 'business',
    source: { file: POLICY, note: '재고 발주 승인은 SCM' },
    origin: '원본',
    remark: '평시 규정이다. 현금 하회 예상 구간에 대금이 나가면 아래 공통 규칙이 이 전결을 무력화한다.',
  },

  // ── 공통 규칙 (모든 업무, 평시 전결 규정에 우선) ───────────────────
  {
    id: 'COMMON-COVENANT-WINDOW',
    title: '현금 하회 예상 구간에 나가는 신규 약정',
    appliesTo: ['*'],
    all: [
      { fact: 'creates_cash_outflow', op: 'eq', value: true },
      { fact: 'in_cash_breach_window', op: 'eq', value: true },
    ],
    outcome: { authority: 'group_ceo' },
    layer: 'common',
    source: { file: COVENANT, note: '하회 예상 구간의 신규 약정은 종류·금액 불문 그룹 CEO 승인. 평시 전결 권한은 효력을 잃는다' },
    origin: '원본',
    remark: '재원 기준이다 — 자회사 예산으로 집행해도 같은 구간이면 해당한다(approval_authority_policy.md).',
  },
  {
    id: 'COMMON-GROUP-FUND-300',
    title: '그룹 300억 배분 사업과 연결되는 건',
    appliesTo: ['*'],
    all: [{ fact: 'linked_to_group_300', op: 'eq', value: true }],
    outcome: { authority: 'ceo_board' },
    layer: 'common',
    source: { file: POLICY, note: '300억 최종 배분은 CEO/이사회' },
    origin: '가정',
    remark: '마케팅 기안이 300억 사업에 해당하는지는 원본에서 확인되지 않는다(mkt_meeting_notes_ms.md: 회의에서 정리되지 않음). 연결 여부를 모르면 확인 요청으로 처리한다.',
  },
]
