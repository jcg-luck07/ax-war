// 시맨틱 질의를 DB 에서 실행한다 (서버 전용). 컴파일은 compile.ts(순수 함수)가 한다.
import type { Sql } from 'postgres'
import { compileEntityRows, compileQuery } from './compile'
import type { SemanticModel, SemanticQuery, SemanticRow } from './types'

export interface SemanticResultRow {
  key: string | null
  attrs: Record<string, string | null>
  values: Record<string, number | null>
}

/** 측정값·지표를 차원별로 계산한다. 값이 없으면 null(0 으로 바꾸지 않음). */
export async function runSemantic(sql: Sql, model: SemanticModel, query: SemanticQuery): Promise<SemanticResultRow[]> {
  const c = compileQuery(model, query)
  const rows = (await sql.unsafe(c.text, c.values as never[])) as unknown as Record<string, unknown>[]
  return rows.map((r) => ({
    key: (r.k as string | null) ?? null,
    attrs: Object.fromEntries(c.columns.attrs.map((a) => [a, (r['a_' + a] as string | null) ?? null])),
    values: Object.fromEntries(c.columns.select.map((s) => [s, r[s] === null || r[s] === undefined ? null : Number(r[s])])),
  }))
}

/** 엔티티의 행을 타입이 있는 값으로 그대로 꺼낸다 (숫자는 number, 날짜는 YYYY-MM-DD, NONE 은 null). */
export async function entityRows(sql: Sql, model: SemanticModel, entityId: string): Promise<SemanticRow[]> {
  const c = compileEntityRows(model, entityId)
  return (await sql.unsafe(c.text, c.values as never[])) as unknown as SemanticRow[]
}
