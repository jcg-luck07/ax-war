// 시맨틱 레이어: "업무의 뜻"(대상·관계·측정값·지표)을 한 곳에 선언하고, 화면·판단·보고가 모두 이 정의를 거쳐 읽는다.
// 이 파일은 선언의 모양만 정한다 (다른 파일을 import 하지 않음).
//
//  엔티티(Entity)   업무 대상. 원본 CSV 한 파일 = 한 엔티티, 열마다 타입과 뜻이 있다.
//  관계(Relation)   "이 행은 저 행 하나에 속한다"(many-to-one). 주문→캠페인→인플루언서처럼 이어진다.
//  측정값(Measure)  한 엔티티를 기준으로 합계·건수를 내는 단위 계산. 집계 단위(grain)가 서로 달라도 안전하게 합친다.
//  지표(Metric)     측정값을 식으로 조합한 값(예: 실질 공헌이익). 지표 정의는 여기에만 있다.
//  차원(Dimension)  "무엇별로 볼까"(인플루언서별·캠페인별·날짜별).

export type ColType = 'text' | 'number' | 'date' | 'boolean'

export interface Column {
  type: ColType
  label: string
  /** 원본 문서에서 온 설명이나 주의 */
  note?: string
}

/** many-to-one 관계: 이 엔티티의 행은 `to` 엔티티의 행 하나에 속한다. on: { 이쪽 열: 저쪽 열 } */
export interface Relation {
  to: string
  on: Record<string, string>
  label: string
}

/** 데이터 규모 구분 (data_dictionary.md 6항): 풀스케일은 금액 비교가 가능, 대표 표본은 순위·비중·방향만 */
export type Scale = '풀스케일' | '대표 표본' | '마스터' | '계산'

export interface SourceEntity {
  kind: 'source'
  id: string
  label: string
  /** 04_원본데이터 기준 상대 경로 (source_rows.source_file 값) */
  source: string
  grain: string
  scale: Scale
  columns: Record<string, Column>
  relations?: Record<string, Relation>
}

/** 다른 엔티티를 묶어 만든 엔티티(예: 주문별 환불 합계). 집계 단위를 맞추는 데 쓴다. */
export interface AggregateEntity {
  kind: 'aggregate'
  id: string
  label: string
  from: string
  groupBy: string[]
  grain: string
  scale: Scale
  /** 집계 열: sql 은 `from` 엔티티의 열 이름을 쓰는 집계식 */
  columns: Record<string, { type: ColType; label: string; sql: string }>
  relations?: Record<string, Relation>
}

export type Entity = SourceEntity | AggregateEntity

export interface Measure {
  id: string
  label: string
  /** 기준 엔티티(행 하나가 무엇인지) */
  entity: string
  agg: 'sum' | 'count'
  /** 식은 `엔티티.열` 로 쓴다 (기준 엔티티에서 관계로 닿는 엔티티만 쓸 수 있다). count 는 생략 */
  expr?: string
  where?: string
  unit: string
  description: string
  caveats?: string[]
}

export interface Metric {
  id: string
  label: string
  /** 측정값·다른 지표의 id 로 쓴 식. 나눗셈은 nullif(분모, 0) 로 보호한다 */
  expr: string
  /** 사람이 읽는 계산식 */
  formula: string
  unit: string
  /** 모집단·기간·귀속 기준 (A05: 지표를 쓰기 전에 먼저 적는다) */
  basis: string
  sources: string[]
  origin: '원본 정의' | '신규 정의'
  caveats?: string[]
}

export interface Dimension {
  id: string
  label: string
  /** 그룹 기준이 되는 엔티티와 열 */
  entity: string
  key: string
  /** 같이 보여 줄 속성 열 */
  attrs: string[]
}

/** 엔티티마다 날짜 열이 다른 "시간 차원"(현금 유출입 예정일 등). 기준 엔티티별로 쓸 열을 지정한다. */
export interface TimeDimension {
  id: string
  label: string
  columns: Record<string, string>
}

export interface Parameter {
  id: string
  label: string
  default: number
  /** 이 값이 가정이면 이유를 적는다 */
  note: string
}

export interface SemanticModel {
  entities: Record<string, Entity>
  measures: Record<string, Measure>
  metrics: Record<string, Metric>
  dimensions: Record<string, Dimension>
  timeDimensions: Record<string, TimeDimension>
  parameters: Record<string, Parameter>
}

export interface SemanticQuery {
  /** 측정값 또는 지표 id */
  select: string[]
  /** 차원 id 또는 시간 차원 id. 없으면 전체 한 줄 */
  by?: string
  params?: Record<string, number>
}

export type SemanticRow = Record<string, string | number | null>
