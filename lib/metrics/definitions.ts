// 지표 사전 — 지표의 정의를 이 한 곳에만 둔다. 화면·판단·보고가 모두 이 정의를 쓴다.
// 정의의 원문: 04_원본데이터/00_common/calculation_definitions.md, data_dictionary.md, A05(데이터 이용 기준)
// 다른 파일을 import 하지 않는다.

export interface MetricDefinition {
  id: string
  label: string
  /** 사람이 읽는 계산식 */
  formula: string
  unit: string
  /** 모집단·기간·귀속 기준 (A05: 지표를 쓰기 전에 먼저 적는다) */
  basis: string
  sources: readonly string[]
  /** 원본 정의 파일에서 온 정의인가, 내가 정의한 지표인가 */
  origin: '원본 정의' | '신규 정의'
  caveats: readonly string[]
}

const SAMPLE_WARNING =
  '대표 표본 자료다. 순위·비중·방향 비교에만 쓰고, 연간 예산·전사 매출 같은 풀스케일 금액과 곱하거나 합산하지 않는다(data_dictionary.md 6항).'

export const METRICS: readonly MetricDefinition[] = [
  {
    id: 'gmv',
    label: 'GMV',
    formula: '쿠폰 반영 후 주문금액의 합 (mkt_orders_ms.gmv_krw)',
    unit: '원(VAT 제외)',
    basis: '주문일 기준, 캠페인(last-click 7일 귀속)에 연결된 주문',
    sources: ['02_masil/marketing/mkt_orders_ms.csv', '02_masil/master/m_campaign_ms.csv'],
    origin: '원본 정의',
    caveats: [SAMPLE_WARNING, 'GMV 는 이미 쿠폰이 반영된 금액이라 쿠폰을 다시 빼지 않는다.'],
  },
  {
    id: 'refund',
    label: '반품환불액',
    formula: '원 주문에 연결된 환불액(refund_amount_krw)의 합',
    unit: '원',
    basis: '원 주문 기준 연결(주문 집단 + 기준일까지 확인된 환불). 승인일(refund_completed_date) 기준 기간 집계와는 다를 수 있다.',
    sources: ['02_masil/marketing/mkt_returns_ms.csv'],
    origin: '원본 정의',
    caveats: [SAMPLE_WARNING],
  },
  {
    id: 'net_revenue',
    label: 'Net Revenue',
    formula: 'GMV − 반품환불액',
    unit: '원',
    basis: 'GMV 와 같은 주문 집단',
    sources: ['calculation_definitions.md 1.4'],
    origin: '원본 정의',
    caveats: [SAMPLE_WARNING],
  },
  {
    id: 'marketing_spend',
    label: 'Marketing Spend',
    formula: 'mkt_ad_spend_ms.ad_cost_krw 의 합 (인플루언서 + 퍼포먼스 + 오프라인 전액)',
    unit: '원',
    basis: '캠페인에 귀속된 광고비 전액. influencer_fee_krw 는 ad_cost_krw 에 이미 포함이라 다시 더하지 않는다.',
    sources: ['02_masil/marketing/mkt_ad_spend_ms.csv'],
    origin: '원본 정의',
    caveats: [SAMPLE_WARNING],
  },
  {
    id: 'contribution_profit',
    label: '실질 공헌이익',
    formula:
      'Net Revenue − 제품원가 − 채널수수료 − 출고(배송)비 − 반품 물류비 − Marketing Spend  (쿠폰은 GMV 에 이미 반영되어 다시 빼지 않음)',
    unit: '원',
    basis: '주문 집단 기준. 원가·배송비는 주문 1건에 적용 단위(가정)만큼, 반품 물류비는 환불 건에만 적용',
    sources: [
      'calculation_definitions.md 1.4',
      'A05 5장',
      '02_masil/marketing/mkt_cost_master_ms.csv',
    ],
    origin: '원본 정의',
    caveats: [
      SAMPLE_WARNING,
      '주문 행에 수량이 없어 "주문당 적용 단위"는 가정이다(PerfAssumptions.unitsPerOrder).',
      '환불 시 원가·수수료 회수는 자료가 없어 기본값은 회수하지 않음. 회수 가정은 별도 시나리오로만 쓴다.',
      '긴급배송 추가비용·CS 문의 비용은 원본에 항목도 데이터도 없어 빠져 있다 → 실제보다 낙관적일 수 있다.',
    ],
  },
  {
    id: 'nominal_roas',
    label: '명목 ROAS',
    formula: 'GMV / Marketing Spend',
    unit: '배',
    basis: '비용 범위: ad_cost_krw 전액, 같은 주문 집단·기간',
    sources: ['calculation_definitions.md 1.4'],
    origin: '원본 정의',
    caveats: [SAMPLE_WARNING, '분모가 0 이면 계산 불가(null).'],
  },
  {
    id: 'real_roas',
    label: '실질 ROAS',
    formula: '실질 공헌이익 / Marketing Spend',
    unit: '배',
    basis: '비용 범위: ad_cost_krw 전액, 같은 주문 집단·기간',
    sources: ['calculation_definitions.md 1.4', 'A05 5장'],
    origin: '원본 정의',
    caveats: [SAMPLE_WARNING, '분모가 0 이면 계산 불가(null).'],
  },
  {
    id: 'return_rate',
    label: '반품률',
    formula: 'Σ 반품환불액 / Σ GMV (금액 기준, 건수 아님)',
    unit: '%',
    basis: '원 주문 기준 연결',
    sources: ['calculation_definitions.md 1.7'],
    origin: '원본 정의',
    caveats: [SAMPLE_WARNING],
  },
  {
    id: 'allocation_alignment',
    label: '배분-성과 정렬도',
    formula: '인플루언서별 광고비 집행 비중 순위와 실질 공헌이익 순위의 스피어만 순위상관 (−1 ~ +1)',
    unit: '상관계수',
    basis: '인플루언서 단위(표본 안에서의 상대 비교)',
    sources: ['approval_authority_policy.md ("배분이 성과와 같은 방향인지 확인")', 'mkt_meeting_notes_ms.md'],
    origin: '신규 정의',
    caveats: [
      '원본이 "방향을 확인하라"고만 했고 계산식은 없다 → 순위상관으로 정의한 것은 내 정의다.',
      '해석 기준(+0.3 이상=같은 방향, −0.3 이하=반대 방향)은 내가 정한 가정이다.',
      '표본이고 인플루언서가 10명뿐이라 통계적 결론이 아니라 방향 표시로만 쓴다.',
    ],
  },
]

export const metricById = (id: string): MetricDefinition | undefined => METRICS.find((m) => m.id === id)
