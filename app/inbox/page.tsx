import Link from 'next/link'
import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { OriginPill, Pill } from '@/components/bits'
import { BulkReplyForm, type AnswerFieldView } from '@/components/case-actions'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import { canHandle, currentUser, decidingRole, roleLabels } from '@/lib/app/auth'
import { TASK_TYPE, ddayText } from '@/lib/app/format'
import { daysUntil, listOpenTasks, listPendingApprovals } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const { sql } = await getEngine()
  const user = await currentUser(sql)
  const [approvals, tasks] = await Promise.all([listPendingApprovals(sql), listOpenTasks(sql, 500)])

  const myApprovals = approvals.filter((a) => decidingRole(user, a.requiredRole) !== null)
  const otherApprovals = approvals.filter((a) => decidingRole(user, a.requiredRole) === null)
  const mine = tasks.filter((t) => canHandle(user, t.assigneeRole))
  const myInfo = mine.filter((t) => t.taskType === 'info_request')
  const myWork = mine.filter((t) => t.taskType !== 'info_request')

  // 같은 질문(fact)을 하는 확인 요청은 묶어서 보여 주고, 예/아니오 질문이면 한 번에 회신할 수 있게 한다
  const groups = new Map<string, typeof myInfo>()
  for (const t of myInfo) {
    const k = String(t.detail.fact ?? t.title)
    groups.set(k, [...(groups.get(k) ?? []), t])
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader
          title="할 일"
          description={`${user.name} 님의 역할: ${roleLabels(user.roles).join(', ') || '없음'}. 내 역할로 처리할 수 있는 승인·확인 요청·작업만 모아 보여요.`}
        />

        {user.roles.length === 0 && !user.isAdmin && (
          <Card>
            <Card.Content>
              <p className="t-small">아직 역할이 없어요. 관리자에게 역할(예: 재무, 마케팅팀, Masil 대표)을 부여해 달라고 요청하세요. 그동안은 안건 화면에서 내용을 볼 수만 있어요.</p>
            </Card.Content>
          </Card>
        )}

        <Card>
          <Card.Header>
            <Card.Title>내가 결정할 승인 ({myApprovals.length}건)</Card.Title>
            <Card.Description>마감이 빠른 순서예요. 안건을 열어 근거를 보고 승인·부결·보류를 고르세요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {myApprovals.length === 0 && <p className="t-small">지금 결정할 승인이 없어요.</p>}
            {myApprovals.map((a) => (
              <Link key={a.id} href={`/cases/${a.caseId}`} className="flex flex-col gap-1 rounded-card border border-default p-3">
                <span className="t-small font-semibold">{a.caseTitle}</span>
                <span className="t-caption">{roleLabel(a.requiredRole)} 승인 · {a.deadline ? `마감 ${a.deadline} (${ddayText(daysUntil(a.deadline, AS_OF))})` : '마감 없음'}</span>
              </Link>
            ))}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>내 부서에 온 확인 요청 ({myInfo.length}건)</Card.Title>
            <Card.Description>회신하면 안건이 다시 평가돼서 승인권자가 확정되거나 바뀌어요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-6">
            {myInfo.length === 0 && <p className="t-small">내 부서에 온 확인 요청이 없어요.</p>}
            {[...groups.entries()].map(([fact, list]) => {
              const fields = (list[0].detail.answerFields ?? []) as AnswerFieldView[]
              const bulk = list.length > 1 && fields.length > 0 && fields.every((f) => f.type === 'boolean')
              return (
                <div key={fact} className="flex flex-col gap-3 rounded-card border border-default p-4">
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

        <Card>
          <Card.Header>
            <Card.Title>내 부서의 작업 ({myWork.length}건)</Card.Title>
            <Card.Description>승인·회신 뒤에 자동으로 만들어진 일이에요. 끝내면 안건 화면에서 완료 처리하세요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {myWork.length === 0 && <p className="t-small">내 부서의 열린 작업이 없어요.</p>}
            {myWork.map((t) => (
              <Link key={t.id} href={`/cases/${t.caseId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-default p-3">
                <span className="flex flex-col gap-1">
                  <span className="t-small font-semibold">{t.title}</span>
                  <span className="t-caption">{t.caseTitle}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="t-caption">{TASK_TYPE[t.taskType] ?? t.taskType}{t.dueDate ? ` · 기한 ${t.dueDate}` : ''}</span>
                  <OriginPill origin={t.dataOrigin} />
                </span>
              </Link>
            ))}
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
