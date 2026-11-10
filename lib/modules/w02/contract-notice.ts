// INF-001(혜인) 전속계약 갱신 통보서의 내용을 옮겨 적은 값.
// 출처: 04_원본데이터/02_masil/marketing/inf001_exclusive_contract_notice.md  (md 문서라 CSV 처럼 DB 에 복사되지 않아 값만 옮김)
// 금액·날짜는 문서 그대로이며, 문서에 없는 항목은 null 로 두고 '미확인'으로 취급한다.

export const CONTRACT_NOTICE = {
  sourceFile: '02_masil/marketing/inf001_exclusive_contract_notice.md',
  influencerId: 'INF-001',
  influencerName: '혜인',
  contractType: '연간 전속 (계약 기간 중 경쟁 브랜드 활동 제한)',
  /** 고정 피 연 28억 원 — 성과와 무관하게 발생. 풀스케일 계약 금액 */
  annualFixedFeeKrw: 2_800_000_000,
  currentExpiry: '2026-08-31',
  /** 해지·조건변경 통보 기한. 넘기면 동일 조건으로 1년 자동 갱신(= 체결로 본다) */
  notifyDeadline: '2026-07-17',
  /** 갱신 후 중도 해지 시 잔여 고정 피의 50% 위약금 */
  penaltyRateAfterRenewal: 0.5,
  // ── 문서에 없는 정보 (미확인 — 임의로 채우지 않는다) ──
  performanceFeeTerms: null as string | null, // 성과 피(GMV 연동) 정산 조건 원문 없음
  fixedFeePaymentSchedule: null as string | null, // 고정 피 지급 일정 없음 → 현금 유출일 미상
  noticeReceiptProof: null as string | null, // 실제 통보 수령 증빙 없음
} as const

export const CONTRACT_CASE_TYPE = 'w02.contract_renewal'
export const EXPANSION_CASE_TYPE = 'w02.campaign_expansion'
