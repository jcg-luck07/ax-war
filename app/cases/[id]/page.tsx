import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, buttonVariants } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { OriginPill, Pill, StatusPill } from '@/components/bits'
import { DecisionPanel, FactChangeForm, InfoReplyForm, ResubmitButton, TaskDoneButton } from '@/components/case-actions'
import { makeBrief } from '@/lib/app/brief'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import {
  APPROVAL_STATUS, CASE_TYPE, EVENT_LABEL, FACT_LABEL, TASK_STATUS, TASK_TYPE, ddayText, fmtDateTime, fmtFact,
} from '@/lib/app/format'
import { tryPerformance } from '@/lib/app/queries'
import { EngineError, daysUntil, getCaseView, type EventRow, type CaseView } from '@/lib/engine/engine'
import { ROLES } from '@/lib/rules/authority.rules'
import { buildBriefInput } from '@/lib/modules/w02/evidence'
import { w02Notes, type W02Ctx } from '@/lib/modules/w02/handlers'
import { CONTRACT_CASE_TYPE, EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'
import { PO_CASE_TYPE } from '@/lib/modules/w01/handlers'
import type { AuthorityDecision } from '@/lib/rules/types'

export const dynamic = 'force-dynamic'

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

function changeFormFor(view: CaseView) {
  const c = view.case
  if (c.caseType === CONTRACT_CASE_TYPE) {
    return { fact: 'annual_contract_value_krw', label: '전속계약 연 고정 피 (억 원 단위)', placeholder: '예: 20  (현재 28)', unit: 100_000_000, hint: '혜인 측이 조건을 바꿔 제안했다고 가정하고 값을 넣어 보세요. 10억 원 선을 넘나들면 승인권자가 바뀌어요.' }
  }
  if (c.caseType === EXPANSION_CASE_TYPE) {
    return { fact: 'settlement_date', label: '집행 예정일 (YYYY-MM-DD)', placeholder: '예: 2026-08-24', unit: 1, hint: '집행 시기를 옮기면 현금 하회 구간과의 관계가 달라져 승인권자가 바뀔 수 있어요.' }
  }
  if (c.caseType === PO_CASE_TYPE) {
    return { fact: 'payment_due_date', label: '대금 지급 예정일 (YYYY-MM-DD)', placeholder: '예: 2026-09-15', unit: 1, hint: undefined }
  }
  return null
}

export default async function CaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caseId = Number(id)
  if (!Number.isInteger(caseId)) notFound()
  const { sql, cfg, cash } = await getEngine()
  let view: CaseView
  try {
    view = await getCaseView(sql, caseId)
  } catch (e) {
    if (e instanceof EngineError) notFound()
    throw e
  }
  const c = view.case
  const perf = await tryPerformance()
  const brief = makeBrief(buildBriefInput(view, { asOf: AS_OF, perf, cash }))
  const notes = w02Notes(c, cfg.ctx as W02Ctx)

  const payload = c.payload as { evaluation?: { decision?: AuthorityDecision; facts?: Record<string, unknown> } }
  const decision = payload.evaluation?.decision
  const facts = payload.evaluation?.facts ?? {}
  const pending = view.approvals.find((a) => a.status === 'pending')
  const openInfo = view.tasks.filter((t) => t.taskType === 'info_request' && t.status === 'open')
  const days = daysUntil(c.deadline, AS_OF)
  const isFinal = ['approved', 'rejected', 'closed'].includes(c.status)
  const change = !isFinal ? changeFormFor(view) : null
  const roles = [...ROLES].sort((a, b) => a.rank - b.rank).map((r) => ({ id: r.id, label: r.label }))

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader
          title={c.title}
          description={`${CASE_TYPE[c.caseType] ?? c.caseType} · 안건 #${c.id}`}
          actions={
            <Link className={buttonVariants({ variant: 'outline' })} href="/cases">
              목록으로
            </Link>
          }
        />

        {/* 한눈에 */}
        <Card>
          <Card.Content className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <span className="flex items-center gap-2"><span className="t-caption">상태</span><StatusPill status={c.status} /></span>
            <span className="t-small">승인권자 <strong>{c.authority ? roleLabel(c.authority) : '미정'}</strong>{decision?.also.length ? ` + ${decision.also.join(', ')}` : ''}</span>
            <span className="t-small">마감 <strong>{c.deadline ?? '없음'}</strong>{c.deadline ? ` (${ddayText(days)})` : ''}</span>
            <span className="flex items-center gap-2"><span className="t-caption">데이터</span><OriginPill origin={c.dataOrigin} /></span>
          </Card.Content>
        </Card>

        {notes.length > 0 && (
          <Card>
            <Card.Header><Card.Title>이 안건에서 같이 봐야 할 점</Card.Title></Card.Header>
            <Card.Content className="flex flex-col gap-2">
              {notes.map((n) => <p key={n} className="t-small">• {n}</p>)}
            </Card.Content>
          </Card>
        )}

        {/* 다음 행동 */}
        <Card>
          <Card.Header>
            <Card.Title>다음 행동</Card.Title>
            <Card.Description>사람이 결정하거나 모르는 사실을 채우면, 시스템이 다시 평가하고 후속 작업을 만들어요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-8">
            {pending && <DecisionPanel approvalId={pending.id} requiredLabel={roleLabel(pending.requiredRole)} roles={roles} />}
            {openInfo.map((t) => (
              <div key={t.id} className="flex flex-col gap-2 rounded-card border border-default p-4">
                <div className="flex items-center gap-2">
                  <Pill color="warning">확인 요청</Pill>
                  <span className="t-small font-semibold">{t.title}</span>
                </div>
                <p className="t-small">담당 {t.assigneeRole ?? '미정'} · {String(t.detail.question ?? '')}</p>
                {t.detail.whatIf != null && (
                  <p className="t-caption">
                    참고: 조정이 되면 승인권자가 {String((t.detail.whatIf as { authorityLabel?: string }).authorityLabel ?? '미정')}(으)로 내려갈 수 있어요 (다른 확인이 끝난 경우).
                  </p>
                )}
                <InfoReplyForm taskId={t.id} fields={(t.detail.answerFields as { name: string; type: 'date' | 'boolean' | 'number' | 'text'; label: string }[]) ?? []} byDefault={`${t.assigneeRole ?? '담당자'}(모의)`} />
              </div>
            ))}
            {(c.status === 'rejected' || c.status === 'on_hold') && (
              <div className="flex flex-col gap-2">
                <p className="t-small">{c.status === 'rejected' ? '부결된 안건이에요.' : '보류된 안건이에요.'} 조건을 보완했다면 다시 올릴 수 있어요.</p>
                <div><ResubmitButton caseId={c.id} /></div>
              </div>
            )}
            {!pending && openInfo.length === 0 && c.status !== 'rejected' && c.status !== 'on_hold' && (
              <p className="t-small">지금 사람이 할 결정이 없어요. 아래 작업을 처리해 주세요.</p>
            )}
            {change && (
              <div className="flex flex-col gap-2 border-t border-default pt-6">
                <p className="t-small font-semibold">조건이 바뀌었나요? (조건 변경 시연)</p>
                <FactChangeForm caseId={c.id} fact={change.fact} label={change.label} placeholder={change.placeholder} unitMultiplier={change.unit} hint={change.hint} />
              </div>
            )}
          </Card.Content>
        </Card>

        {/* 판단 근거 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <Card.Header>
              <Card.Title>규칙집이 이렇게 판단했어요</Card.Title>
              <Card.Description>코드가 계산한 값이에요.</Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-2">
              {decision?.trace.map((t, i) => <p key={i} className="t-small">{t}</p>) ?? <p className="t-small">아직 평가 전이에요.</p>}
              {decision?.matched.map((m) => (
                <p key={m.ruleId} className="t-caption">
                  근거: {m.source.file} — {m.source.note} ({m.origin})
                </p>
              ))}
            </Card.Content>
          </Card>
          <Card>
            <Card.Header>
              <Card.Title>판단에 쓰인 사실</Card.Title>
              <Card.Description>&lsquo;모름&rsquo;은 0이나 아니오로 바꾸지 않고 확인 요청으로 처리해요.</Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-2">
              {Object.entries(facts).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-b border-default pb-2">
                  <span className="t-caption">{FACT_LABEL[k] ?? k}</span>
                  <span className="t-small text-right">{fmtFact(k, v)}</span>
                </div>
              ))}
            </Card.Content>
          </Card>
        </div>

        {/* 요약: 규칙 판정과 지표 계산 결과를 그대로 정리 (AI 를 쓰지 않음) */}
        <Card>
          <Card.Header>
            <Card.Title>요약과 근거</Card.Title>
            <Card.Description>규칙 판정과 지표 계산 결과를 그대로 정리했어요. 결정은 사람이 해요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <p className="t-body">{brief.summary}</p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-default p-3">
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
                  {t.status === 'open' && t.taskType !== 'info_request' && <TaskDoneButton taskId={t.id} />}
                </div>
              </div>
            ))}
          </Card.Content>
        </Card>

        {/* 승인 요청 이력 + 이력 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <Card.Header><Card.Title>승인 요청</Card.Title></Card.Header>
            <Card.Content className="flex flex-col gap-3">
              {view.approvals.length === 0 && <p className="t-small">없음</p>}
              {view.approvals.map((a) => (
                <div key={a.id} className="flex flex-col gap-1 rounded-card border border-default p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="t-small font-semibold">{roleLabel(a.requiredRole)}</span>
                    <Pill color={APPROVAL_STATUS[a.status]?.color ?? 'default'}>{APPROVAL_STATUS[a.status]?.label ?? a.status}</Pill>
                  </div>
                  {a.decidedBy && <span className="t-caption">{a.decidedBy} · {a.decidedAt ? fmtDateTime(a.decidedAt) : ''}</span>}
                  {a.comment && <span className="t-caption">{a.comment}</span>}
                </div>
              ))}
            </Card.Content>
          </Card>
          <Card>
            <Card.Header>
              <Card.Title>이력</Card.Title>
              <Card.Description>누가 언제 무엇을 했는지 추가만 되고 지워지지 않아요.</Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-2">
              {[...view.events].reverse().map((e) => (
                <div key={e.id} className="flex flex-col gap-0.5 border-b border-default pb-2">
                  <span className="t-small">
                    <strong>{EVENT_LABEL[e.eventType] ?? e.eventType}</strong> <span className="t-caption">· {e.actorKind}{e.actorName ? ` ${e.actorName}` : ''} · {fmtDateTime(e.createdAt)}</span>
                  </span>
                  <span className="t-caption">{eventSummary(e)}</span>
                </div>
              ))}
            </Card.Content>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
