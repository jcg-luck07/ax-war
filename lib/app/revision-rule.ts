// 수정 보고의 금액 변동 기준 (순수 함수 — 서버와 화면이 같은 기준을 쓴다).
//   5% 이내: 최초로 결정한 승인권자에게 바로 보고 / 5% 초과: 재무팀 절차부터 다시
/** 이 비율 이하의 금액 변동은 재무팀 절차 없이 바로 승인권자에게 보고한다 */
export const REVISION_THRESHOLD = 0.05

export function revisionRoute(from: number, to: number): { pct: number; route: 'direct' | 'restart' } {
  const pct = from > 0 ? Math.abs(to - from) / from : 1
  // 부동소수 오차로 정확히 5% 인 변동이 넘는 것으로 보이지 않도록 반올림한다
  return { pct, route: Math.round(pct * 1e9) / 1e9 <= REVISION_THRESHOLD ? 'direct' : 'restart' }
}
