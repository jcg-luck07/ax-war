// 업무 흐름(BPMN 방식) 선언의 모양. 다른 파일을 import 하지 않는다.
//
// 업무 흐름은 "누가(레인) → 무엇을(노드) → 다음은(화살표)"를 선언한 것이고, 안건이 지금 어디 와 있는지는
// 엔진의 실제 상태(승인·작업·이력)에서 계산해 얹는다(state.ts). 그림은 선언 + 상태만으로 그려진다.

export type NodeKind = 'start' | 'task' | 'gateway' | 'end'

/** 노드가 안건의 어떤 실제 상태에 대응하는지 */
export type NodeBind =
  | { t: 'start' } // 업무 발생 — 팀원이 안건을 올림
  | { t: 'accept' } // 안건 접수 — 팀장(접수 권한자)이 받음. 안건이 있다는 것 자체가 접수됐다는 뜻
  | { t: 'prep'; key: string; infoKeys?: string[] } // 승인 앞 단계 작업(detail.key) + 같은 부서에 온 확인 요청(detail.key 가 infoKeys 로 시작)
  | { t: 'decision' } // 승인권자의 결정 (마름모: 승인됐는가?)
  | { t: 'task'; key: string; branch: Outcome } // 결정 뒤 생기는 후속 작업(detail.key)
  | { t: 'end'; branch: Outcome }

export type Outcome = 'approved' | 'rejected' | 'on_hold'

export interface FlowNode {
  id: string
  kind: NodeKind
  label: string
  /** 어느 레인(부서·역할)의 일인가. 'approver' 는 지금 판정된 승인권자 이름으로 바뀐다 */
  lane: string
  /** 왼쪽에서 몇 번째 칸 */
  col: number
  /** 레인 안의 위/아래 줄 (겹침 방지) */
  row?: 0 | 1
  bind: NodeBind
  /** 노드 아래에 덧붙이는 짧은 설명 */
  hint?: string
}

export interface FlowEdge {
  from: string
  to: string
  label?: string
  /** 결정 결과 분기 화살표라면 어떤 결과인지 (그 결과일 때 굵게) */
  when?: Outcome
  /** 앞으로 되돌아가는 화살표(재평가·재상신) */
  back?: boolean
}

export interface FlowLane {
  id: string
  label: string
}

export interface FlowDef {
  id: string
  title: string
  /** 이 흐름을 따르는 안건 유형 */
  caseTypes: string[]
  description: string
  lanes: FlowLane[]
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/** 노드의 현재 상태 */
export type NodeState =
  | 'done' // 끝남
  | 'current' // 지금 여기서 기다리는 중 (사람의 행동 필요)
  | 'todo' // 아직 안 옴
  | 'blocked' // 앞 단계(확인 요청)가 끝나야 진행 가능
  | 'skipped' // 이번 안건에는 해당 없음/택하지 않은 길

export type EdgeState = 'taken' | 'active' | 'normal' | 'dim'
