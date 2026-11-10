// 현금 재전망 입력을 시맨틱 레이어에서 읽는다 (서버 전용). 계산은 simulate.ts 의 순수 함수가 한다.
import type { Sql } from 'postgres'
import { db, ensureSchema } from '@/lib/db'
import { DEFAULT_CASH_OPTIONS, simulateCash, type CashInputs, type CashOptions, type CashResult, type DayAmounts } from '@/lib/modules/cash/simulate'
import { MASIL_MODEL } from '@/lib/semantic/model'
import { entityRows, runSemantic } from '@/lib/semantic/run'

export async function loadCashInputs(sqlArg?: Sql): Promise<CashInputs> {
  let sql = sqlArg
  if (!sql) {
    await ensureSchema()
    sql = db()
  }
  const [daily, flows, unlinked, forecast] = await Promise.all([
    entityRows(sql, MASIL_MODEL, 'cash_daily'),
    runSemantic(sql, MASIL_MODEL, { select: ['ar_outstanding', 'ap_operating', 'po_payment'], by: 'payment_date' }),
    runSemantic(sql, MASIL_MODEL, { select: ['ap_unlinked'] }),
    entityRows(sql, MASIL_MODEL, 'cash_forecast'),
  ])
  if (daily.length === 0) throw new Error('원본 자료가 DB 에 없어요. `node scripts/ingest.mjs` 로 먼저 복사해 주세요.')
  const last = daily[daily.length - 1]
  const byDay = (id: string): DayAmounts => {
    const o: DayAmounts = {}
    for (const r of flows) if (r.key && r.values[id]) o[r.key] = r.values[id] as number
    return o
  }
  return {
    openingDate: String(last.date),
    openingBalance: Number(last.closing_balance),
    inflows: byDay('ar_outstanding'),
    payments: byDay('ap_operating'),
    poPayments: byDay('po_payment'),
    unlinkedApTotal: unlinked[0]?.values.ap_unlinked ?? 0,
    forecast: forecast.map((f) => ({ week: String(f.week), closing: Number(f.projected_closing_krw) })),
  }
}

export async function getCashForecast(opt: Partial<CashOptions> = {}, sql?: Sql): Promise<CashResult> {
  return simulateCash(await loadCashInputs(sql), { ...DEFAULT_CASH_OPTIONS, ...opt })
}
