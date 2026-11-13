// 자동 갱신 도래 알림 — 전속계약이 "통보 기한을 넘기면 동일 조건으로 자동 갱신"되는 계약이라면, 그 통보 기한이 4주 안으로 다가온 인플루언서를 모아 준다.
//  · 기준 날짜는 안건의 계약 체결 기한(= 갱신 통보 기한). 이 날을 넘기면 자동 갱신(체결로 간주)돼 되돌릴 수 없다.
//  · 자동 갱신 여부는 안건 제출 때 적은 값이다. '자동 갱신 아님'이면 알리지 않고, 값이 없으면(원본 통보서 등) '여부 미확인'으로 알린다.
//  · 인플루언서마다 가장 최근 갱신 안건 하나만 본다. 갱신하지 않기로(부결) 정해진 안건은 뺀다.
import type { Sql } from 'postgres'
import { AS_OF } from '@/lib/app/engine'
import { daysUntil } from '@/lib/engine/engine'
import type { CaseRow } from '@/lib/app/case-list'

export const RENEWAL_WINDOW_DAYS = 28

export interface RenewalAlert {
  caseId: number
  influencerId: string
  title: string
  /** 통보 기한 (넘기면 자동 갱신) */
  noticeDeadline: string
  days: number
  currentExpiry: string | null
  /** true 자동 갱신 / null 여부 미확인 */
  autoRenew: true | null
  /** 이 갱신 건의 진행 상태 (예: 재무팀 검토 필요) */
  state: string
}

export async function renewalAlerts(sql: Sql, rows: CaseRow[]): Promise<RenewalAlert[]> {
  const infl = rows.filter((r) => r.category === 'influencer' && r.deadline)
  if (infl.length === 0) return []
  const payloads = await sql<{ id: string; ar: string | null; exp: string | null }[]>`
    SELECT id::text, payload->'contract'->>'autoRenew' AS ar, payload->'contract'->>'currentExpiry' AS exp
    FROM decision_cases WHERE id = ANY(${infl.map((r) => r.id)}::bigint[])`
  const info = new Map(payloads.map((p) => [Number(p.id), p]))
  const latest = new Map<string, CaseRow>()
  for (const r of infl) {
    const cur = latest.get(r.influencerId)
    if (!cur || r.deadline! > cur.deadline!) latest.set(r.influencerId, r)
  }
  const out: RenewalAlert[] = []
  for (const r of latest.values()) {
    const p = info.get(r.id)
    if (!p?.exp) continue // 신규 계약 — 현 계약이 없어 자동 갱신도 없다
    if (p.ar === 'false') continue // 자동 갱신 계약이 아니다
    if (r.outcome === 'rejected') continue // 갱신하지 않기로 정했다
    const days = daysUntil(r.deadline!, AS_OF) ?? 9999
    if (days > RENEWAL_WINDOW_DAYS) continue
    out.push({
      caseId: r.id, influencerId: r.influencerId, title: r.title, noticeDeadline: r.deadline!, days, currentExpiry: p.exp,
      autoRenew: p.ar === 'true' ? true : null, state: r.state,
    })
  }
  return out.sort((a, b) => a.days - b.days)
}
