import Link from 'next/link'
import { Warning } from '@phosphor-icons/react/ssr'
import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { Pill } from '@/components/bits'
import { BulkReplyForm, type AnswerFieldView } from '@/components/case-actions'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import { canHandle, currentUser, decidingRole, roleLabels } from '@/lib/app/auth'
import { ddayText } from '@/lib/app/format'
import { CATEGORIES, listSubmissions } from '@/lib/modules/intake/submissions'
import { canAcceptCategory } from '@/lib/app/auth'
import { daysUntil, listOpenTasks, listPendingApprovals } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 28
const URGENT_DAYS = 7
type SortKey = 'deadline' | 'kind' | 'case'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'deadline', label: '마감 임박순' },
  { key: 'kind', label: '종류별' },
  { key: 'case', label: '안건별' },
]

interface TodoItem {
  key: string
  caseId: number | null
  href: string
  caseTitle: string
  kind: '접수' | '승인' | '회신' | '작업'
  title: string
  deadline: string | null
  days: number | null
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const sp = await searchParams
  const sort: SortKey = SORTS.some((x) => x.key === sp.sort) ? (sp.sort as SortKey) : 'deadline'
  const { sql } = await getEngine()
  const user = await currentUser(sql)
  const [approvals, tasks, subs] = await Promise.all([listPendingApprovals(sql), listOpenTasks(sql, 500), listSubmissions(sql, 'pending').catch(() => [])])

  const myApprovals = approvals.filter((a) => decidingRole(user, a.requiredRole) !== null)
  const otherApprovals = approvals.filter((a) => decidingRole(user, a.requiredRole) === null)
  const mine = tasks.filter((t) => canHandle(user, t.assigneeRole))
  const myInfo = mine.filter((t) => t.taskType === 'info_request')

  const mk = (key: string, caseId: number | null, caseTitle: string, kind: TodoItem['kind'], title: string, deadline: string | null, href?: string): TodoItem => ({
    key, caseId, href: href ?? `/cases/${caseId}`, caseTitle, kind, title, deadline, days: deadline ? daysUntil(deadline, AS_OF) : null,
  })
  const toAccept = subs.filter((s) => canAcceptCategory(user, CATEGORIES.find((c) => c.id === s.category)!.acceptRole))
  const all: TodoItem[] = [
    ...toAccept.map((s) => mk(`s${s.id}`, null, s.title, '접수', '접수 필요 — 보고자 ' + s.submittedBy, s.input.contractDeadline || null, '/intake')),
    ...myApprovals.map((a) => mk(`a${a.id}`, a.caseId, a.caseTitle, '승인', `${roleLabel(a.requiredRole)} 승인 결정`, a.deadline)),
    ...mine.map((t) => mk(`t${t.id}`, t.caseId, t.caseTitle, t.taskType === 'info_request' ? '회신' : '작업', t.title, t.dueDate)),
  ]
  // 마감이 4주 이내(이미 지난 것 포함)인 일만 보여 준다
  const items = all.filter((i) => i.days !== null && i.days <= WINDOW_DAYS)
  const noDeadline = all.filter((i) => i.days === null)
  const farAway = all.length - items.length - noDeadline.length
  const KIND_ORDER = { 접수: 0, 승인: 0, 회신: 1, 작업: 2 }
  items.sort((x, y) => {
    if (sort === 'kind') return KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || x.days! - y.days!
    if (sort === 'case') return x.caseTitle.localeCompare(y.caseTitle, 'ko') || x.days! - y.days!
    return x.days! - y.days!
  })

  // 같은 질문(fact)을 하는 확인 요청은 묶어서 보여 주고, 예/아니오 질문이면 한 번에 회신할 수 있게 한다
  const groups = new Map<string, typeof myInfo>()
  for (const t of myInfo) {
    const k = String(t.detail.fact ?? t.title)
    groups.set(k, [...(groups.get(k) ?? []), t])
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-3">
        <PageHeader
          title="할 일"
          description={`${user.name} 님의 역할: ${roleLabels(user.roles).join(', ') || '없음'}. 내가 처리할 수 있는 일 중 마감이 ${WINDOW_DAYS / 7}주 이내인 것만 모아 보여요.`}
        />

        {user.roles.length === 0 && !user.isAdmin && (
          <Card>
            <Card.Content>
              <p className="t-small">아직 역할이 없어요. 관리자에게 역할(예: 재무, 마케팅 팀원, Masil 대표)을 부여해 달라고 요청하세요. 그동안은 안건 화면에서 내용을 볼 수만 있어요.</p>
            </Card.Content>
          </Card>
        )}

        <Card>
          <Card.Header>
            <Card.Title>마감 {WINDOW_DAYS / 7}주 이내 ({items.length}건)</Card.Title>
            <Card.Description>
              <span className="flex flex-wrap items-center gap-2">
                정렬
                {SORTS.map((x) => (
                  <Link key={x.key} href={`/inbox?sort=${x.key}`} className={`rounded-input border px-2 py-0.5 t-caption ${sort === x.key ? 'border-primary bg-primary-soft font-semibold' : 'border-default'}`}>
                    {x.label}
                  </Link>
                ))}
              </span>
            </Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {items.length === 0 && <p className="t-small">마감이 {WINDOW_DAYS / 7}주 이내인 할 일이 없어요.</p>}
            {items.map((i) => {
              const urgent = i.days! <= URGENT_DAYS
              return (
                <Link key={i.key} href={i.href} className={`flex flex-wrap items-center justify-between gap-2 rounded-card border p-2 ${urgent ? 'border-danger' : 'border-default'}`}>
                  <span className="flex items-start gap-2">
                    {urgent && <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-danger" aria-label="마감 1주일 이내" />}
                    <span className="flex flex-col gap-1">
                      <span className="t-small font-semibold">{i.title}</span>
                      <span className="t-caption">{i.caseTitle}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Pill color={i.kind === '승인' || i.kind === '접수' ? 'accent' : i.kind === '회신' ? 'warning' : 'default'}>{i.kind}</Pill>
                    <span className={`t-caption ${urgent ? 'font-semibold text-danger' : ''}`}>{i.deadline} · {ddayText(i.days!)}</span>
                  </span>
                </Link>
              )
            })}
            {(noDeadline.length > 0 || farAway > 0) && (
              <p className="t-caption">
                {farAway > 0 ? `마감이 ${WINDOW_DAYS / 7}주보다 먼 일 ${farAway}건` : ''}{farAway > 0 && noDeadline.length > 0 ? ' · ' : ''}{noDeadline.length > 0 ? `마감이 정해지지 않은 일 ${noDeadline.length}건` : ''}은 이 목록에 넣지 않았어요. 안건 화면에서 볼 수 있어요.
              </p>
            )}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>같은 질문 한 번에 회신 (확인 요청 {myInfo.length}건)</Card.Title>
            <Card.Description>회신하면 안건이 다시 평가돼서 승인권자가 확정되거나 바뀌어요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {myInfo.length === 0 && <p className="t-small">내 부서에 온 확인 요청이 없어요.</p>}
            {[...groups.entries()].map(([fact, list]) => {
              const fields = (list[0].detail.answerFields ?? []) as AnswerFieldView[]
              const bulk = list.length > 1 && fields.length > 0 && fields.every((f) => f.type === 'boolean')
              return (
                <div key={fact} className="flex flex-col gap-3 rounded-card border border-default p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill color="warning">확인 요청</Pill>
                    <span className="t-small font-semibold">{String(list[0].title)}</span>
                    <span className="t-caption">{list.length}건</span>
                  </div>
                  <p className="t-small">{String(list[0].detail.question ?? '')}</p>
                  {bulk && <BulkReplyForm fact={fact} fields={fields} count={list.length} />}
                  <div className="flex flex-col gap-1">
                    {list.map((t) => (
                      <Link key={t.id} href={`/cases/${t.caseId}`} className="t-caption">
                        • {t.caseTitle}{t.dueDate ? ` · 기한 ${t.dueDate}` : ''}
                      </Link>
                    ))}
                  </div>
                  {!bulk && <p className="t-caption">안건을 열어 값을 입력하세요 (안건마다 값이 달라요).</p>}
                </div>
              )
            })}
          </Card.Content>
        </Card>

        {otherApprovals.length > 0 && (
          <Card>
            <Card.Header>
              <Card.Title>다른 사람의 결정을 기다리는 승인 ({otherApprovals.length}건)</Card.Title>
              <Card.Description>내 역할로는 결정할 수 없는 건이에요. 누구의 결정이 필요한지만 보여요.</Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-2">
              {otherApprovals.slice(0, 12).map((a) => (
                <Link key={a.id} href={`/cases/${a.caseId}`} className="t-caption">
                  • {a.caseTitle} — {roleLabel(a.requiredRole)}
                </Link>
              ))}
            </Card.Content>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
