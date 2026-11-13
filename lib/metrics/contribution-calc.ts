// 안건 제출 화면의 "공헌이익 계산" — 팀원이 빈칸을 채우면 공헌이익이 나온다 (순수 함수, 브라우저·서버 모두에서 쓴다).
// 식은 시맨틱 레이어의 지표 정의(lib/semantic/model.ts: contribution_profit)와 같다:
//   공헌이익 = Net Revenue − 제품원가 − 채널수수료 − 출고(배송)비 − 반품 물류비 − 마케팅 지출,  Net Revenue = GMV − 반품환불액
// 여기 입력값은 "예상(추계)"이라 실제 성과가 아니다 — 안건에는 [가정/추계]로 남긴다.

export interface ContributionInput {
  /** 예상 GMV */
  gmv: number
  /** 예상 반품환불액 */
  refund: number
  /** 제품원가 */
  cogs: number
  /** 채널 수수료 */
  channelFee: number
  /** 출고(배송)비 */
  shipping: number
  /** 반품 물류비 */
  returnLogistics: number
  /** 마케팅 지출 — 요청금액(광고비 또는 연 고정 피) */
  marketingSpend: number
}

export interface ContributionResult {
  netRevenue: number
  contributionProfit: number
  /** 명목 ROAS = GMV / 마케팅 지출 (지출이 0 이면 null) */
  nominalRoas: number | null
  /** 실질 ROAS = 공헌이익 / 마케팅 지출 */
  realRoas: number | null
  /** 반품률 = 환불 / GMV (GMV 가 0 이면 null) */
  returnRate: number | null
}

/** 빈 칸은 0 이 아니라 null — "모름"과 "0원"을 구분한다 (0 원은 실제로 0 원일 때만) */
export type PartialContribution = { [K in keyof ContributionInput]: number | null }

/** 비어 있는(null) 입력 칸의 이름 목록 (화면에 쓰는 말) */
export function missingContribution(i: PartialContribution): string[] {
  const out: string[] = CONTRIBUTION_FIELDS.filter((f) => i[f.key] === null || i[f.key] === undefined || !Number.isFinite(i[f.key] as number)).map((f) => f.label)
  if (i.marketingSpend === null || i.marketingSpend === undefined || !Number.isFinite(i.marketingSpend)) out.push('마케팅 지출(요청금액)')
  return out
}

/** 모든 칸이 있을 때만 계산한다. 하나라도 비어 있으면 null — 0 으로 보고 계산하지 않는다 */
export function calcContributionIfComplete(i: PartialContribution): ContributionResult | null {
  return missingContribution(i).length > 0 ? null : calcContribution(i as ContributionInput)
}

/** 입력 칸 정의 — 화면이 이 순서로 칸을 그린다 (단위: 원, 1원 단위까지) */
export const CONTRIBUTION_FIELDS: { key: Exclude<keyof ContributionInput, 'marketingSpend'>; label: string; hint: string }[] = [
  { key: 'gmv', label: '예상 GMV', hint: '이 집행·계약으로 기대하는 총 주문금액' },
  { key: 'refund', label: '예상 반품 환불액', hint: '예상 GMV 중 환불될 것으로 보는 금액' },
  { key: 'cogs', label: '제품 원가', hint: '예상 주문에 들어갈 제품 원가 합계' },
  { key: 'channelFee', label: '채널 수수료', hint: '판매 채널에 내는 수수료 합계' },
  { key: 'shipping', label: '출고(배송)비', hint: '출고·배송에 드는 비용 합계' },
  { key: 'returnLogistics', label: '반품 물류비', hint: '환불 건의 회수·물류 비용 합계' },
]

export const CONTRIBUTION_FORMULA =
  '공헌이익 = (예상 GMV − 예상 반품 환불액) − 제품 원가 − 채널 수수료 − 출고(배송)비 − 반품 물류비 − 마케팅 지출(= 요청금액)'

export function calcContribution(i: ContributionInput): ContributionResult {
  const netRevenue = i.gmv - i.refund
  const contributionProfit = netRevenue - i.cogs - i.channelFee - i.shipping - i.returnLogistics - i.marketingSpend
  return {
    netRevenue,
    contributionProfit,
    nominalRoas: i.marketingSpend > 0 ? i.gmv / i.marketingSpend : null,
    realRoas: i.marketingSpend > 0 ? contributionProfit / i.marketingSpend : null,
    returnRate: i.gmv > 0 ? i.refund / i.gmv : null,
  }
}

/** 입력 검사: 모든 칸이 채워져 있고(0 은 가능) 0 이상이며, 환불이 GMV 를 넘지 않는다. 문제가 없으면 null */
export function validateContribution(raw: Partial<Record<keyof ContributionInput, string>>, keys: (keyof ContributionInput)[]): string | null {
  for (const k of keys) {
    const v = (raw[k] ?? '').trim()
    if (v === '') return '공헌이익 계산 칸을 모두 채워 주세요 (해당 없으면 0)'
    if (!Number.isInteger(Number(v)) || Number(v) < 0) return '공헌이익 계산 칸에는 0 이상의 정수(원)를 넣어 주세요'
  }
  if (Number(raw.refund) > Number(raw.gmv)) return '예상 반품 환불액이 예상 GMV 보다 클 수 없어요'
  return null
}
