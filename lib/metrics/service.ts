// 성과 계산: 시맨틱 질의로 DB 의 원본 복사본에서 읽어 화면용으로 조립한다 (서버 전용).
import type { Sql } from 'postgres'
import { db, ensureSchema } from '@/lib/db'
import { MASIL_MODEL } from '@/lib/semantic/model'
import { runSemantic } from '@/lib/semantic/run'
import {
  assemblePerformance, DEFAULT_ASSUMPTIONS, PERF_SELECT, toSemanticParams, type PerfAssumptions, type PerformanceResult,
} from '@/lib/metrics/performance'

export async function getPerformance(
  assumptions: PerfAssumptions = DEFAULT_ASSUMPTIONS, sqlArg?: Sql,
): Promise<PerformanceResult> {
  let sql = sqlArg
  if (!sql) {
    await ensureSchema()
    sql = db()
  }
  const params = toSemanticParams(assumptions)
  const [inf, camp, total, quality] = await Promise.all([
    runSemantic(sql, MASIL_MODEL, { select: PERF_SELECT, by: 'influencer', params }),
    runSemantic(sql, MASIL_MODEL, { select: PERF_SELECT, by: 'campaign', params }),
    runSemantic(sql, MASIL_MODEL, { select: PERF_SELECT, params }),
    runSemantic(sql, MASIL_MODEL, { select: ['orders_missing_cost', 'orders_without_campaign', 'returns_without_order'] }),
  ])
  if (inf.length === 0) throw new Error('원본 자료가 DB 에 없어요. `node scripts/ingest.mjs` 로 먼저 복사해 주세요.')
  return assemblePerformance(inf, camp, total[0], quality[0]?.values ?? {}, assumptions)
}
