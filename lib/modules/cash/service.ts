// 현금 재전망을 DB 의 원본 복사본에 연결하는 얇은 층 (서버 전용).
import { getSourceRows } from '@/lib/ingest/query'
import {
  DEFAULT_CASH_OPTIONS,
  simulateCash,
  type CashInputs,
  type CashOptions,
  type CashResult,
} from '@/lib/modules/cash/simulate'

export async function loadCashInputs(): Promise<CashInputs> {
  const [cashDaily, ar, ap, po, forecast] = await Promise.all([
    getSourceRows('02_masil/financials/fin_cash_daily_ms.csv'),
    getSourceRows('02_masil/financials/fin_ar_aging_ms.csv'),
    getSourceRows('02_masil/financials/fin_ap_aging_ms.csv'),
    getSourceRows('02_masil/inventory/sc_purchase_orders_ms.csv'),
    getSourceRows('02_masil/financials/fin_cash_forecast_ms.csv'),
  ])
  if (cashDaily.length === 0) throw new Error('원본 자료가 DB 에 없어요. `node scripts/ingest.mjs` 로 먼저 복사해 주세요.')
  return { cashDaily, ar, ap, po, forecast }
}

export async function getCashForecast(opt: Partial<CashOptions> = {}): Promise<CashResult> {
  return simulateCash(await loadCashInputs(), { ...DEFAULT_CASH_OPTIONS, ...opt })
}
