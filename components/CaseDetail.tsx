import Link from 'next/link'
import { Card } from '@heroui/react'
import { Pill } from '@/components/bits'
import { DecisionPanel, InfoReplyForm, ResubmitButton, TaskDoneButton } from '@/components/case-actions'
import { ContractReferPanel, FinanceReferItems, type CheckItem } from '@/components/handoff-panels'
import { NumberedList } from '@/components/NumberedList'
import { FlowExplorer } from '@/components/FlowExplorer'
import { listCaseFiles } from '@/lib/modules/w02/handoff'
import { LANES_OF_ROLE } from '@/lib/process/detail'
import { canHandle, currentUser, decidingRole, roleLabels } from '@/lib/app/auth'
import { flowForCaseType } from '@/lib/process/definitions'
import { deriveFlowState } from '@/lib/process/state'
import { makeBrief } from '@/lib/app/brief'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import {
  EVENT_LABEL, FACT_LABEL, TASK_TYPE, ddayText, fmtDateTime, fmtFact, fmtWon,
} from '@/lib/app/format'
import { tryPerformance } from '@/lib/app/queries'
import { EngineError, daysUntil, getCaseView, type EventRow, type CaseView } from '@/lib/engine/engine'
import { buildBriefInput, contractPackage, financePackage } from '@/lib/modules/w02/evidence'
import { ATTACHMENT_KINDS, CUSTOM_KIND, listFiles } from '@/lib/modules/intake/submissions'
import { outflowDate, w02Notes, type W02Ctx } from '@/lib/modules/w02/handlers'
import { beyondGroupFundPeriod, groupFundPeriodEnd } from '@/lib/modules/w02/group-fund'
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
    laneId: n.lane,
    lane: n.lane === 'approver' ? approverLabel : flow?.lanes.find((l) => l.id === n.lane)?.label ?? n.lane,
    step: n.label,
  }))
  // "지금 ○○에서 처리하고 있어요"는 다른 부서 사람에게만 보인다 (처리하는 부서 사람은 아래에서 직접 처리한다)
  const othersWorking = waiting.filter((w) => !myLanes.includes(w.laneId))
  const myDecision = Boolean(pending) && !gateOpen && canDecideNow
  // 300억 배분 검토 대상 여부 확인은 재무팀 회부 패널에서 한 번에 처리한다
  const collectOpen = openTasks.some((t) => String(t.detail.key) === 'collect-performance')
  const myInfo = openInfo.filter((t) => canHandle(user, t.assigneeRole) && !(collectOpen && t.detail.fact === 'linked_to_group_300'))
  const myTasks = openTasks.filter(
    (t) => t.taskType !== 'info_request' && canHandle(user, t.assigneeRole) && !(t.detail.after && openTasks.some((x) => String(x.detail.key) === String(t.detail.after))),
  )
  const financeTask = myTasks.find((t) => String(t.detail.key ?? '') === 'collect-performance')
  const canResubmit = (c.status === 'rejected' || c.status === 'on_hold') && canHandle(user, '마케팅')
  const hasMyAction = Boolean(financeTask) || myDecision || myInfo.length > 0 || myTasks.length > 0 || canResubmit

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
  // 업무 발생 단계: 팀원이 올린 기록(접수 대기 테이블)이 있으면 보여 준다
  const subRef = (c.payload as { submission?: { id?: number } }).submission?.id
  // 팀원이 제출할 때 붙인 서류, 계약 담당이 올린 계약서
  const subFiles = subRef ? await listFiles(sql, subRef) : []
  const caseFiles = await listCaseFiles(sql, c.id)
  const subFileLabel = (f: (typeof subFiles)[number]) => (f.kind === CUSTOM_KIND ? `${f.label ?? '기타'}` : ATTACHMENT_KINDS.find((k) => k.id === f.kind)?.label ?? f.kind)
  const subFileLinks = subFiles.length === 0 ? (
    <p className="t-caption">{subRef ? '제출 때 붙인 첨부가 없어요.' : '원본 기안 파일에서 가져온 안건이라 첨부 파일이 없어요.'}</p>
  ) : (
    <div className="flex flex-col">
      {subFiles.map((f) => (
        <a key={f.id} className="border-b border-default py-1 t-small underline" href={`/api/submission-files/${f.id}`}>
          {subFileLabel(f)} — {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
        </a>
      ))}
    </div>
  )
  const currentLinked300 = ((c.payload as { evaluation?: { facts?: Record<string, unknown> } }).evaluation?.facts ?? {}).linked_to_group_300
  // 300억 배분 집행 기준기간(6개월): 집행 예정일이 이를 넘으면 '대상 아님'이 자동 선택된다 (넘지 않으면 안내 없음)
  const outDate = outflowDate(c)
  const beyondPeriod = beyondGroupFundPeriod(outDate, AS_OF) ? { date: outDate as string, end: groupFundPeriodEnd(AS_OF) } : null
  const lines = (list: string[]) => <>{list.map((l, i) => <p key={i} className="t-small">{l}</p>)}</>
  const financeItems: CheckItem[] = [
    { key: 'files', title: '첨부 파일', body: subFileLinks },
    { key: 'profit', title: '공헌이익', body: lines(primary.length ? primary : ['이 안건에는 연결된 공헌이익 자료가 없어요.']) },
    { key: 'perf', title: '취합한 성과·비용 자료', body: lines(financePackage(view, { asOf: AS_OF, perf, cash }).lines) },
  ]
  const contractItems: CheckItem[] = [
    { key: 'terms', title: '계약 조건·기한', body: lines(contractPackage(view, AS_OF).lines) },
    { key: 'files', title: '제출 때 붙은 서류', body: subFileLinks },
  ]
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
              <FlowExplorer def={flow} state={flowState} laneLabels={laneLabels} myLanes={myLanes} uid={`case${c.id}`} initial={initialNode} />
            </Card.Content>
          </Card>
        )}

        {/* 같이 봐야 할 점 — 서로 다른 내용은 번호로 나누고 들여쓴다 */}
        <Card>
          <Card.Header><Card.Title>같이 봐야 할 점</Card.Title></Card.Header>
          <Card.Content>
            <NumberedList
              items={[
                {
                  key: 'approver',
                  title: '승인권자',
                  body:
                    decision?.status === 'decided' && c.authority ? (
                      <>
                        <p className="t-small"><strong>{roleLabel(c.authority)}</strong>{decision.also.length ? ` + ${decision.also.join(', ')}` : ''}</p>
                        {/* 근거는 적용된 규칙의 이름만 한 줄로 */}
                        {(decision.matched.some((m) => m.authority === c.authority) ? decision.matched.filter((m) => m.authority === c.authority) : decision.matched).map((m) => (
                          <p key={m.ruleId} className="t-caption">{m.title}</p>
                        ))}
                      </>
                    ) : (
                      <>
                        <p className="t-small">
                          <strong className="text-danger">승인권자 확정 필요</strong> — {decision?.status === 'no_rule' ? '적용되는 규칙이 없어 사람이 직접 지정해야 해요.' : '모르는 사실이 있어 아직 정할 수 없어요.'}
                        </p>
                        {(decision?.unresolved ?? []).map((u) => (
                          <p key={u.ruleId} className="t-caption">{u.title} — 확인할 것: {u.missingFacts.map((f) => FACT_LABEL[f] ?? f).join(', ')} (확인되면 {roleLabel(u.wouldRequire)} 승인)</p>
                        ))}
                        {!decision && <p className="t-caption">아직 평가 전이에요.</p>}
                      </>
                    ),
                },
                ...(notes.length > 0
                  ? [{ key: 'notes', title: '일정·기한', body: <>{notes.map((n) => <p key={n} className="t-small">{n}</p>)}</> }]
                  : []),
                ...(c.caseType === EXPANSION_CASE_TYPE
                  ? [
                      {
                        key: 'related',
                        title: <>같은 인플루언서({influencerName})의 다른 안건 <span className="t-caption">({relatedRows.length}건)</span></>,
                        body: (
                          <>
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
                          </>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card.Content>
        </Card>

        {/* 다음 행동 — 지금 처리할 수 있는 부서의 사람에게만 버튼이 보인다 */}
        <Card>
          <Card.Header>
            <Card.Title>다음 행동</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            {waiting.length === 0 && !hasMyAction && (
              <p className="t-small">{c.status === 'closed' || c.status === 'approved' ? '이 안건의 처리가 끝났어요.' : '지금 처리 중인 단계가 없어요.'}</p>
            )}
            {financeTask && (
              <FinanceReferItems
                caseId={c.id}
                items={financeItems}
                current={typeof currentLinked300 === 'boolean' ? currentLinked300 : null}
                beyondPeriod={beyondPeriod}
                start={1}
              />
            )}
            <NumberedList
              start={financeTask ? 3 : 1}
              items={[
                ...othersWorking.map((w, i) => ({
                  key: `wait${i}`,
                  title: <>지금 <strong>{w.lane}</strong>에서 <strong>{w.step}</strong>을(를) 처리하고 있어요.</>,
                })),
                ...(myDecision && pending
                  ? [{ key: 'decide', title: '승인 결정', body: <DecisionPanel approvalId={pending.id} requiredLabel={roleLabel(pending.requiredRole)} allowed myRoles={myRoles} /> }]
                  : []),
                ...myInfo.map((t) => ({
                  key: `info${t.id}`,
                  title: <span className="flex items-center gap-2"><Pill color="warning">확인 요청</Pill>{t.title}</span>,
                  body: (
                    <div className="flex flex-col gap-2 border border-default p-2">
                      <p className="t-small">{String(t.detail.question ?? '')}</p>
                      {t.detail.whatIf != null && (
                        <p className="t-caption">
                          참고: 조정이 되면 승인권자가 {String((t.detail.whatIf as { authorityLabel?: string }).authorityLabel ?? '미정')}(으)로 내려갈 수 있어요 (다른 확인이 끝난 경우).
                        </p>
                      )}
                      <InfoReplyForm taskId={t.id} fields={(t.detail.answerFields as { name: string; type: 'date' | 'boolean' | 'number' | 'text'; label: string }[]) ?? []} allowed assignee={t.assigneeRole ?? '담당 부서'} />
                    </div>
                  ),
                })),
                ...myTasks.filter((t) => String(t.detail.key ?? '') !== 'collect-performance').map((t) => {
                  if (String(t.detail.key ?? '') === 'confirm-terms') {
                    return { key: `task${t.id}`, title: '계약 조건·기한 확인 — 항목마다 확인하고 체크하세요', body: <ContractReferPanel caseId={c.id} items={contractItems} files={caseFiles.filter((f) => f.kind === 'contract')} /> }
                  }
                  return {
                    key: `task${t.id}`,
                    title: t.title,
                    body: (
                      <div className="flex flex-wrap items-center justify-between gap-2 border border-default p-2">
                        <span className="t-caption">{TASK_TYPE[t.taskType] ?? t.taskType}{t.dueDate ? ` · 기한 ${t.dueDate}` : ''}</span>
                        <TaskDoneButton taskId={t.id} allowed />
                      </div>
                    ),
                  }
                }),
                ...(canResubmit
                  ? [{
                      key: 'resubmit',
                      title: c.status === 'rejected' ? '부결된 안건이에요.' : '보류된 안건이에요.',
                      body: (
                        <>
                          <p className="t-small">조건을 보완했다면 다시 올릴 수 있어요.</p>
                          <div><ResubmitButton caseId={c.id} allowed /></div>
                        </>
                      ),
                    }]
                  : []),
              ]}
            />
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
