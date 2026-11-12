// 안건의 실제 상태(승인·작업·이력)를 업무 흐름 위에 얹어 "지금 어디까지 왔나"를 계산한다 (순수 함수).
import type { EdgeState, FlowDef, FlowNode, NodeState, Outcome } from './types'

/** 엔진의 CaseView 중 이 계산에 필요한 부분만 (엔진을 import 하지 않기 위한 최소 모양) */
export interface FlowView {
  case: { status: string; authority: string | null }
  approvals: { status: string; requiredRole: string; kind?: string }[]
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
  // 부결 뒤 계약 불연장 통보 같은 두 번째 승인은 업무 흐름의 결정(마름모)으로 세지 않는다
  const mainApprovals = v.approvals.filter((a) => (a.kind ?? 'main') === 'main')
  const pending = mainApprovals.find((a) => a.status === 'pending')
  const decided = [...mainApprovals].reverse().find((a) => a.status === 'approved' || a.status === 'rejected' || a.status === 'on_hold')
  const outcome = pending ? null : ((decided?.status as Outcome | undefined) ?? null)
  const hasEval = v.events.some((e) => e.eventType === 'evaluated')
  const status = v.case.status

  const gateOpen = v.tasks.some((t) => t.status === 'open' && t.detail.gate === 'pre-approval')

  const nodeState = (n: FlowNode): NodeState => {
    const b = n.bind
    switch (b.t) {
      case 'start':
      case 'accept':
        return 'done'
      case 'prep': {
        const mine = v.tasks.filter((t) => key(t) === b.key || (b.infoKeys ?? []).some((k) => key(t).startsWith(k)))
        const open = mine.filter((t) => t.status === 'open')
        if (open.length > 0) {
          const after = open.find((t) => key(t) === b.key)?.detail.after
          const waiting = after ? v.tasks.some((t) => key(t) === String(after) && t.status === 'open') : false
          return waiting ? 'blocked' : 'current'
        }
        if (mine.length > 0) return 'done'
        return hasEval ? 'done' : 'todo' // 이 단계가 생기기 전에 접수된 안건은 끝난 것으로 본다
      }
      case 'decision':
        if (pending) return gateOpen ? 'blocked' : 'current'
        if (outcome) return 'done'
        return 'blocked'
      case 'approval2': {
        const second = v.approvals.filter((a) => (a.kind ?? 'main') !== 'main')
        if (second.some((a) => a.status === 'pending')) return 'current'
        if (second.some((a) => a.status === 'approved' || a.status === 'on_hold')) return 'done'
        if (outcome && outcome !== b.branch) return 'skipped'
        return 'todo'
      }
      case 'task': {
        const t = [...v.tasks].reverse().find((x) => key(x) === b.key) // 다시 열린 작업이 있으면 가장 최근 것
        if (t) {
          if (t.status !== 'open') return t.status === 'done' ? 'done' : 'skipped'
          const after = t.detail.after ? String(t.detail.after) : ''
          return after && v.tasks.some((x) => key(x) === after && x.status === 'open') ? 'blocked' : 'current' // 앞 작업이 끝나야 열린다
        }
        if (outcome && outcome !== b.branch) return 'skipped'
        return 'todo'
      }
      case 'end': {
        if (outcome && outcome !== b.branch) return 'skipped'
        if (b.branch === 'approved') return status === 'closed' ? 'done' : 'todo'
        if (outcome === b.branch) {
          const secondPending = v.approvals.some((a) => (a.kind ?? 'main') !== 'main' && a.status === 'pending') // 불연장 통지서 승인을 기다리는 중
          return secondPending || v.tasks.some((t) => t.status === 'open' && t.taskType !== 'info_request') ? 'todo' : 'done'
        }
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
