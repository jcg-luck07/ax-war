// 날짜 칸에 숫자만 쳐도 YYYY-MM-DD 로 만들어 준다 (하이픈은 자동). 브라우저·서버 모두에서 쓴다.
export const formatDateInput = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d
}

/** 금액 칸: 숫자만 받아 1,234,567 처럼 천 단위 쉼표를 자동으로 붙여 보여 준다. 저장·전송에는 쉼표 없는 숫자(digits)를 쓴다 */
export const digitsOnly = (raw: string): string => raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 15)
export const formatMoneyInput = (digits: string): string => (digits === '' ? '' : Number(digits).toLocaleString('ko-KR'))
