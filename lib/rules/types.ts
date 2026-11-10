// 규칙집의 공통 모양. 규칙은 "코드"가 아니라 "데이터"로 쓰고, 판정 로직(evaluate.ts)은 이 모양만 안다.
// 다른 파일을 import 하지 않는다 (타입만 있음).

export type FactValue = string | number | boolean | null | undefined
/** 판단에 쓰는 사실들. 모르는 값은 null/undefined — 0 이나 false 로 바꾸지 않는다. */
export type Facts = Record<string, FactValue>

export type Op = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'

export interface Condition {
  fact: string
  op: Op
  value: string | number | boolean
}

/** 승인권자. rank 가 클수록 높은 권한. 판정은 "가장 높은 rank" 를 따른다(권한을 낮추는 규칙은 없다). */
export interface Role {
  id: string
  label: string
  rank: number
}

export interface Rule {
  id: string
  title: string
  /** 적용할 안건 유형. '*' 는 모든 유형. */
  appliesTo: readonly string[]
  /** 모두 참이어야 함 */
  all?: readonly Condition[]
  /** 하나라도 참이면 됨 */
  any?: readonly Condition[]
  outcome: {
    authority: string // Role.id
    /** 승인권자 외에 추가로 해야 하는 일 (예: 그룹 보고) */
    also?: readonly string[]
  }
  /** common: 모든 업무에 걸친 공통 규칙(평시 전결 규정에 우선) / business: 업무별 규칙 */
  layer: 'business' | 'common'
  /** 근거 — 04_원본데이터 기준 파일과 해당 대목 */
  source: { file: string; note: string }
  /** 원본: 문서에 있는 규칙 그대로 / 가정: 문서에 없거나 해석이 필요해서 내가 정한 부분 */
  origin: '원본' | '가정'
  remark?: string
}

/** 조건 평가 결과: 참 / 거짓 / 모름 */
export type Tri = true | false | 'unknown'

export interface MatchedRule {
  ruleId: string
  title: string
  authority: string
  layer: Rule['layer']
  origin: Rule['origin']
  source: Rule['source']
}

export interface UnresolvedRule {
  ruleId: string
  title: string
  /** 모르는 사실 이름들 — 확인 요청 작업의 내용이 된다 */
  missingFacts: string[]
  /** 이 사실이 "참"으로 밝혀지면 필요해지는 승인권자 */
  wouldRequire: string
}

export interface AuthorityDecision {
  /** decided: 승인권자 확정 / need_info: 모르는 사실 때문에 확정 불가 / no_rule: 적용 규칙 없음 */
  status: 'decided' | 'need_info' | 'no_rule'
  authority: string | null // Role.id
  authorityLabel: string | null
  also: string[]
  matched: MatchedRule[]
  unresolved: UnresolvedRule[]
  /** 사람이 읽는 설명 (감사 이력·화면에 그대로 쓴다) */
  trace: string[]
}
