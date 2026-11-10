// 기안 묶음 전체에 걸린 질문에 한 번에 회신한다.
// 예) "이 마케팅 기안이 그룹 300억 배분 사업과 연결되는가?" — 25건이 같은 질문을 하므로 한 번만 답하면 모두에 반영한다.
import type { Sql } from 'postgres'
import { provideInfo, type EngineConfig, type FactsChangeResult } from '@/lib/engine/engine'
import type { DataOrigin } from '@/lib/engine/types'

export async function answerAllOpenInfo(
  sql: Sql,
  cfg: EngineConfig,
  fact: string,
  answers: Record<string, string | number | boolean | null>,
  input: { origin: DataOrigin; by: string; caseType?: string },
): Promise<FactsChangeResult[]> {
  const rows = await sql`
    SELECT t.id FROM tasks t JOIN decision_cases c ON c.id = t.case_id
    WHERE t.task_type = 'info_request' AND t.status = 'open' AND t.detail->>'fact' = ${fact}
      AND (${input.caseType ?? null}::text IS NULL OR c.case_type = ${input.caseType ?? null})
    ORDER BY t.id
  `
  const out: FactsChangeResult[] = []
  for (const r of rows) {
    out.push(await provideInfo(sql, cfg, Number(r.id), { answers, origin: input.origin, by: input.by }))
  }
  return out
}
