// 안건 제출 제목 — 제출 화면(미리보기)과 서버(저장)가 같은 규칙을 쓰도록 서버 코드 없이 따로 둔 순수 함수.
// 원본 데이터의 이름 방식을 따른다:
//  · 캠페인 이름: "인플루언서 제품종류 캠페인N" (예: 혜인 기초 캠페인3). 새 캠페인은 그 인플루언서의 다음 번호를 쓴다.
//  · 캠페인 안건 제목: "캠페인 이름 확대" / "캠페인 이름 신규"  (예: 혜인 기초 캠페인3 확대)
//  · 전속계약 안건 제목: "인플루언서(ID) 연간 전속계약 갱신" / "… 신규"
//  · 같은 제목이 이미 있으면 번호를 올려 구분한다 (확대2, 확대3 … / 갱신2, 갱신3 …).

/** 분류별 구분 선택지 */
export const DEAL_TYPES: Record<string, readonly string[]> = {
  campaign: ['신규', '확대'],
  influencer: ['신규', '갱신'],
}
export const DEAL_LABEL: Record<string, string> = { campaign: '캠페인 구분', influencer: '계약 구분' }

/** 제목에서 분류코드·요청액·내부 번호(SYN-/PLAN-/SUB-)를 덜어 낸 모양. 목록·중복 검사가 이 모양을 쓴다.
 *  예: "혜인(INF-001) 연간 전속계약 갱신 — 고정 피 연 28억 원" → "혜인 연간 전속계약 갱신" */
export function plainTitle(title: string): string {
  return title
    .replace(/\s+[—–-]\s+.*$/, '')
    .replace(/\s*\((INF|CMP)-\d+\)/g, '')
    .replace(/(^|\s)(SYN|PLAN|SUB)-[A-Z0-9]+\s*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 캠페인 이름 끝의 번호 (예: "혜인 기초 캠페인3" → 3, 없으면 0) */
export const campaignNumber = (name: string): number => Number(name.match(/캠페인\s*(\d+)\s*$/)?.[1] ?? 0)

/** 새 캠페인의 이름 — 그 인플루언서의 가장 큰 번호 다음 번호 */
export const nextCampaignName = (influencerName: string, productLine: string, maxNumber: number): string =>
  [influencerName, productLine, `캠페인${maxNumber + 1}`].filter(Boolean).join(' ')

export interface TitleParts {
  category: string
  /** 캠페인은 캠페인 이름, 전속계약은 "이름(ID)" */
  name: string
  deal: string
  feeType?: string
  amountText: string
}

/** 제목 (seq 가 2 이상이면 구분 글자 뒤에 번호를 붙인다: 확대2, 갱신3 …) */
export function buildTitle(p: TitleParts, seq = 1): string {
  const dealWord = seq > 1 ? `${p.deal}${seq}` : p.deal
  if (p.category === 'influencer') return `${p.name} 연간 전속계약 ${dealWord} — ${p.feeType || '고정 피'} 연 ${p.amountText}`
  return `${p.name} ${dealWord} — 요청 ${p.amountText}`
}

/** 이미 있는 제목(taken)과 겹치지 않는 가장 앞 번호의 제목. 겹침은 코드·금액을 덜어 낸 모양(plainTitle)으로 비교한다. */
export function uniqueTitle(p: TitleParts, taken: Iterable<string>): string {
  const used = new Set<string>()
  for (const t of taken) used.add(plainTitle(t))
  for (let seq = 1; seq < 1000; seq++) {
    const t = buildTitle(p, seq)
    if (!used.has(plainTitle(t))) return t
  }
  return buildTitle(p, 1000)
}
