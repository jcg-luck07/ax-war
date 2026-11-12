'use client'

// 업무 흐름(BPMN 방식) 그림. 선언(FlowDef) + 안건의 실제 상태(FlowState)만으로 그려요. 서버에서 그려요(상호작용 없음).
//   가로 줄 = 레인(부서·역할), 상자 = 할 일, 마름모 = 분기, 동그라미 = 시작/끝, 화살표 = 다음 순서.
//   색: 초록 = 끝남, 파랑 테두리 = 지금 여기서 기다림, 노랑 = 앞 단계가 끝나야 함, 흐림 = 이번에는 안 가는 길.
import type { EdgeState, FlowDef, FlowNode, NodeState } from '@/lib/process/types'
import type { FlowState } from '@/lib/process/state'

const COL_W = 216
const LABEL_W = 112
const LANE_H = 132
const NODE_W = 146
const NODE_H = 56
const ROW_Y = [36, 98]

interface Props {
  def: FlowDef
  state?: FlowState
  /** 레인 이름 바꾸기 (예: approver → 'CEO/이사회') */
  laneLabels?: Record<string, string>
  /** 개요 화면: 노드마다 기다리는 안건 수 */
  counts?: Record<string, number>
  /** 같은 화면에 그림이 여럿일 때 화살표 머리 id 가 겹치지 않게 */
  uid: string
  /** 로그인한 사람이 맡은 레인 — 강조해서 보여 준다 */
  myLanes?: string[]
}

const STATE_CLASS: Record<NodeState, string> = {
  done: 'bg-success-soft',
  current: 'bg-primary-soft border-2 border-primary font-bold',
  // 현재 단계 이후(아직 오지 않음·앞 단계 대기)는 색을 넣지 않고 연한 회색으로 — 종결된 안건에서 가지 않은 길과 같은 모양
  todo: 'bg-muted border border-dashed border-default opacity-50',
  blocked: 'bg-muted border border-dashed border-default opacity-50',
  skipped: 'bg-muted border border-dashed border-default opacity-50',
}
const STATE_TEXT: Record<NodeState, string> = {
  done: '끝남', current: '지금 여기', todo: '대기', blocked: '앞 단계 대기', skipped: '해당 없음',
}

export function FlowDiagram({ def, state, laneLabels, counts, uid, myLanes }: Props) {
  const laneIndex = new Map(def.lanes.map((l, i) => [l.id, i]))
  const maxCol = Math.max(...def.nodes.map((n) => n.col))
  const width = LABEL_W + (maxCol + 1) * COL_W + 16
  const height = def.lanes.length * LANE_H

  const size = (n: FlowNode) => (n.kind === 'task' ? { w: NODE_W, h: NODE_H } : n.kind === 'gateway' ? { w: 50, h: 50 } : { w: 30, h: 30 })
  const center = (n: FlowNode) => ({ x: LABEL_W + n.col * COL_W + COL_W / 2, y: (laneIndex.get(n.lane) ?? 0) * LANE_H + ROW_Y[n.row ?? 0] })
  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  const st = (n: FlowNode): NodeState => state?.nodes[n.id] ?? 'todo'
  const lanesWithCurrent = new Set((state?.current ?? []).map((n) => n.lane))
  const mine = new Set(myLanes ?? [])

  const edgeClass = (s: EdgeState) =>
    s === 'taken' ? 'text-primary' : s === 'active' ? 'text-primary' : s === 'dim' ? 'text-subtle opacity-30' : 'text-subtle'
  const marker = (s: EdgeState) => `${uid}-${s === 'taken' || s === 'active' ? 'on' : s === 'dim' ? 'dim' : 'off'}`

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width, height }}>
        {/* 레인 */}
        {def.lanes.map((l, i) => (
          <div key={l.id} className={`absolute left-0 right-0 ${mine.has(l.id) ? 'bg-primary-soft' : i % 2 === 0 ? 'bg-surface' : 'bg-content'}`} style={{ top: i * LANE_H, height: LANE_H }}>
            <div className={`absolute left-3 top-1/2 -translate-y-1/2 t-small ${lanesWithCurrent.has(l.id) ? 'font-semibold text-primary' : 'font-semibold'}`} style={{ width: LABEL_W - 20 }}>
              {laneLabels?.[l.id] ?? l.label}{mine.has(l.id) ? ' (내 업무)' : ''}
            </div>
          </div>
        ))}

        {/* 화살표 */}
        <svg className="pointer-events-none absolute left-0 top-0" width={width} height={height} aria-hidden="true">
          <defs>
            {(['on', 'off', 'dim'] as const).map((k) => (
              <marker key={k} id={`${uid}-${k}`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" className={k === 'on' ? 'text-primary' : k === 'dim' ? 'text-subtle opacity-30' : 'text-subtle'}>
                <path d="M0 0L9 4.5L0 9z" fill="currentColor" />
              </marker>
            ))}
          </defs>
          {def.edges.map((e) => {
            const a = byId.get(e.from)!, b = byId.get(e.to)!
            const A = center(a), B = center(b), sa = size(a), sb = size(b)
            const s = state?.edges[`${e.from}->${e.to}`] ?? 'normal'
            let d: string, lx: number, ly: number
            if (e.back) {
              const top = Math.min(A.y - sa.h / 2, B.y - sb.h / 2) - 16
              d = `M${A.x},${A.y - sa.h / 2} V${top} H${B.x} V${B.y - sb.h / 2}`
              lx = (A.x + B.x) / 2
              ly = top - 4
            } else {
              const x1 = A.x + sa.w / 2, x2 = B.x - sb.w / 2
              if (Math.abs(A.y - B.y) < 1) {
                d = `M${x1},${A.y} H${x2}`
                lx = (x1 + x2) / 2
                ly = A.y - 6
              } else {
                const mx = x1 + 26 // 꺾이는 자리 — 화살표 머리 앞에 충분한 직선 구간이 남도록
                d = `M${x1},${A.y} H${mx} V${B.y} H${x2}`
                lx = mx + 4
                ly = B.y - 6
              }
            }
            const thick = s === 'taken' || s === 'active'
            return (
              <g key={`${e.from}-${e.to}`} className={edgeClass(s)}>
                <path d={d} fill="none" stroke="currentColor" strokeWidth={thick ? 2.5 : 1.5} strokeDasharray={s === 'active' ? '6 4' : e.back ? '4 3' : undefined} markerEnd={`url(#${marker(s)})`} />
                {e.label && (
                  <text x={lx} y={ly} fontSize="11" fill="currentColor" textAnchor={e.back ? 'middle' : 'start'}>
                    {e.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* 노드 */}
        {def.nodes.map((n) => {
          const c = center(n), sz = size(n), s = st(n)
          const count = counts?.[n.id]
          const left = c.x - sz.w / 2, top = c.y - sz.h / 2
          const isMine = mine.has(n.lane)
          return (
            <div key={n.id}>
              {isMine && n.kind === 'task' && (
                <div className="pointer-events-none absolute rounded-card border-2 border-primary" style={{ left: left - 3, top: top - 3, width: sz.w + 6, height: sz.h + 6, opacity: 0.55, borderRadius: 14 }} aria-hidden="true" />
              )}
              {n.kind === 'task' && (
                <div className={`absolute flex flex-col items-center justify-center rounded-card px-2 text-center ${STATE_CLASS[s]}`} style={{ left, top, width: sz.w, height: sz.h, borderRadius: 12 }} title={`${n.label} — ${STATE_TEXT[s]}`}>
                  <span className="text-caption-01 font-semibold leading-tight">{n.label}</span>
                  {n.hint && <span className="text-caption-02 text-muted leading-tight">{n.hint}</span>}
                </div>
              )}
              {n.kind === 'gateway' && (
                <>
                  <div className={`absolute rotate-45 rounded-input ${STATE_CLASS[s]}`} style={{ left: left + 6, top: top + 6, width: sz.w - 12, height: sz.h - 12 }} title={`${n.label} — ${STATE_TEXT[s]}`} />
                  <div className="absolute text-center text-caption-02 leading-tight" style={{ left: c.x - 44, top: top + sz.h + 2, width: 88 }}>{n.label}</div>
                </>
              )}
              {(n.kind === 'start' || n.kind === 'end') && (
                <>
                  <div className={`absolute rounded-full ${n.kind === 'end' ? 'border-4 border-default' : ''} ${s === 'done' ? 'bg-success-soft' : s === 'current' ? 'bg-primary-soft border border-primary' : 'bg-muted opacity-50'}`} style={{ left, top, width: sz.w, height: sz.h }} title={`${n.label} — ${STATE_TEXT[s]}`} />
                  <div className="absolute text-center text-caption-02 leading-tight" style={{ left: c.x - 52, top: top + sz.h + 3, width: 104 }}>{n.label}</div>
                </>
              )}
              {s === 'current' && !counts && (
                <>
                  {/* 지금 여기: 노드 둘레에 굵은 고리 + 위에 진한 칩을 달아 한눈에 보이게 한다 */}
                  {n.kind === 'gateway' ? (
                    // 마름모 노드는 고리도 같은 마름모 모양(정사각형을 45도 돌린 것)으로
                    <div className="pointer-events-none absolute rotate-45 animate-pulse border-4 border-primary rounded-input" style={{ left, top, width: sz.w, height: sz.h }} aria-hidden="true" />
                  ) : (
                    <div className="pointer-events-none absolute animate-pulse border-4 border-primary" style={{ left: left - 6, top: top - 6, width: sz.w + 12, height: sz.h + 12, borderRadius: n.kind === 'task' ? 16 : 999 }} aria-hidden="true" />
                  )}
                  {/* 칩은 노드보다 넓게 잡아 한 줄로 보이게 (줄바꿈 금지) */}
                  <div className="absolute flex justify-center" style={{ left: c.x - 60, top: top - (n.kind === 'gateway' ? 38 : 30), width: 120 }}>
                    <span className="whitespace-nowrap rounded-full bg-primary px-3 py-0.5 text-caption-01 font-semibold text-primary-fg">▼ 지금 여기</span>
                  </div>
                </>
              )}
              {counts && count ? (
                <div className="absolute flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-caption-01 font-semibold text-primary-fg" style={{ left: left + sz.w - 12, top: top - 10 }}>
                  {count}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** "지금 → 다음" 한 줄 요약: 어느 부서가 무엇을 해야 하고, 그다음은 누구인지 */
export function FlowStrip({ def, state, laneLabels }: { def: FlowDef; state: FlowState; laneLabels?: Record<string, string> }) {
  const lane = (id: string) => laneLabels?.[id] ?? def.lanes.find((l) => l.id === id)?.label ?? id
  if (state.current.length === 0) {
    return <p className="t-small">{state.outcome ? '결정이 끝났고 남은 작업이 없어요.' : '지금 기다리는 단계가 없어요.'}</p>
  }
  return (
    <div className="flex flex-col gap-1">
      {state.current.map((n) => {
        const succ = def.edges
          .filter((e) => e.from === n.id && !e.back)
          .map((e) => def.nodes.find((x) => x.id === e.to)!)
          .map((x) => `${lane(x.lane)}(${x.label})${state.nodes[x.id] === 'current' ? ' · 함께 진행 중' : ''}`)
        return (
          <p key={n.id} className="t-small">
            <strong>지금</strong> · {lane(n.lane)} — {n.label}
            {succ.length > 0 && (
              <>
                {' '}→ <strong>다음</strong> · {succ.join(', ')}
              </>
            )}
          </p>
        )
      })}
    </div>
  )
}
