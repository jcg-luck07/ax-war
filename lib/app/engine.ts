// 앱(서버)이 쓰는 엔진 설정을 한곳에서 만든다: 규칙집 + 업무 handler + 현금 재전망 결과.
// 요청마다 새로 만든다(현금 재전망은 원본 복사본에서 바로 계산하므로 가볍다).
import type { Sql } from 'postgres'
import { db, ensureSchema } from '@/lib/db'
import type { EngineConfig } from '@/lib/engine/engine'
import { decideAuthority } from '@/lib/rules/evaluate'
import { AUTHORITY_RULES, ROLES } from '@/lib/rules/authority.rules'
import { simulateCash, DEFAULT_CASH_OPTIONS, type CashResult } from '@/lib/modules/cash/simulate'
import { loadCashInputs } from '@/lib/modules/cash/service'
import { makeW02Handlers, type W02Ctx } from '@/lib/modules/w02/handlers'
import { w01Handlers } from '@/lib/modules/w01/handlers'

/** 가상기업 기준일 (data_dictionary.md) */
export const AS_OF = '2026-07-01'

export const roleLabel = (id: string) => ROLES.find((r) => r.id === id)?.label ?? id
export const roleRank = (id: string) => {
  const r = ROLES.find((x) => x.id === id)
  if (!r) throw new Error(`알 수 없는 역할: ${id}`)
  return r.rank
}
export const decide = (caseType: string, facts: Parameters<typeof decideAuthority>[1]) =>
  decideAuthority(caseType, facts, AUTHORITY_RULES, ROLES)

export interface AppEngine {
  sql: Sql
  cfg: EngineConfig
  cash: CashResult | null
}

/** DB 연결 + 엔진 설정. 원본이 아직 DB 에 없으면 cash 는 null(= 하회 구간을 모름 → 확인 필요로 처리). */
export async function getEngine(): Promise<AppEngine> {
  await ensureSchema()
  const sql = db()
  let cash: CashResult | null = null
  try {
    cash = simulateCash(await loadCashInputs(), { ...DEFAULT_CASH_OPTIONS, asOf: AS_OF })
  } catch {
    cash = null
  }
  const ctx: W02Ctx = { asOf: AS_OF, cashWindows: cash ? cash.windows : null }
  const cfg: EngineConfig = {
    decide,
    roleRank,
    roleLabel,
    handlers: { ...makeW02Handlers({ decide, roleLabel }), ...w01Handlers },
    ctx,
  }
  return { sql, cfg, cash }
}
