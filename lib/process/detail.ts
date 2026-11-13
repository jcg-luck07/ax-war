// 업무 흐름의 노드를 눌렀을 때 보여 줄 자세한 내용을 만든다 (순수 함수). 안건의 실제 이력·승인·작업에서만 가져오고 새로 지어내지 않는다.
import type { CaseView } from '@/lib/engine/engine'
import type { FlowDef, NodeState } from './types'
import type { FlowState } from './state'

export interface NodeDetail {
  id: string
  title: string
  /** 어느 부서·역할의 일인가 */
  laneLabel: string
  stateText: string
  state: NodeState
  /** 지금 해야 할 일이면 위쪽에 계속 보여 줄 근거 */
  evidence: { heading: string; lines: string[] }[]
  sections: { heading: string; lines: string[] }[]
}

export interface StepLines {
  lines: string[]
  missing: string[]
}

export interface DetailCtx {
  laneLabel: (laneId: string) => string
  fmtTime: (iso: string) => string
  roleLabel: (id: string) => string
  /** 업무 발생: 팀원이 올린 기록(접수 대기 테이블). 원본 파일에서 일괄 접수한 안건이면 null */
  submission: { submittedBy: string; createdAt: string; categoryLabel: string; refId: string; input: { label: string; value: string }[] } | null
  /** 원본 파일에서 가져온 안건이면 그 설명 */
  sourceNote: string | null
  finance: StepLines
  contract: StepLines
  /** 주 판단기준(공헌이익) 근거와 보조 지표 — 승인 결정 단계에서 위쪽에 보여 준다 */
  primaryEvidence: string[]
  secondaryEvidence: string[]
  caveats: string[]
  ruleTrace: string[]
}

const STATE_TEXT: Record<NodeState, string> = { done: '끝남', current: '지금 해야 함', todo: '대기', blocked: '앞 단계가 끝나야 함', skipped: '이번에는 해당 없음' }
const TASK_STATUS: Record<string, string> = { open: '진행 중', done: '완료', cancelled: '취소됨' }
const APPROVAL_STATUS: Record<string, string> = { pending: '결정 대기', approved: '승인', rejected: '부결', on_hold: '재검토', superseded: '대체됨' }
const keyOf = (t: { detail: Record<string, unknown> }) => String(t.detail.key ?? '')
const ANSWER = (r: Record<string, unknown> | null) =>
  r ? Object.entries((r as { answers?: Record<string, unknown> }).answers ?? {}).map(([k, v]) => `${k}: ${String(v)}`) : []

export function buildNodeDetails(def: FlowDef, state: FlowState, view: CaseView, ctx: DetailCtx): Record<string, NodeDetail> {
  const out: Record<string, NodeDetail> = {}
  const ev = (type: string) => view.events.filter((e) => e.eventType === type)
  const who = (e: { actorKind: string; actorName: string | null; createdAt: string }) => `${e.actorName ?? e.actorKind} · ${ctx.fmtTime(e.createdAt)}`
  const doneEvent = (taskId: number) => ev('task_done').find((e) => (e.detail as { taskId?: number }).taskId === taskId)

  for (const n of def.nodes) {
    const st = state.nodes[n.id]
    const sections: NodeDetail['sections'] = []
    const evidence: NodeDetail['evidence'] = []
    // 지금 해야 하거나 앞 단계를 기다리는 단계의 내용은 위쪽(evidence)에, 끝난 단계는 아래쪽(sections)에 둔다
    const place = (sec: { heading: string; lines: string[] }) => (st === 'current' || st === 'blocked' ? evidence : sections).push(sec)
    const b = n.bind
    switch (b.t) {
      case 'start': {
        const lines: string[] = []
        if (ctx.submission) {
          const s = ctx.submission
          lines.push(`마케팅 팀원 ${s.submittedBy} 이(가) 안건을 제출해 팀장에게 보고했어요 (${ctx.fmtTime(s.createdAt)})`)
          lines.push(`분류: ${s.categoryLabel} · 대상 ID ${s.refId}`)
          for (const i of s.input) lines.push(`${i.label}: ${i.value}`)
        } else {
          lines.push('마케팅 팀원이 올린 기안이에요.')
          if (ctx.sourceNote) lines.push(ctx.sourceNote)
        }
        lines.push(`안건: ${view.case.title}`)
        if (view.case.deadline) lines.push(`마감: ${view.case.deadline}`)
        sections.push({ heading: '업무 발생 — 팀원의 안건 보고', lines })
        break
      }
      case 'accept': {
        const c = ev('created')[0]
        const evals = ev('evaluated')
        const chk = (view.case.payload as { submission?: { checklist?: { by: string; at: string; items: string[] } } }).submission?.checklist
        sections.push({
          heading: '기안 접수 — 팀장이 팀원들의 안건을 모아 기안으로 등록',
          lines: [
            c ? `접수: ${who(c)}` : '',
            `팀원이 올린 안건을 팀장(접수 권한자)이 받아 안건 #${view.case.id} 로 등록하고 재무팀에 회부했어요.`,
            '접수와 동시에 규칙집이 평가해서 승인권자를 정했어요:',
            ...ctx.ruleTrace.slice(0, 6).map((t) => `  ${t}`),
            ...(chk ? [`접수 체크리스트 ${chk.items.length}개 항목을 ${chk.by} 이(가) 모두 확인했어요 (${ctx.fmtTime(chk.at)}):`, ...chk.items.map((t) => `  ✔ ${t}`)] : []),
            evals.length > 1 ? `이후 조건이 바뀌어 다시 평가한 횟수: ${evals.length - 1}회` : '',
          ].filter(Boolean),
        })
        break
      }
      case 'prep': {
        const pkg = b.key === 'confirm-terms' ? ctx.contract : ctx.finance
        const task = view.tasks.find((x) => keyOf(x) === b.key)
        const done = task ? doneEvent(task.id) : undefined
        const taskLines: string[] = task
          ? [
              `담당: ${task.assigneeRole ?? '미정'} · 상태 ${TASK_STATUS[task.status] ?? task.status}${task.dueDate ? ` · 기한 ${task.dueDate}` : ''}`,
              done ? `완료: ${who(done)}` : task.status === 'open' ? (st === 'blocked' ? '앞 단계(재무 취합)가 끝나야 시작할 수 있어요.' : '이 작업을 끝내야 승인권자가 결정할 수 있어요.') : '',
            ].filter(Boolean)
          : ['이 단계가 생기기 전에 접수된 안건이라 작업 기록이 없어요.']
        place({ heading: `${n.label} — 작업`, lines: taskLines })
        // 같은 부서에 온 확인 요청
        for (const t of view.tasks.filter((x) => x.taskType === 'info_request' && (b.infoKeys ?? []).some((k) => keyOf(x).startsWith(k)))) {
          const recv = ev('info_received').find((e) => (e.detail as { taskId?: number }).taskId === t.id)
          const lines = [`담당: ${t.assigneeRole ?? '미정'} · 상태 ${TASK_STATUS[t.status] ?? t.status}${t.dueDate ? ` · 기한 ${t.dueDate}` : ''}`, `질문: ${String(t.detail.question ?? '')}`]
          if (t.response) lines.push(`회신: ${ANSWER(t.response).join(', ')}${recv ? ` (${who(recv)})` : ''}`)
          ;(t.status === 'open' ? evidence : sections).push({ heading: `확인 요청: ${t.title}`, lines })
        }
        if (pkg.lines.length) place({ heading: '이 단계에서 모은 자료와 근거', lines: pkg.lines })
        if (pkg.missing.length) place({ heading: '원본에 없어 확인되지 않은 것', lines: pkg.missing })
        break
      }
      case 'decision':
      case 'decision2': {
        const lines = view.approvals.map(
          (a) => `${ctx.roleLabel(a.requiredRole)} · ${APPROVAL_STATUS[a.status] ?? a.status}${a.decidedBy ? ` · ${a.decidedBy} (${a.decidedAt ? ctx.fmtTime(a.decidedAt) : ''})` : ''}${a.comment ? ` — ${a.comment}` : ''}`,
        )
        sections.push({ heading: '승인 요청 기록', lines: lines.length ? lines : ['아직 승인 요청이 없어요.'] })
        if (st === 'blocked') evidence.push({ heading: '아직 결정할 수 없어요', lines: ['앞 단계(재무 취합·계약 담당 확인 등)가 모두 끝나야 해요.'] })
        if (st === 'current' || st === 'blocked' || st === 'todo') {
          evidence.push({ heading: '주 판단기준 — 공헌이익', lines: ctx.primaryEvidence.length ? ctx.primaryEvidence : ['이 안건에는 연결된 인플루언서 성과가 없어요.'] })
          if (ctx.secondaryEvidence.length) evidence.push({ heading: '보조 지표 (부서가 참고로 쓰는 값)', lines: ctx.secondaryEvidence })
          if (ctx.caveats.length) evidence.push({ heading: '주의', lines: ctx.caveats })
        } else {
          sections.push({ heading: '당시 판단 근거 — 공헌이익', lines: ctx.primaryEvidence })
        }
        break
      }
      case 'approval2': {
        const lines = view.approvals
          .filter((a) => (a.kind ?? 'main') !== 'main')
          .map((a) => `${ctx.roleLabel(a.requiredRole)} · ${APPROVAL_STATUS[a.status] ?? a.status}${a.decidedBy ? ` · ${a.decidedBy}` : ''}${a.comment ? ` — ${a.comment}` : ''}`)
        sections.push({ heading: '계약 불연장 통지서 승인 기록', lines: lines.length ? lines : ['아직 보고하지 않았어요.'] })
        break
      }
      case 'task': {
        const t = view.tasks.find((x) => keyOf(x) === b.key)
        if (!t) {
          sections.push({ heading: '작업', lines: [st === 'skipped' ? '이번 결정에서는 만들어지지 않는 작업이에요.' : '결정이 나면 자동으로 만들어져요.'] })
          break
        }
        const done = doneEvent(t.id)
        const lines = [
          `담당: ${t.assigneeRole ?? '미정'} · 상태 ${TASK_STATUS[t.status] ?? t.status}${t.dueDate ? ` · 기한 ${t.dueDate}` : ''}`,
          ...(t.detail.note ? [`참고: ${String(t.detail.note)}`] : []),
          ...(t.detail.warning ? [`주의: ${String(t.detail.warning)}`] : []),
          done ? `완료: ${who(done)}` : '',
        ].filter(Boolean)
        const sec = { heading: t.title, lines }
        if (t.status === 'open') evidence.push(sec)
        else sections.push(sec)
        break
      }
      case 'end':
        sections.push({ heading: '끝', lines: [st === 'done' ? '이 갈래의 일이 모두 끝났어요.' : '아직 끝나지 않았어요.'] })
        break
    }
    out[n.id] = { id: n.id, title: n.label, laneLabel: ctx.laneLabel(n.lane), stateText: STATE_TEXT[st], state: st, evidence, sections }
  }
  return out
}

/** 로그인한 사람의 역할이 맡는 레인 */
export const LANES_OF_ROLE: Record<string, string[]> = {
  marketing_member: ['marketing'], marketing_team: ['marketing'], finance: ['finance'], contract_mgr: ['contract'],
}
