// AI 가 서류에서 읽은 값과, 제출자가 화면에서 고른 값을 비교하고 원본 마스터로 빈칸을 보충하는 순수 함수.
// 브라우저(제출 화면)와 서버(읽기)가 함께 쓰므로 서버 전용 모듈을 import 하지 않는다.

export interface CompareCategory {
  refLabel: string
  idPrefix: string
  options: { id: string; label: string }[]
}

export interface CompareSelection {
  /** 고른 대상 ID (기존 대상) — 아직 안 골랐으면 '' */
  refId: string
  /** "신규 ID 입력"을 골랐는가 */
  isNew: boolean
  /** 지금 정해진 구분 (신규 ID 면 '신규') — 아직 안 골랐으면 '' */
  deal: string
}

/**
 * 제출자가 고른 값이 서류와 다르면 알려 줄 문장을 돌려준다. 값을 바꾸지는 않는다(고른 값은 그대로 두고 지적만).
 *  - 신규로 골랐는데 서류는 이미 있는 대상의 안건(확대·갱신)인 경우
 *  - 고른 기존 대상과 서류의 대상 ID 가 다른 경우
 *  - 고른 구분(신규/확대/갱신)과 서류에 적힌 구분이 다른 경우
 */
export function findConflicts(c: CompareCategory, sel: CompareSelection, doc: Record<string, string>, dealLabel: string): string[] {
  const out: string[] = []
  const noun = c.refLabel.replace(/\s*ID$/, '')
  const docRef = doc.refId ?? ''
  const docKnown = docRef ? c.options.find((o) => o.id === docRef) : undefined
  if (docRef) {
    if (sel.isNew && docKnown) {
      out.push(`${c.refLabel}: '신규 ID 입력'을 골랐지만, 서류는 이미 있는 ${noun} ${docKnown.label}의 안건이에요${doc.dealType ? ` (서류의 ${dealLabel}: ${doc.dealType})` : ''}. 신규가 아니라 기존 ${noun}의 안건일 수 있어요.`)
    } else if (!sel.isNew && sel.refId && sel.refId !== docRef) {
      out.push(`${c.refLabel}: 고른 ${sel.refId}와 서류의 ${docRef}가 달라요.`)
    }
  }
  if (doc.dealType && sel.deal && doc.dealType !== sel.deal) {
    out.push(`${dealLabel}: '${sel.deal}'(으)로 골랐지만 서류에는 '${doc.dealType}'(으)로 적혀 있어요. 어느 쪽이 맞는지 확인하세요.`)
  }
  return out
}

/**
 * 서류에서 읽은 대상 ID 가 원본 마스터에 있는 캠페인이면, 서류에 적히지 않은 소속 인플루언서·제품 종류를 마스터에서 채운다.
 * (서류가 ID 만 적고 소속·제품은 안 적은 경우에도 빈칸으로 두지 않는다. 서류에 적힌 값이 있으면 그대로 둔다.)
 */
export function enrichFromMaster(
  category: string,
  values: Record<string, string>,
  evidence: Record<string, string>,
  campaigns: { id: string; influencerId: string; productLine: string }[],
): void {
  if (category !== 'campaign' || !values.refId) return
  const camp = campaigns.find((x) => x.id === values.refId)
  if (!camp) return
  const from = `원본 마스터(m_campaign_ms.csv) ${camp.id}`
  if (!values.parentInfluencerId && camp.influencerId) { values.parentInfluencerId = camp.influencerId; evidence.parentInfluencerId = `${from} 의 소속` }
  if (!values.productLine && camp.productLine) { values.productLine = camp.productLine; evidence.productLine = `${from} 의 제품 종류` }
}
