// 범용 의사결정 엔진의 공통 타입. 화면·서버 어디서든 import 해도 안전하다 (DB 코드 없음).

/** 안건 상태. 이 값이 다음 판단에 쓰인다. */
export type CaseStatus =
  | 'open' // 접수됨
  | 'need_info' // 정보 부족 — 확인 요청 작업이 열려 있음
  | 'pending_approval' // 승인 대기
  | 'approved'
  | 'rejected'
  | 'on_hold' // 보류
  | 'closed'

/** 데이터의 성격. 원본과 가정을 항상 구분해 표시한다. */
export type DataOrigin = '원본' | '가정' | '합성' | '가상입력' | '사용자입력'

export type ActorKind = '시스템' | '사람'

/** superseded: 재평가로 승인권자가 바뀌어 더 이상 유효하지 않은 승인 요청 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'on_hold' | 'superseded'

export type TaskStatus = 'open' | 'done' | 'cancelled'

export interface DecisionCase {
  id: number
  caseType: string
  title: string
  status: CaseStatus
  deadline: string | null
  subjectRefs: Record<string, string>
  payload: Record<string, unknown>
  authority: string | null
  dataOrigin: DataOrigin
  createdAt: string
  updatedAt: string
}
