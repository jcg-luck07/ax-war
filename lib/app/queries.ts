// 화면용 조회 모음 (서버 전용). 엔진 상태를 읽기만 하고 바꾸지 않는다.
import type { Sql } from 'postgres'
import { daysUntil, listCases, listOpenTasks, listPendingApprovals } from '@/lib/engine/engine'
import { getPerformance } from '@/lib/metrics/service'
import { DEFAULT_ASSUMPTIONS, type PerfAssumptions, type PerformanceResult } from '@/lib/metrics/performance'

export async function loadSummary(sql: Sql, asOf: string) {
  const cases = await listCases(sql)
  const approvals = await listPendingApprovals(sql)
  const tasks = await listOpenTasks(sql, 12)
  const count = (s: string) => cases.filter((c) => c.status === s).length
  const FINAL = ['approved', 'rejected', 'closed']
  const soon = cases
    .filter((c) => !FINAL.includes(c.status) && c.deadline && (daysUntil(c.deadline, asOf) ?? 999) <= 21)
    .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''))
  return {
    total: cases.length,
    pending: count('pending_approval'),
    needInfo: count('need_info'),
    approved: count('approved') + count('closed'),
    soonCount: soon.length,
    soon: soon.slice(0, 6),
    approvals: approvals.slice(0, 8),
    tasks,
  }
}

/** 성과 계산은 원본 복사본이 DB 에 없으면 null 을 돌려준다(화면이 안내 문구를 보여 준다). */
export async function tryPerformance(assumptions: PerfAssumptions = DEFAULT_ASSUMPTIONS): Promise<PerformanceResult | null> {
  try {
    return await getPerformance(assumptions)
  } catch {
    return null
  }
}
