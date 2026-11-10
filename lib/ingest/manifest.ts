// 읽어올 원본 파일 목록. 경로는 `01_참가자_배포용/04_원본데이터` 기준 상대 경로이며 DB 의 source_file 값과 같다.
// 다른 회사/업무 자료가 필요해지면 여기에 줄을 추가한다 (원본 파일은 건드리지 않는다).

export const SOURCE_DIR_DEFAULT = '01_참가자_배포용/04_원본데이터'

/** Masil — W02(인플루언서 계약·캠페인 집행)와 현금 하회 구간 점검에 쓰는 자료 전체. */
export const MASIL_FILES = [
  // 마스터 (대상 정의)
  '02_masil/master/m_campaign_ms.csv',
  '02_masil/master/m_channel_ms.csv',
  '02_masil/master/m_influencer_ms.csv',
  '02_masil/master/m_sku_ms.csv',
  // 마케팅 (대표 표본 — 비중·순위·방향에만 쓴다. 전사 금액과 대사 금지)
  '02_masil/marketing/mkt_ad_spend_ms.csv',
  '02_masil/marketing/mkt_budget_plan_ms.csv',
  '02_masil/marketing/mkt_cost_master_ms.csv',
  '02_masil/marketing/mkt_coupons_ms.csv',
  '02_masil/marketing/mkt_orders_ms.csv',
  '02_masil/marketing/mkt_repurchase_ms.csv',
  '02_masil/marketing/mkt_returns_ms.csv',
  '02_masil/marketing/mkt_traffic_inflow_ms.csv',
  // 재무 (풀스케일 — 현금 재전망)
  '02_masil/financials/fin_ap_aging_ms.csv',
  '02_masil/financials/fin_ar_aging_ms.csv',
  '02_masil/financials/fin_cash_daily_ms.csv',
  '02_masil/financials/fin_cash_forecast_ms.csv',
  '02_masil/financials/fin_collection_history_ms.csv',
  // 재고·발주 (풀스케일 — 발주 지급 예정)
  '02_masil/inventory/sc_purchase_orders_ms.csv',
  '02_masil/inventory/sku_inventory_ms.csv',
  '02_masil/inventory/sku_weekly_sales_ms.csv',
] as const

/** 기본으로 읽는 전체 목록. */
export const DEFAULT_FILES = [...MASIL_FILES] as const
