import Link from 'next/link'
import { Card } from '@heroui/react'
import { OriginPill, Pill } from '@/components/bits'
import { DecisionPanel, InfoReplyForm, ResubmitButton, TaskDoneButton } from '@/components/case-actions'
import { FlowExplorer } from '@/components/FlowExplorer'
import { LANES_OF_ROLE, buildNodeDetails } from '@/lib/process/detail'
import { canHandle, currentUser, decidingRole, roleLabels } from '@/lib/app/auth'
import { flowForCaseType } from '@/lib/process/definitions'
import { deriveFlowState } from '@/lib/process/state'
import { makeBrief } from '@/lib/app/brief'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import {
  EVENT_LABEL, FACT_LABEL, TASK_STATUS, TASK_TYPE, ddayText, fmtDateTime, fmtFact, fmtWon,
} from '@/lib/app/format'
import { tryPerformance } from '@/lib/app/queries'
import { EngineError, daysUntil, getCaseView, type EventRow, type CaseView } from '@/lib/engine/engine'
import { buildBriefInput, contractPackage, financePackage } from '@/lib/modules/w02/evidence'
import { CATEGORIES, listSubmissions } from '@/lib/modules/intake/submissions'
import { w02Notes, type W02Ctx } from '@/lib/modules/w02/handlers'
import { EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'
import { loadCaseRows } from '@/lib/app/case-list'
import type { AuthorityDecision } from '@/lib/rules/types'

function eventSummary(e: EventRow): string {
  const d = e.detail as Record<string, unknown>
  switch (e.eventType) {
    case 'created':
      return `${d.title ?? ''}`
    case 'evaluated': {
      const trace = (d.trace as string[] | undefined) ?? []
      return trace.length ? trace[trace.length - 1] : ''
    }
    case 'approval_requested':
      return `${d.requiredLabel ?? ''} 승인 요청${(d.also as string[] | undefined)?.length ? ` · ${(d.also as string[]).join(', ')}` : ''}`
    case 'approval_superseded':
      return `${d.oldRole ? roleLabel(String(d.oldRole)) : ''} 승인 요청이 대체됐어요${d.newRole ? ` → ${roleLabel(String(d.newRole))}` : ' (확인 필요)'}`
    case 'decided':
      return `${d.byRoleLabel} 가 ${d.outcome === 'approved' ? '승인' : d.outcome === 'rejected' ? '부결' : '보류'}${d.comment ? ` — ${d.comment}` : ''}`
    case 'status_changed':
      return `${d.from} → ${d.to}`
    case 'task_created':
      return `${d.title} (담당 ${d.assigneeRole ?? '미정'})`
    case 'task_done':
      return `${d.title}`
    case 'facts_changed': {
      const ch = (d.changed ?? {}) as Record<string, { before: unknown; after: unknown }>
      const parts = Object.entries(ch).map(([k, v]) => `${FACT_LABEL[k] ?? k}: ${fmtFact(k, v.before)} → ${fmtFact(k, v.after)}`)
      return `${d.reason} · ${parts.join(', ')}`
    }
    case 'info_received': {
      const a = (d.answers ?? {}) as Record<string, unknown>
      return Object.entries(a).map(([k, v]) => `${FACT_LABEL[k] ?? k}: ${fmtFact(k, v)}`).join(', ') + ` (${d.origin})`
    }
    case 'resubmitted':
      return `${d.reason}`
    default:
      return ''
  }
}

/** 안건 하나의 업무 흐름표·같이 봐야 할 점·다음 행동·요약·작업·이력. 안건 목록 화면의 아래쪽에서 쓴다. */
export async function CaseDetail({ caseId }: { caseId: number }) {
  const { sql, cfg, cash } = await getEngine()
  let view: CaseView
  try {
    view = await getCaseView(sql, caseId)
  } catch (e) {
    if (e instanceof EngineError) return <p className="t-small">이 안건을 찾을 수 없어요.</p>
    throw e
  }
  const c = view.case
  const perf = await tryPerformance()
  const brief = makeBrief(buildBriefInput(view, { asOf: AS_OF, perf, cash }))
  const notes = w02Notes(c, cfg.ctx as W02Ctx)

  const payload = c.payload as { evaluation?: { decision?: AuthorityDecision; facts?: Record<string, unknown> } }
  const decision = payload.evaluation?.decision
  const pending = view.approvals.find((a) => a.status === 'pending')
  const openInfo = view.tasks.filter((t) => t.taskType === 'info_request' && t.status === 'open')

  // 로그인한 사람이 이 안건에서 무엇을 할 수 있는지 (서버가 동작할 때 한 번 더 확인한다)
  const user = await currentUser(sql)
  const myRoles = roleLabels(user.roles).join(', ')
  const canDecideNow = pending ? decidingRole(user, pending.requiredRole) !== null : false

  // 업무 흐름(BPMN 방식): 선언 + 이 안건의 실제 상태
  const flow = flowForCaseType(c.caseType)
  const flowState = flow ? deriveFlowState(flow, view) : null
  const approverLabel = pending ? roleLabel(pending.requiredRole) : c.authority ? roleLabel(c.authority) : '승인권자'
  const laneLabels = { approver: approverLabel }
  // 내가 맡은 레인: 내 역할의 부서 + (내가 결정할 수 있으면) 승인권자
  const myLanes = [...new Set([...user.roles.flatMap((r) => LANES_OF_ROLE[r] ?? []), ...(canDecideNow ? ['approver'] : [])])]
  // 다음 행동: 지금 이 안건을 처리할 수 있는 부서의 사람에게만 보인다. 나머지는 지금 어느 부서가 처리 중인지만 본다.
  const openTasks = view.tasks.filter((t) => t.status === 'open')
  const gateOpen = openTasks.some((t) => t.detail.gate === 'pre-approval')
  const waiting = (flowState?.current ?? []).map((n) => ({
    lane: n.lane === 'approver' ? approverLabel : flow?.lanes.find((l) => l.id === n.lane)?.label ?? n.lane,
    step: n.label,
  }))
  const myDecision = Boolean(pending) && !gateOpen && canDecideNow
  const myInfo = openInfo.filter((t) => canHandle(user, t.assigneeRole))
  const myTasks = openTasks.filter(
    (t) => t.taskType !== 'info_request' && canHandle(user, t.assigneeRole) && !(t.detail.after && openTasks.some((x) => String(x.detail.key) === String(t.detail.after))),
  )
  const canResubmit = (c.status === 'rejected' || c.status === 'on_hold') && canHandle(user, '마케팅')
  const hasMyAction = myDecision || myInfo.length > 0 || myTasks.length > 0 || canResubmit

  // 같이 봐야 할 점: 같은 인플루언서의 다른 안건 (캠페인 집행일 때) + 승인권자와 그 근거
  const relatedRows =
    c.caseType === EXPANSION_CASE_TYPE && c.subjectRefs.influencer && c.subjectRefs.influencer !== 'NONE'
      ? (await loadCaseRows(sql))
          .filter((r) => r.influencerId === c.subjectRefs.influencer && r.id !== c.id)
          .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))
      : []
  const influencerName = perf?.byInfluencer.find((x) => x.influencerId === c.subjectRefs.influencer)?.influencerName ?? c.subjectRefs.influencer

  const subCalc = (c.payload as { submission?: { calc?: { result: { contributionProfit: number; realRoas: number | null } } } }).submission?.calc
  const primary = [
    ...(subCalc ? [`제출 추계 공헌이익(팀원 입력, 가정): ${fmtWon(subCalc.result.contributionProfit)}${subCalc.result.realRoas === null ? '' : ` · 실질 ROAS ${subCalc.result.realRoas.toFixed(2)}배`}`] : []),
    ...brief.reasons.filter((r) => r.startsWith('실질 공헌이익')),
  ]
  const secondary = brief.reasons.filter((r) => /^(GMV|광고비|배분)/.test(r))
  // 업무 발생 단계: 팀원이 올린 기록(접수 대기 테이블)이 있으면 보여 준다
  const subRef = (c.payload as { submission?: { id?: number } }).submission?.id
  const subRow = subRef ? (await listSubmissions(sql)).find((x) => x.id === subRef) : undefined
  const subCat = subRow ? CATEGORIES.find((x) => x.id === subRow.category) : undefined
  const submission = subRow && subCat
    ? {
        submittedBy: subRow.submittedBy, createdAt: subRow.createdAt, categoryLabel: subCat.label, refId: subRow.refId,
        input: Object.entries(subRow.input).filter(([, v]) => v).map(([k, v]) => ({ label: subCat.fields.find((f) => f.name === k)?.label ?? k, value: v })),
      }
    : null
  const planRef = (c.subjectRefs as Record<string, string>).plan
  const sourceNote = !submission && planRef ? `원본 기안 파일(02_masil/marketing/mkt_budget_plan_ms.csv)의 ${planRef} 에서 가져왔어요. 작성한 팀원 이름은 원본에 없어요.` : null
  const evCtx = { asOf: AS_OF, perf, cash }
  const nodeDetails = flow && flowState
    ? buildNodeDetails(flow, flowState, view, {
        laneLabel: (id) => laneLabels[id as 'approver'] ?? flow.lanes.find((l) => l.id === id)?.label ?? id,
        fmtTime: fmtDateTime,
        roleLabel,
        submission,
        sourceNote,
        finance: financePackage(view, evCtx),
        contract: contractPackage(view, AS_OF),
        primaryEvidence: primary,
        secondaryEvidence: secondary,
        caveats: brief.caveats,
        ruleTrace: decision?.trace ?? [],
      })
    : {}
  const initialNode =
    flowState?.current.find((n) => myLanes.includes(n.lane))?.id ?? flowState?.current[0]?.id ?? 'start'

  return (
    <>
      <div className="flex flex-col gap-3">
        {flow && flowState && (
          <Card>
            <Card.Header>
              <Card.Title>업무 흐름</Card.Title>
              <Card.Description>{flow.description}</Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-4">
              <FlowExplorer def={flow} state={flowState} laneLabels={laneLabels} myLanes={myLanes} details={nodeDetails} uid={`case${c.id}`} initial={initialNode} />
            </Card.Content>
          </Card>
        )}

        {/* 같이 봐야 할 점 */}
        <Card>
          <Card.Header><Card.Title>같이 봐야 할 점</Card.Title></Card.Header>
          <Card.Content className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="t-small font-semibold">승인권자</p>
              {decision?.status === 'decided' && c.authority ? (
                <>
                  <p className="t-small"><strong>{roleLabel(c.authority)}</strong>{decision.also.length ? ` + ${decision.also.join(', ')}` : ''}</p>
                  <p className="t-caption">이렇게 정해진 근거</p>
                  {decision.trace.map((t, i) => <p key={i} className="t-caption">• {t}</p>)}
                  {decision.matched.map((m) => (
                    <p key={m.ruleId} className="t-caption">• 출처: {m.source.file} — {m.source.note} ({m.origin})</p>
                  ))}
                </>
              ) : (
                <>
                  <p className="t-small">
                    <strong className="text-danger">승인권자 확정 필요</strong> — {decision?.status === 'no_rule' ? '적용되는 규칙이 없어 사람이 직접 지정해야 해요.' : '모르는 사실이 있어 아직 정할 수 없어요.'}
                  </p>
                  {(decision?.unresolved ?? []).map((u) => (
                    <p key={u.ruleId} className="t-caption">• {u.title} — 확인할 것: {u.missingFacts.map((f) => FACT_LABEL[f] ?? f).join(', ')} (확인되면 {roleLabel(u.wouldRequire)} 승인이 필요할 수 있어요)</p>
                  ))}
                  {!decision && <p className="t-caption">아직 평가 전이에요.</p>}
                </>
              )}
            </div>
            {notes.length > 0 && (
              <div className="flex flex-col gap-1">
                {notes.map((n) => <p key={n} className="t-small">• {n}</p>)}
              </div>
            )}
            {c.caseType === EXPANSION_CASE_TYPE && (
              <div className="flex flex-col gap-1">
                <p className="t-small font-semibold">같은 인플루언서({influencerName})의 다른 안건 <span className="t-caption">({relatedRows.length}건)</span></p>
                {relatedRows.length === 0 && <p className="t-caption">없음</p>}
                {relatedRows.map((r) => (
                  <Link
                    key={r.id}
                    href={`/cases?id=${r.id}`}
                    scroll={false}
                    className="grid grid-cols-1 gap-x-4 border-b border-default py-1 t-small sm:grid-cols-[7rem_minmax(0,1fr)_9rem_13rem_14rem]"
                  >
                    <span>{r.code || '—'}</span>
                    <span className="font-semibold">{r.title}</span>
                    <span>{r.categoryLabel}</span>
                    <span>{r.deadline ? `기한 ${r.deadline} (${ddayText(daysUntil(r.deadline, AS_OF))})` : '기한 없음'}</span>
                    <span>{r.approverLabel ? `승인권자 ${r.approverLabel}` : <span className="text-danger">승인권자 확정 필요</span>}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card.Content>
        </Card>

        {/* 다음 행동 — 지금 처리할 수 있는 부서의 사람에게만 버튼이 보인다 */}
        <Card>
          <Card.Header>
            <Card.Title>다음 행동</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {waiting.length > 0 && (
              <div className="flex flex-col gap-1">
                {waiting.map((w, i) => <p key={i} className="t-small">지금 <strong>{w.lane}</strong>에서 <strong>{w.step}</strong>을(를) 처리하고 있어요.</p>)}
              </div>
            )}
            {waiting.length === 0 && !hasMyAction && (
              <p className="t-small">{c.status === 'closed' || c.status === 'approved' ? '이 안건의 처리가 끝났어요.' : '지금 처리 중인 단계가 없어요.'}</p>
            )}
            {hasMyAction && waiting.length > 0 && <p className="border-t border-default pt-2 t-caption">내가 처리할 수 있는 일</p>}
            {myDecision && pending && <DecisionPanel approvalId={pending.id} requiredLabel={roleLabel(pending.requiredRole)} allowed myRoles={myRoles} />}
            {myInfo.map((t) => (
              <div key={t.id} className="flex flex-col gap-2 border border-default p-2">
                <div className="flex items-center gap-2">
                  <Pill color="warning">확인 요청</Pill>
                  <span className="t-small font-semibold">{t.title}</span>
                </div>
                <p className="t-small">{String(t.detail.question ?? '')}</p>
                {t.detail.whatIf != null && (
                  <p className="t-caption">
                    참고: 조정이 되면 승인권자가 {String((t.detail.whatIf as { authorityLabel?: string }).authorityLabel ?? '미정')}(으)로 내려갈 수 있어요 (다른 확인이 끝난 경우).
                  </p>
                )}
                <InfoReplyForm taskId={t.id} fields={(t.detail.answerFields as { name: string; type: 'date' | 'boolean' | 'number' | 'text'; label: string }[]) ?? []} allowed assignee={t.assigneeRole ?? '담당 부서'} />
              </div>
            ))}
            {myTasks.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border border-default p-2">
                <span className="flex flex-col">
                  <span className="t-small font-semibold">{t.title}</span>
                  <span className="t-caption">{TASK_TYPE[t.taskType] ?? t.taskType}{t.dueDate ? ` · 기한 ${t.dueDate}` : ''}</span>
                </span>
                <TaskDoneButton taskId={t.id} allowed />
              </div>
            ))}
            {canResubmit && (
              <div className="flex flex-col gap-2">
                <p className="t-small">{c.status === 'rejected' ? '부결된 안건이에요.' : '보류된 안건이에요.'} 조건을 보완했다면 다시 올릴 수 있어요.</p>
                <div><ResubmitButton caseId={c.id} allowed /></div>
              </div>
            )}
          </Card.Content>
        </Card>

        {/* 요약: 규칙 판정과 지표 계산 결과를 그대로 정리 (AI 를 쓰지 않음) */}
        <Card>
          <Card.Header>
            <Card.Title>요약과 근거</Card.Title>
            <Card.Description>규칙 판정과 지표 계산 결과를 그대로 정리했어요. 결정은 사람이 해요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <p className="t-body">{brief.summary}</p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="flex flex-col gap-2">
                <p className="t-small font-semibold">근거</p>
                {brief.reasons.map((r, i) => <p key={i} className="t-small">• {r}</p>)}
              </div>
              <div className="flex flex-col gap-2">
                <p className="t-small font-semibold">고를 수 있는 대안 <span className="t-caption">(문서·규칙에서 나온 후보)</span></p>
                {brief.alternatives.length === 0 && <p className="t-small">없음</p>}
                {brief.alternatives.map((r, i) => <p key={i} className="t-small">• {r}</p>)}
              </div>
              <div className="flex flex-col gap-2">
                <p className="t-small font-semibold">주의</p>
                {brief.caveats.map((r, i) => <p key={i} className="t-small">• {r}</p>)}
              </div>
            </div>
          </Card.Content>
        </Card>

        {/* 작업 */}
        <Card>
          <Card.Header>
            <Card.Title>후속 작업</Card.Title>
            <Card.Description>결정·회신에 따라 자동으로 만들어진 일이에요. 모두 끝나면 승인된 안건은 닫혀요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {view.tasks.length === 0 && <p className="t-small">아직 작업이 없어요.</p>}
            {view.tasks.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-default p-2">
                <div className="flex flex-col gap-1">
                  <span className="t-small font-semibold">{t.title}</span>
                  <span className="t-caption">
                    {TASK_TYPE[t.taskType] ?? t.taskType} · 담당 {t.assigneeRole ?? '미정'}{t.dueDate ? ` · 기한 ${t.dueDate}` : ''}
                    {t.response ? ` · 회신: ${Object.entries((t.response as { answers?: Record<string, unknown> }).answers ?? {}).map(([k, v]) => `${FACT_LABEL[k] ?? k} ${fmtFact(k, v)}`).join(', ')}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <OriginPill origin={t.dataOrigin} />
                  <Pill color={TASK_STATUS[t.status]?.color ?? 'default'}>{TASK_STATUS[t.status]?.label ?? t.status}</Pill>
                </div>
              </div>
            ))}
          </Card.Content>
        </Card>

        {/* 이력: 길어질 수 있어 안쪽으로 스크롤 */}
        <Card>
          <Card.Header>
            <Card.Title>이력</Card.Title>
            <Card.Description>누가 언제 무엇을 했는지 추가만 되고 지워지지 않아요.</Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto border border-default p-2">
              {[...view.events].reverse().map((e) => (
                <div key={e.id} className="flex flex-col gap-0.5 border-b border-default pb-2">
                  <span className="t-small">
                    <strong>{EVENT_LABEL[e.eventType] ?? e.eventType}</strong> <span className="t-caption">· {e.actorKind}{e.actorName ? ` ${e.actorName}` : ''} · {fmtDateTime(e.createdAt)}</span>
                  </span>
                  <span className="t-caption">{eventSummary(e)}</span>
                </div>
              ))}
            </div>
          </Card.Content>
        </Card>
      </div>
    </>
  )
}
