'use client'

// 안건 화면의 업무 흐름: 그림에서 노드를 누르면 그 단계의 자세한 내용이 아래에 뜬다.
// 지금 해야 할 단계는 근거 자료(공헌이익 등)가 설명 위쪽에 먼저 나온다. 로그인한 사람이 맡은 부서는 강조된다.
import { useState } from 'react'
import type { FlowDef } from '@/lib/process/types'
import type { FlowState } from '@/lib/process/state'
import type { NodeDetail } from '@/lib/process/detail'
import { FlowDiagram, FlowStrip } from './FlowDiagram'

export function FlowExplorer({
  def, state, laneLabels, myLanes, details, uid, initial,
}: {
  def: FlowDef; state: FlowState; laneLabels: Record<string, string>; myLanes: string[]; details: Record<string, NodeDetail>; uid: string; initial: string
}) {
  const [sel, setSel] = useState(initial)
  const d = details[sel]
  return (
    <div className="flex flex-col gap-4">
      <FlowStrip def={def} state={state} laneLabels={laneLabels} />
      <FlowDiagram def={def} state={state} laneLabels={laneLabels} uid={uid} onSelect={setSel} selected={sel} myLanes={myLanes} />
      <p className="t-caption">
        초록 = 끝남 · 파란 테두리 = 지금 여기서 기다림 · 노랑 = 앞 단계가 끝나야 함 · 흐림 = 이번에는 가지 않는 길 · 점선 화살표 = 되돌아가 다시 평가 · 연한 파랑 줄 = 내가 맡은 업무. 단계를 누르면 아래에 자세한 내용이 나와요.
      </p>
      {d && (
        <div className="flex flex-col gap-4 rounded-card border border-default p-2" aria-live="polite">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="t-body font-semibold">{d.title}</span>
            <span className="t-caption">{d.laneLabel} · {d.stateText}</span>
          </div>
          {d.evidence.map((s) => (
            <div key={s.heading} className="flex flex-col gap-1 rounded-card bg-primary-soft p-2">
              <p className="t-small font-semibold">{s.heading}</p>
              {s.lines.map((l, i) => <p key={i} className="t-small">• {l}</p>)}
            </div>
          ))}
          {d.sections.map((s) => (
            <div key={s.heading} className="flex flex-col gap-1">
              <p className="t-small font-semibold">{s.heading}</p>
              {s.lines.map((l, i) => <p key={i} className="t-small">• {l}</p>)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
