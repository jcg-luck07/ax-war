// 날짜 칸에 숫자만 쳐도 YYYY-MM-DD 로 만들어 준다 (하이픈은 자동). 브라우저·서버 모두에서 쓴다.
export const formatDateInput = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d
}
