import Link from 'next/link'
import { Card, buttonVariants } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader, StatCard } from '@/components/ax'
import { StatusPill } from '@/components/bits'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import { ddayText, fmtWon, TASK_TYPE } from '@/lib/app/format'
import { loadSummary } from '@/lib/app/queries'
import { daysUntil } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic' // 매 요청마다 DB 상태를 읽는다 (빌드 때 DB 없이 미리 그리지 않음)

export default async function Home() {
  const { sql, cash } = await getEngine()
  const s = await loadSummary(sql, AS_OF)

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader
          title="의사결정 도우미"
          description={`기준일 ${AS_OF} · 부서마다 다른 숫자를 하나의 기준으로 모아, 권한에 맞는 사람에게 올리고 결정 뒤의 일까지 이어 줍니다.`}
          actions={
            <Link className={buttonVariants({ variant: 'outline' })} href="/inbox">
              내 할 일
            </Link>
          }
        />

        {s.total === 0 ? (
          <Card>
            <Card.Header>
              <Card.Title>아직 안건이 없어요</Card.Title>
              <Card.Description>안건 접수에서 캠페인 확대 기안을 접수하거나 전속계약 갱신 통보를 입력하면 판단이 시작돼요.</Card.Description>
            </Card.Header>
            <Card.Content>
              <Link className={buttonVariants()} href="/intake">
                안건 접수하러 가기
              </Link>
            </Card.Content>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Link href="/cases?status=pending_approval">
                <StatCard label="승인 대기" value={`${s.pending}건`} sub="권한 있는 사람의 결정을 기다려요" />
              </Link>
              <Link href="/cases?status=need_info">
                <StatCard label="확인 필요" value={`${s.needInfo}건`} sub="모르는 사실이 있어 멈춰 있어요" />
              </Link>
              <Link href="/cases">
                <StatCard label="마감 임박 (3주 이내)" value={`${s.soonCount}건`} sub="기한을 넘기면 되돌릴 수 없는 건 포함" />
              </Link>
              <Link href="/cases?status=approved">
                <StatCard label="승인 완료" value={`${s.approved}건`} sub="후속 작업까지 이어졌어요" />
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <Card.Header>
                  <Card.Title>내가 처리할 승인</Card.Title>
                  <Card.Description>마감이 빠른 순서예요.</Card.Description>
                </Card.Header>
                <Card.Content className="flex flex-col gap-3">
                  {s.approvals.length === 0 && <p className="t-small">처리할 승인이 없어요.</p>}
                  {s.approvals.map((a) => (
                    <Link key={a.id} href={`/cases/${a.caseId}`} className="flex flex-col gap-1 rounded-card border border-default p-3">
                      <span className="t-small font-semibold">{a.caseTitle}</span>
                      <span className="t-caption">
                        {roleLabel(a.requiredRole)} 승인 · {a.deadline ? `마감 ${a.deadline} (${ddayText(daysUntil(a.deadline, AS_OF))})` : '마감 없음'}
                      </span>
                    </Link>
                  ))}
                </Card.Content>
              </Card>

              <Card>
                <Card.Header>
                  <Card.Title>열린 작업</Card.Title>
                  <Card.Description>결정과 회신 뒤에 자동으로 생긴 일이에요.</Card.Description>
                </Card.Header>
                <Card.Content className="flex flex-col gap-3">
                  {s.tasks.length === 0 && <p className="t-small">열린 작업이 없어요.</p>}
                  {s.tasks.map((t) => (
                    <Link key={t.id} href={`/cases/${t.caseId}`} className="flex flex-col gap-1 rounded-card border border-default p-3">
                      <span className="t-small font-semibold">{t.title}</span>
                      <span className="t-caption">{t.caseTitle}</span>
                      <span className="t-caption">
                        {TASK_TYPE[t.taskType] ?? t.taskType} · 담당 {t.assigneeRole ?? '미정'}
                        {t.dueDate ? ` · 기한 ${t.dueDate}` : ''}
                      </span>
                    </Link>
                  ))}
                </Card.Content>
              </Card>
            </div>

            <Card>
              <Card.Header>
                <Card.Title>마감이 가까운 안건</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-3">
                {s.soon.map((c) => (
                  <Link key={c.id} href={`/cases/${c.id}`} className="flex items-center justify-between gap-3 rounded-card border border-default p-3">
                    <span className="t-small">{c.title}</span>
                    <span className="flex items-center gap-2">
                      <span className="t-caption">{ddayText(daysUntil(c.deadline, AS_OF))}</span>
                      <StatusPill status={c.status} />
                    </span>
                  </Link>
                ))}
              </Card.Content>
            </Card>
          </>
        )}

        {cash && (
          <Card>
            <Card.Header>
              <Card.Title>현금 하회 예상</Card.Title>
              <Card.Description>
                확정된 회수·지급 일정만 합산한 재전망이에요. 최소현금 30억 원 아래로 내려가는 구간에 돈이 나가는 약정은 금액이 작아도 그룹 CEO 승인이 필요해져요.
              </Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <span className="t-small">첫 하회일 <strong>{cash.firstBreach ?? '없음'}</strong></span>
              <span className="t-small">구간 <strong>{cash.windows.map((w) => `${w.start} ~ ${w.end}`).join(', ') || '없음'}</strong></span>
              <span className="t-small">최저 잔액 <strong>{fmtWon(cash.minBalance)}</strong> ({cash.minDate})</span>
              <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/cash">
                자세히 보기
              </Link>
            </Card.Content>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
