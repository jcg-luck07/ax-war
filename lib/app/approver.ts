// 승인권자를 화면에 어떻게 적을지 — 판정된 역할(규칙집의 Role)과 덧붙는 조건("그룹 보고")을 사람이 읽는 말로 바꾼다 (순수 함수).
// 승인권자는 세 가지 구분이다 (approval_authority_policy.md):
//   ① 마케팅팀 전결 — 원래 팀이 결정한다 (건별 1천만 원 이하이고 기안 총액 1억 원 이하인 캠페인)
//   ② Masil 대표 승인 — 캠페인은 "+ 그룹 보고", 연 10억 원 이하 전속계약은 대표 승인만
//   ③ CEO/이사회 — 연 10억 원 초과 전속계약, 현금 하회 예상 구간의 신규 약정, 그룹 300억 배분 연결 건
const NAME: Record<string, string> = { marketing_team: '마케팅팀 전결', masil_ceo: 'Masil 대표 승인', ceo_board: 'CEO/이사회' }
const SHORT: Record<string, string> = { marketing_team: '마케팅팀 전결', masil_ceo: 'Masil 대표', ceo_board: 'CEO/이사회' }

/** 예) "마케팅팀 전결" · "Masil 대표 승인 + 그룹 보고" · "CEO/이사회". 아직 정해지지 않았으면 "미확정" */
export function authorityText(role: string | null | undefined, also: string[] = []): string {
  if (!role) return '미확정'
  return `${NAME[role] ?? role}${also.length ? ` + ${also.join(', ')}` : ''}`
}

/** 업무 흐름표 칸 제목처럼 짧게 써야 하는 곳: "마케팅팀 전결" · "Masil 대표" · "CEO/이사회". 아직 정해지지 않았으면 "승인권자 미확정" */
export function authorityShort(role: string | null | undefined): string {
  return role ? SHORT[role] ?? role : '승인권자 미확정'
}
