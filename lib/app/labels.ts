// 안건 종류 이름의 단 하나의 출처. 안건 접수(분류)·안건 목록·업무 흐름이 모두 여기서 이름을 가져오므로,
// 이름을 여기서 바꾸면 모든 화면이 함께 바뀐다. 다른 파일을 import 하지 않는다 (브라우저·서버 모두에서 쓴다).
export type CategoryId = 'influencer' | 'campaign'

export const CATEGORY_LABEL: Record<CategoryId, string> = {
  influencer: '인플루언서 계약',
  campaign: '캠페인 집행',
}

/** 엔진의 안건 유형 → 안건 종류(분류) */
export const CASE_TYPE_CATEGORY: Record<string, CategoryId> = {
  'w02.contract_renewal': 'influencer',
  'w02.campaign_expansion': 'campaign',
}

export const caseTypeLabel = (caseType: string): string => {
  const c = CASE_TYPE_CATEGORY[caseType]
  return c ? CATEGORY_LABEL[c] : caseType
}
