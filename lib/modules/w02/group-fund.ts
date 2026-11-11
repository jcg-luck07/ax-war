// 그룹 300억 배분 자금의 집행 기준기간 — 향후 6개월 이내 (03_aurora_group/funding/grp_available_cash.md).
// 현금 유출일(집행 예정일)이 이 기간을 넘으면 300억 배분 검토 대상이 될 수 없다.
export const GROUP_FUND_MONTHS = 6

/** 기준일부터 6개월 뒤 날짜 (YYYY-MM-DD) */
export function groupFundPeriodEnd(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + GROUP_FUND_MONTHS)
  return d.toISOString().slice(0, 10)
}

/** 유출일이 집행 기준기간(6개월)을 넘었는가. 유출일을 모르면 false(판단하지 않는다) */
export function beyondGroupFundPeriod(date: string | null | undefined, asOf: string): boolean {
  return Boolean(date) && String(date) > groupFundPeriodEnd(asOf)
}
