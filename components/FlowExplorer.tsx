'use client'

// 안건 화면의 업무 흐름: 그림에서 단계를 누르면 그 단계가 강조된다. 로그인한 사람이 맡은 부서는 연한 파랑 줄로 강조된다.
// 단계별 자세한 내용(자료·근거)은 별도 상자 없이 아래 '다음 행동'·'같이 봐야 할 점'에서 본다.
import { useState } from 'react'
import type { FlowDef } from '@/lib/process/types'
import type { FlowState } from '@/lib/process/state'
import { FlowDiagram, FlowStrip } from './FlowDiagram'

export function FlowExplorer({
  def, state, laneLabels, myLanes, uid, initial,
}: {
  def: FlowDef; state: FlowState; laneLabels: Record<string, string>; myLanes: string[]; uid: string; initial: string
}) {
  const [sel, setSel] = useState(initial)
  return (
    <div className="flex flex-col gap-4">
      <FlowStrip def={def} state={state} laneLabels={laneLabels} />
      <FlowDiagram def={def} state={state} laneLabels={laneLabels} uid={uid} onSelect={setSel} selected={sel} myLanes={myLanes} />
      <p className="t-caption">
        초록 = 끝남 · 파란 테두리 = 지금 여기서 기다림 · 노랑 = 앞 단계가 끝나야 함 · 흐림 = 이번에는 가지 않는 길 · 점선 화살표 = 되돌아가 다시 평가 · 연한 파랑 줄 = 내가 맡은 업무.
      </p>
    </div>
  )
}
