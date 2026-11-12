// Masil 업무의 시맨틱 모델 — 엔티티·관계·측정값·지표·차원을 선언한다.
// 원본 의미의 출처: 04_원본데이터/00_common/data_dictionary.md, calculation_definitions.md, A05(데이터 이용 기준).
// 화면과 판단은 CSV 를 직접 읽지 않고 이 모델을 거쳐 읽는다 → 지표 정의가 한 곳에만 있다.
import type { SemanticModel } from './types'

const SAMPLE =
  '대표 표본 자료다. 순위·비중·방향 비교에만 쓰고, 연간 예산·전사 매출 같은 풀스케일 금액과 곱하거나 합산하지 않는다(data_dictionary.md 6항).'

export const MASIL_MODEL: SemanticModel = {
  // ───────────────────────── 엔티티 ─────────────────────────
  entities: {
    influencer: {
      kind: 'source', id: 'influencer', label: '인플루언서', source: '02_masil/master/m_influencer_ms.csv', grain: '인플루언서 1명', scale: '마스터',
      columns: {
        influencer_id: { type: 'text', label: '인플루언서 번호' }, influencer_name: { type: 'text', label: '이름' }, tier: { type: 'text', label: '등급' },
        primary_country: { type: 'text', label: '활동 국가' }, platform: { type: 'text', label: '플랫폼' }, fee_type: { type: 'text', label: '보수 구조' },
      },
    },
    campaign: {
      kind: 'source', id: 'campaign', label: '캠페인', source: '02_masil/master/m_campaign_ms.csv', grain: '캠페인 1건', scale: '마스터',
      columns: {
        campaign_id: { type: 'text', label: '캠페인 번호' }, campaign_name: { type: 'text', label: '캠페인 이름' }, influencer_id: { type: 'text', label: '인플루언서 번호' },
        country: { type: 'text', label: '국가' }, sns_channel: { type: 'text', label: 'SNS 채널' }, sns_format: { type: 'text', label: 'SNS 형식' },
        sales_channel: { type: 'text', label: '판매 채널' }, product_line: { type: 'text', label: '제품 라인' },
        start_date: { type: 'date', label: '시작일' }, end_date: { type: 'date', label: '종료일' }, attribution_window_days: { type: 'number', label: '귀속 기간(일)' },
      },
      relations: { influencer: { to: 'influencer', on: { influencer_id: 'influencer_id' }, label: '캠페인은 인플루언서 1명에 속한다' } },
    },
    channel: {
      kind: 'source', id: 'channel', label: '판매 채널', source: '02_masil/master/m_channel_ms.csv', grain: '채널 1개', scale: '마스터',
      columns: {
        channel_id: { type: 'text', label: '채널 번호' }, channel_name: { type: 'text', label: '채널 이름' }, channel_type: { type: 'text', label: '채널 유형' },
        partner_code: { type: 'text', label: '파트너 코드' }, country: { type: 'text', label: '국가' }, payment_terms_days: { type: 'number', label: '결제조건(일)' },
      },
    },
    cost: {
      kind: 'source', id: 'cost', label: '원가·물류비 마스터', source: '02_masil/marketing/mkt_cost_master_ms.csv', grain: 'SKU × 채널', scale: '마스터',
      columns: {
        sku_id: { type: 'text', label: 'SKU' }, channel_id: { type: 'text', label: '채널' }, product_cost_krw: { type: 'number', label: '제품원가(원)' },
        channel_fee_pct: { type: 'number', label: '채널 수수료율(%)' }, shipping_cost_krw: { type: 'number', label: '출고·배송비(원)' },
        return_logistics_cost_krw: { type: 'number', label: '반품 물류비(원)' },
      },
    },
    order: {
      kind: 'source', id: 'order', label: '주문', source: '02_masil/marketing/mkt_orders_ms.csv', grain: '주문 1건 (수량 열 없음)', scale: '대표 표본',
      columns: {
        order_id: { type: 'text', label: '주문 번호' }, order_date: { type: 'date', label: '주문일' }, customer_ref: { type: 'text', label: '고객' },
        channel_id: { type: 'text', label: '채널' }, country: { type: 'text', label: '국가' }, sku_id: { type: 'text', label: 'SKU' },
        campaign_id: { type: 'text', label: '캠페인' }, gmv_krw: { type: 'number', label: 'GMV(원)', note: '쿠폰 반영 후, VAT 제외' },
        coupon_discount_krw: { type: 'number', label: '쿠폰 할인(원)', note: 'GMV 에 이미 반영됨 — 다시 빼지 않는다' },
      },
      relations: {
        campaign: { to: 'campaign', on: { campaign_id: 'campaign_id' }, label: '주문은 캠페인에 귀속된다 (last-click 7일)' },
        cost: { to: 'cost', on: { sku_id: 'sku_id', channel_id: 'channel_id' }, label: 'SKU × 채널로 원가·물류비를 찾는다' },
        refund: { to: 'order_refund', on: { order_id: 'order_id' }, label: '주문의 환불 합계' },
        channel: { to: 'channel', on: { channel_id: 'channel_id' }, label: '주문의 판매 채널' },
      },
    },
    return: {
      kind: 'source', id: 'return', label: '반품', source: '02_masil/marketing/mkt_returns_ms.csv', grain: '반품 1건', scale: '대표 표본',
      columns: {
        return_id: { type: 'text', label: '반품 번호' }, order_id: { type: 'text', label: '주문 번호' }, refund_completed_date: { type: 'date', label: '환불 승인일' },
        original_order_date: { type: 'date', label: '원 주문일' }, refund_amount_krw: { type: 'number', label: '환불액(원)' }, reason: { type: 'text', label: '사유' },
      },
      relations: { order: { to: 'order', on: { order_id: 'order_id' }, label: '반품은 원 주문에 속한다' } },
    },
    order_refund: {
      kind: 'aggregate', id: 'order_refund', label: '주문별 환불 합계', from: 'return', groupBy: ['order_id'], grain: '환불이 있는 주문 1건', scale: '대표 표본',
      columns: {
        refund_krw: { type: 'number', label: '환불 합계(원)', sql: 'sum(refund_amount_krw)' },
        return_count: { type: 'number', label: '반품 건수', sql: 'count(*)' },
      },
    },
    ad_spend: {
      kind: 'source', id: 'ad_spend', label: '광고비 집행', source: '02_masil/marketing/mkt_ad_spend_ms.csv', grain: '집행 1건', scale: '대표 표본',
      columns: {
        spend_id: { type: 'text', label: '집행 번호' }, campaign_id: { type: 'text', label: '캠페인' }, spend_date: { type: 'date', label: '집행일' },
        media: { type: 'text', label: '매체' }, platform: { type: 'text', label: '플랫폼' }, sns_format: { type: 'text', label: 'SNS 형식' },
        ad_cost_krw: { type: 'number', label: '광고비(원)', note: '인플루언서 비용 포함 전액' }, influencer_fee_krw: { type: 'number', label: '인플루언서 비용(원)', note: 'ad_cost_krw 에 이미 포함 — 다시 더하지 않는다' },
      },
      relations: { campaign: { to: 'campaign', on: { campaign_id: 'campaign_id' }, label: '광고비는 캠페인에 귀속된다' } },
    },
    budget_plan: {
      kind: 'source', id: 'budget_plan', label: '캠페인 확대 기안', source: '02_masil/marketing/mkt_budget_plan_ms.csv', grain: '기안 1건', scale: '대표 표본',
      columns: {
        plan_id: { type: 'text', label: '기안 번호' }, campaign_id: { type: 'text', label: '캠페인' }, requested_budget_krw: { type: 'number', label: '요청액(원)' },
        expected_gmv_krw: { type: 'number', label: '예상 GMV(원)', note: '쿠폰·환불·광고비·물류비 차감 전 수치 — 승인 근거가 될 수 없다' },
        settlement_date: { type: 'date', label: '집행 예정일' }, contract_deadline: { type: 'date', label: '계약 확정기한', note: '넘기면 자동 확정, 철회 불가' },
      },
      relations: { campaign: { to: 'campaign', on: { campaign_id: 'campaign_id' }, label: '기안은 캠페인에 대한 것' } },
    },
    // ── 재무·재고 (풀스케일) ──
    cash_daily: {
      kind: 'source', id: 'cash_daily', label: '자금일보(실적)', source: '02_masil/financials/fin_cash_daily_ms.csv', grain: '영업일 1일', scale: '풀스케일',
      columns: {
        date: { type: 'date', label: '날짜' }, opening_balance: { type: 'number', label: '기초 잔액' }, inflow_krw: { type: 'number', label: '유입' },
        outflow_krw: { type: 'number', label: '유출' }, closing_balance: { type: 'number', label: '기말 잔액' }, covenant_min_krw: { type: 'number', label: '최소현금(covenant)' },
        breach_flag: { type: 'boolean', label: '하회 여부' },
      },
    },
    ar: {
      kind: 'source', id: 'ar', label: '매출채권', source: '02_masil/financials/fin_ar_aging_ms.csv', grain: '청구 1건', scale: '풀스케일',
      columns: {
        ar_id: { type: 'text', label: '채권 번호' }, channel_id: { type: 'text', label: '채널' }, invoice_date: { type: 'date', label: '청구일' },
        due_date: { type: 'date', label: '회수 예정일' }, amount_krw: { type: 'number', label: '청구액' }, outstanding_krw: { type: 'number', label: '미회수 잔액' },
        aging_days: { type: 'number', label: '경과일' },
      },
      relations: { channel: { to: 'channel', on: { channel_id: 'channel_id' }, label: '채권의 판매 채널' } },
    },
    ap: {
      kind: 'source', id: 'ap', label: '매입채무', source: '02_masil/financials/fin_ap_aging_ms.csv', grain: '청구 1건', scale: '풀스케일',
      columns: {
        ap_id: { type: 'text', label: '채무 번호' }, supplier_id: { type: 'text', label: '공급자' }, po_id: { type: 'text', label: '연결 발주(없으면 NONE)' },
        invoice_date: { type: 'date', label: '청구일' }, payment_due_date: { type: 'date', label: '지급 예정일' }, amount_krw: { type: 'number', label: '금액' },
        aging_days: { type: 'number', label: '경과일' },
      },
      relations: { po: { to: 'po', on: { po_id: 'po_id' }, label: 'PO 연결분은 발주 대금을 다시 적은 것(이중계상 주의)' } },
    },
    po: {
      kind: 'source', id: 'po', label: '재고 발주', source: '02_masil/inventory/sc_purchase_orders_ms.csv', grain: '발주 1건', scale: '풀스케일',
      columns: {
        po_id: { type: 'text', label: '발주 번호' }, sku_id: { type: 'text', label: 'SKU' }, supplier_id: { type: 'text', label: '공급자' },
        order_date: { type: 'date', label: '발주일' }, order_qty: { type: 'number', label: '수량' }, moq: { type: 'number', label: 'MOQ' },
        lead_time_weeks: { type: 'number', label: '조달 기간(주)' }, amount_krw: { type: 'number', label: '금액' }, payment_due_date: { type: 'date', label: '대금 지급 예정일' },
      },
    },
    cash_forecast: {
      kind: 'source', id: 'cash_forecast', label: '재무팀 공식 현금 전망', source: '02_masil/financials/fin_cash_forecast_ms.csv', grain: '주 1개', scale: '풀스케일',
      columns: {
        forecast_date: { type: 'date', label: '작성일' }, week: { type: 'date', label: '주(월요일)' }, projected_inflow_krw: { type: 'number', label: '예상 유입' },
        projected_outflow_krw: { type: 'number', label: '예상 유출' }, projected_closing_krw: { type: 'number', label: '예상 기말 잔액' },
      },
    },
  },

  // ───────────────────────── 측정값 ─────────────────────────
  measures: {
    orders: { id: 'orders', label: '주문 수', entity: 'order', agg: 'count', unit: '건', description: '주문 행 수', caveats: [SAMPLE] },
    gmv: {
      id: 'gmv', label: 'GMV', entity: 'order', agg: 'sum', expr: 'order.gmv_krw', unit: '원(VAT 제외)',
      description: '쿠폰 반영 후 주문금액의 합. 쿠폰을 다시 빼지 않는다.', caveats: [SAMPLE],
    },
    refund: {
      id: 'refund', label: '반품환불액', entity: 'order', agg: 'sum', expr: 'order_refund.refund_krw', unit: '원',
      description: '원 주문에 연결된 환불액(원 주문 기준 귀속). 승인일 기준 기간 집계와는 다를 수 있다.', caveats: [SAMPLE],
    },
    refunded_orders: {
      id: 'refunded_orders', label: '환불이 있는 주문 수', entity: 'order', agg: 'count', where: 'coalesce(order_refund.refund_krw, 0) > 0', unit: '건',
      description: '환불이 1건이라도 있는 주문', caveats: [SAMPLE],
    },
    cogs: {
      id: 'cogs', label: '제품원가', entity: 'order', agg: 'sum', unit: '원',
      expr: 'cost.product_cost_krw * :unitsPerOrder',
      where: '(:recoverCostOnRefund = 0 OR coalesce(order_refund.refund_krw, 0) = 0)',
      description: '주문에 SKU×채널 원가를 적용 단위(가정)만큼 곱한다. 환불 시 원가 회수는 기본적으로 가정하지 않는다.',
      caveats: [SAMPLE, '주문 행에 수량이 없어 적용 단위는 가정이다(A05).'],
    },
    channel_fee: {
      id: 'channel_fee', label: '채널 수수료', entity: 'order', agg: 'sum', unit: '원',
      expr: 'order.gmv_krw * cost.channel_fee_pct / 100',
      where: '(:recoverFeeOnRefund = 0 OR coalesce(order_refund.refund_krw, 0) = 0)',
      description: 'GMV × 채널 수수료율. 환불 시 수수료 회수는 기본적으로 가정하지 않는다.', caveats: [SAMPLE],
    },
    shipping: {
      id: 'shipping', label: '출고·배송비', entity: 'order', agg: 'sum', expr: 'cost.shipping_cost_krw * :unitsPerOrder', unit: '원',
      description: '주문당 출고·배송비(가정 단위만큼)', caveats: [SAMPLE, '긴급배송 추가비용은 원본에 항목·데이터가 없어 빠져 있다.'],
    },
    return_logistics: {
      id: 'return_logistics', label: '반품 물류비', entity: 'order', agg: 'sum', unit: '원',
      expr: 'cost.return_logistics_cost_krw * :returnLogisticsTimes', where: 'coalesce(order_refund.refund_krw, 0) > 0',
      description: '환불이 있는 주문에만 반품 물류비를 적용한다.', caveats: [SAMPLE],
    },
    ad_spend: {
      id: 'ad_spend', label: '마케팅 지출', entity: 'ad_spend', agg: 'sum', expr: 'ad_spend.ad_cost_krw', unit: '원',
      description: 'ad_cost_krw 전액(인플루언서 비용 포함). influencer_fee_krw 를 다시 더하지 않는다.', caveats: [SAMPLE],
    },
    orders_missing_cost: {
      id: 'orders_missing_cost', label: '원가 마스터에 없는 주문', entity: 'order', agg: 'count', where: 'cost.sku_id IS NULL', unit: '건',
      description: '자료 품질 점검: SKU×채널이 원가 마스터에 없으면 원가·물류비가 빠진다.',
    },
    orders_without_campaign: {
      id: 'orders_without_campaign', label: '캠페인에 연결 안 된 주문', entity: 'order', agg: 'count', where: 'campaign.campaign_id IS NULL', unit: '건',
      description: '자료 품질 점검: 캠페인 귀속이 없는 주문은 인플루언서별 집계에서 빠진다.',
    },
    returns_without_order: {
      id: 'returns_without_order', label: '주문과 연결 안 된 반품', entity: 'return', agg: 'count', where: 'order.order_id IS NULL', unit: '건',
      description: '자료 품질 점검: 원 주문을 못 찾는 환불은 귀속할 수 없다.',
    },
    // ── 현금 흐름 (시간 차원 payment_date 로 일별) ──
    ar_outstanding: {
      id: 'ar_outstanding', label: '예상 회수액', entity: 'ar', agg: 'sum', expr: 'ar.outstanding_krw', where: 'ar.outstanding_krw > 0', unit: '원',
      description: '미회수 잔액을 회수 예정일에 배치한다 (calculation_definitions.md 1.2).',
    },
    ap_operating: {
      id: 'ap_operating', label: '운영 매입채무 지급액', entity: 'ap', agg: 'sum', expr: 'ap.amount_krw', where: "ap.po_id = 'NONE'", unit: '원',
      description: 'po_id 가 NONE 인 운영 매입채무만 지급액으로 본다. 발주 연결분은 발주 쪽에서 한 번만 센다(이중계상 금지).',
    },
    ap_unlinked: {
      id: 'ap_unlinked', label: '연결 발주를 찾지 못한 매입채무', entity: 'ap', agg: 'sum', expr: 'ap.amount_krw', where: "ap.po_id <> 'NONE' AND po.po_id IS NULL", unit: '원',
      description: '자료 품질 점검: 발주에 연결됐다고 적혔지만 발주 목록에 없는 채무. 어느 쪽에도 반영되지 않는다.',
    },
    po_payment: {
      id: 'po_payment', label: '재고 발주 대금', entity: 'po', agg: 'sum', expr: 'po.amount_krw', unit: '원',
      description: '발주 금액을 대금 지급 예정일에 배치한다.',
    },
  },

  // ───────────────────────── 지표 ─────────────────────────
  metrics: {
    net_revenue: {
      id: 'net_revenue', label: 'Net Revenue', expr: 'gmv - refund', formula: 'GMV − 반품환불액', unit: '원',
      basis: 'GMV 와 같은 주문 집단', sources: ['calculation_definitions.md 1.4'], origin: '원본 정의', caveats: [SAMPLE],
    },
    contribution_profit: {
      id: 'contribution_profit', label: '실질 공헌이익', expr: 'net_revenue - cogs - channel_fee - shipping - return_logistics - ad_spend',
      formula: 'Net Revenue − 제품원가 − 채널수수료 − 출고(배송)비 − 반품 물류비 − 마케팅 지출 (쿠폰은 GMV 에 이미 반영되어 다시 빼지 않음)',
      unit: '원', basis: '주문 집단 기준. 원가·배송비는 주문 1건에 적용 단위(가정)만큼, 반품 물류비는 환불 건에만 적용',
      sources: ['calculation_definitions.md 1.4', 'A05 5장', '02_masil/marketing/mkt_cost_master_ms.csv'], origin: '원본 정의',
      caveats: [SAMPLE, '[적용 근거] calculation_definitions.md 1.4 의 산식에는 쿠폰 할인(Coupon Discount)과 반품환불액(Return Refund)이 별도 차감 항목으로 적혀 있지만, 같은 문서가 GMV 를 "쿠폰 반영 후·VAT 제외", Net Revenue 를 "GMV − 반품환불액"으로 정의하므로 두 항목은 Net Revenue 에 이미 반영돼 있다고 보고 다시 빼지 않았다(이중 차감 방지). data_dictionary.md 의 산식에도 반품환불액 항목이 따로 없다. A05.html 도 "동일 주문에 대해 쿠폰과 환불을 다시 차감하지 않으며, 제품원가·마케팅비·채널수수료·출고·반품 물류비를 각 한 번씩 차감한다"고 밝히고 있어 이 해석과 같다(산식 문구를 글자 그대로 적용하면 환불을 두 번 빼게 된다).', '[인플루언서 비용 범위] 마케팅 지출은 문서 정의대로 mkt_ad_spend_ms.csv 의 ad_cost_krw 전액(인플루언서·퍼포먼스·오프라인)이다. 여기 담긴 influencer_fee_krw 는 캠페인 진행에 따른 별도의 진행비용이며, 인플루언서의 연 전속 고정 피와 성과 피(GMV 연동, 별도 정산)는 포함하지 않는 것으로 본다(우리의 가정 — 원본 문서에 구분이 적혀 있지 않고, 마케팅 부서 회신으로 확인할 예정). 따라서 이 지표는 캠페인 단위 광고 효율 비교용이고, 인플루언서에게 나가는 총비용을 반영한 값이 아니다 → 전속계약 판단에는 낙관적인 값이다.', '주문 행에 수량이 없어 "주문당 적용 단위"는 가정이다.', '환불 시 원가·수수료 회수는 자료가 없어 기본은 회수하지 않음.', '긴급배송 추가비용·CS 문의 비용은 원본에 항목도 데이터도 없어 빠져 있다 → 실제보다 낙관적일 수 있다.'],
    },
    nominal_roas: {
      id: 'nominal_roas', label: '명목 ROAS', expr: 'gmv / nullif(ad_spend, 0)', formula: 'GMV / 마케팅 지출', unit: '배',
      basis: '비용 범위: ad_cost_krw 전액, 같은 주문 집단·기간', sources: ['calculation_definitions.md 1.4'], origin: '원본 정의', caveats: [SAMPLE, '분모가 0 이면 계산 불가(비어 있음).'],
    },
    real_roas: {
      id: 'real_roas', label: '실질 ROAS', expr: 'contribution_profit / nullif(ad_spend, 0)', formula: '실질 공헌이익 / 마케팅 지출', unit: '배',
      basis: '비용 범위: ad_cost_krw 전액, 같은 주문 집단·기간', sources: ['calculation_definitions.md 1.4', 'A05 5장'], origin: '원본 정의', caveats: [SAMPLE, '분모가 0 이면 계산 불가(비어 있음).'],
    },
    return_rate: {
      id: 'return_rate', label: '반품률', expr: 'refund / nullif(gmv, 0)', formula: 'Σ 반품환불액 / Σ GMV (금액 기준, 건수 아님)', unit: '비율',
      basis: '원 주문 기준 연결', sources: ['calculation_definitions.md 1.7'], origin: '원본 정의', caveats: [SAMPLE],
    },
  },

  // ───────────────────────── 차원 ─────────────────────────
  dimensions: {
    influencer: { id: 'influencer', label: '인플루언서별', entity: 'influencer', key: 'influencer_id', attrs: ['influencer_name', 'tier'] },
    campaign: { id: 'campaign', label: '캠페인별', entity: 'campaign', key: 'campaign_id', attrs: ['campaign_name', 'influencer_id'] },
  },
  timeDimensions: {
    payment_date: { id: 'payment_date', label: '현금 유출입 예정일', columns: { ar: 'due_date', ap: 'payment_due_date', po: 'payment_due_date' } },
  },

  // ───────────────────────── 계산 가정 ─────────────────────────
  parameters: {
    unitsPerOrder: { id: 'unitsPerOrder', label: '주문당 원가·배송비 적용 횟수', default: 1, note: '주문 행에 수량이 없어 가정이 필요하다(A05).' },
    returnLogisticsTimes: { id: 'returnLogisticsTimes', label: '환불 1건당 반품 물류비 횟수', default: 1, note: '반품 물류비 적용 횟수는 A05 가 명시하라고 한 가정이다.' },
    recoverCostOnRefund: { id: 'recoverCostOnRefund', label: '환불 시 제품원가 회수(1=예)', default: 0, note: '회수 자료가 없어 기본은 회수하지 않음(A05).' },
    recoverFeeOnRefund: { id: 'recoverFeeOnRefund', label: '환불 시 채널수수료 회수(1=예)', default: 0, note: '회수 자료가 없어 기본은 회수하지 않음(A05).' },
  },
}
