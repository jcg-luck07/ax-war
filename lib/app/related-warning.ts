// 같은 인플루언서의 연관 안건에서 부결이 있었는지 살펴 회부·승인 때 띄울 경고 문구를 만든다 (순수 함수).
//  - 캠페인 안건: 그 인플루언서의 전속계약 갱신이 한 건이라도 부결된 적이 있으면 경고
//  - 전속계약 안건: 가장 최근 캠페인이 부결이거나, 최근 결정된 캠페인 5건 중 2건 이상이 부결이면 경고
// "최근"은 계약 체결 기한이 늦은 순서이고, 아직 결정되지 않은 안건(검토 중·보류)은 세지 않는다.
import type { CaseRow } from './case-list'

const DECIDED = ['approved', 'rejected'] // 결정된 안건 (결과 기준 — 후속 작업이 끝나 닫혔어도 부결은 부결이다)

export function relatedWarning(
  me: { category: 'influencer' | 'campaign' | null; influencerId: string; id: number },
  rows: CaseRow[], influencerName: string,
): string | null {
  if (!me.influencerId || me.influencerId === 'NONE') return null
  const same = rows.filter((r) => r.influencerId === me.influencerId && r.id !== me.id)
  if (me.category === 'campaign') {
    const bad = same.filter((r) => r.category === 'influencer' && r.outcome === 'rejected')
    if (bad.length === 0) return null
    return `${influencerName}의 전속계약 갱신이 부결된 안건이 ${bad.length}건 있어요 (${bad.map((r) => r.code || r.title).join(', ')}).`
  }
  if (me.category === 'influencer') {
    const recent = same
      .filter((r) => r.category === 'campaign' && DECIDED.includes(r.outcome ?? ''))
      .sort((a, b) => (b.deadline ?? '').localeCompare(a.deadline ?? '') || b.id - a.id)
      .slice(0, 5)
    const rejected = recent.filter((r) => r.outcome === 'rejected')
    if (recent[0]?.outcome === 'rejected') return `${influencerName}의 가장 최근 캠페인(${recent[0].code || recent[0].title})이 부결됐어요.`
    if (rejected.length >= 2) return `${influencerName}의 최근 캠페인 ${recent.length}건 중 ${rejected.length}건이 부결됐어요 (${rejected.map((r) => r.code || r.title).join(', ')}).`
  }
  return null
}
