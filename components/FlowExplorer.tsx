// 안건 화면의 업무 흐름 (그림만 보여 준다 — 단계를 눌러도 아무 일도 일어나지 않는다). 지금 단계는 굵은 고리와 "지금 여기" 칩으로, 로그인한 사람이 맡은 부서는 연한 파랑 줄로 강조된다.
// 단계별 자세한 내용(자료·근거)은 아래 '다음 행동'·'같이 봐야 할 점'에서 본다.
import type { FlowDef } from '@/lib/process/types'
import type { FlowState } from '@/lib/process/state'
import { FlowDiagram, FlowStrip } from './FlowDiagram'

export function FlowExplorer({
  def, state, laneLabels, myLanes, uid,
}: {
  def: FlowDef; state: FlowState; laneLabels: Record<string, string>; myLanes: string[]; uid: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <FlowStrip def={def} state={state} laneLabels={laneLabels} />
      <FlowDiagram def={def} state={state} laneLabels={laneLabels} uid={uid} myLanes={myLanes} />
      <p className="t-caption">
        초록 = 끝남 · 파란 테두리 = 지금 여기서 기다림 · 연한 회색 = 현재 단계 이후이거나 이번에는 가지 않는 길 · 점선 화살표 = 되돌아가 다시 평가 · 연한 파랑 줄 = 내가 맡은 업무.
      </p>
    </div>
  )
}
