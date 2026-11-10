// 안건의 실제 상태(승인·작업·이력)를 업무 흐름 위에 얹어 "지금 어디까지 왔나"를 계산한다 (순수 함수).
import type { EdgeState, FlowDef, FlowNode, NodeState, Outcome } from './types'

/** 엔진의 CaseView 중 이 계산에 필요한 부분만 (엔진을 import 하지 않기 위한 최소 모양) */
export interface FlowView {
  case: { status: string; authority: string | null }
  approvals: { status: string; requiredRole: string }[]
  tasks: { taskType: string; status: string; title: string; assigneeRole: string | null; detail: Record<string, unknown> }[]
  events: { eventType: string }[]
}

export interface FlowState {
  nodes: Record<string, NodeState>
  edges: Record<string, EdgeState> // `${from}->${to}`
  /** 결정된 결과 (승인/부결/보류). 아직이면 null */
  outcome: Outcome | null
  /** 지금 사람의 행동이 필요한 노드들 */
  current: FlowNode[]
  /** 지금 다음으로 이어질 노드들 (현재 노드에서 나가는 화살표의 끝) */
  next: FlowNode[]
}

const key = (t: { detail: Record<string, unknown> }) => String(t.detail.key ?? '')

export function deriveFlowState(def: FlowDef, v: FlowView): FlowState {
  const pending = v.approvals.find((a) => a.status === 'pending')
  const decided = [...v.approvals].reverse().find((a) => a.status === 'approved' || a.status === 'rejected' || a.status === 'on_hold')
  const outcome = pending ? null : ((decided?.status as Outcome | undefined) ?? null)
  const hasEval = v.events.some((e) => e.eventType === 'evaluated')
  const infoTasks = v.tasks.filter((t) => t.taskType === 'info_request')
  const status = v.case.status

  const nodeState = (n: FlowNode): NodeState => {
    const b = n.bind
    switch (b.t) {
      case 'start':
        return 'done'
      case 'eval':
        return hasEval ? 'done' : 'todo'
      case 'infoGate':
        return hasEval ? 'done' : 'todo'
      case 'info': {
        const mine = infoTasks.filter((t) => b.keys.some((k) => key(t).startsWith(k)))
        if (mine.some((t) => t.status === 'open')) return 'current'
        if (mine.length > 0) return 'done'
        return 'skipped'
      }
      case 'decision':
        if (pending) return 'current'
        if (outcome) return 'done'
        return status === 'need_info' || status === 'open' ? 'blocked' : 'todo'
      case 'outcomeGate':
        return outcome ? 'done' : 'todo'
      case 'task': {
        const t = v.tasks.find((x) => key(x) === b.key)
        if (t) return t.status === 'open' ? 'current' : t.status === 'done' ? 'done' : 'skipped'
        if (outcome && outcome !== b.branch) return 'skipped'
        return 'todo'
      }
      case 'end': {
        if (outcome && outcome !== b.branch) return 'skipped'
        if (b.branch === 'approved') return status === 'closed' ? 'done' : 'todo'
        if (outcome === b.branch) return v.tasks.some((t) => t.status === 'open' && t.taskType !== 'info_request') ? 'todo' : 'done'
        return 'todo'
      }
    }
  }

  const nodes: FlowState['nodes'] = {}
  for (const n of def.nodes) nodes[n.id] = nodeState(n)
  // 결정 전이면 확인 요청이 한 번도 없었는데 승인 요청 경로만 밟은 경우 '모르는 사실?' 은 '없음'으로 지나간 것

  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  const edges: FlowState['edges'] = {}
  for (const e of def.edges) {
    const from = nodes[e.from], to = nodes[e.to]
    let s: EdgeState = 'normal'
    if (e.when) {
      s = outcome === null ? 'normal' : outcome === e.when ? 'taken' : 'dim'
    } else if (from === 'skipped' || to === 'skipped') {
      s = 'dim'
    } else if (e.from === 'gwInfo') {
      // '있음' 길은 확인 요청이 있었을 때, '없음' 길은 없었을 때
      const wentInfo = infoTasks.length > 0
      const toInfo = byId.get(e.to)?.bind.t === 'info'
      const toNow: NodeState = nodes[e.to]
      s = toInfo ? (wentInfo && toNow !== 'skipped' ? (toNow === 'current' ? 'active' : 'taken') : 'dim') : wentInfo && status === 'need_info' ? 'dim' : 'taken'
    } else if (e.back) {
      s = from === 'done' && infoTasks.length > 0 && hasEval ? 'taken' : 'dim'
    } else if (from === 'done' && (to === 'done' || to === 'current')) {
      s = to === 'current' ? 'active' : 'taken'
    }
    edges[`${e.from}->${e.to}`] = s
  }

  const current = def.nodes.filter((n) => nodes[n.id] === 'current')
  const next: FlowNode[] = []
  for (const c of current) {
    for (const e of def.edges) if (e.from === c.id && !e.back) { const t = byId.get(e.to); if (t && !next.includes(t) && !current.includes(t)) next.push(t) }
  }
  return { nodes, edges, outcome, current, next }
}

/** 개요 화면: 안건들이 각 노드에서 몇 건씩 기다리는지 센다 */
export function countWaiting(def: FlowDef, states: FlowState[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of states) for (const n of s.current) out[n.id] = (out[n.id] ?? 0) + 1
  return out
}
