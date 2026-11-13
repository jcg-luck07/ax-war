import Link from 'next/link'
import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { CaseDetail } from '@/components/CaseDetail'
import { CaseTable } from '@/components/CaseTable'
import { PageHeader } from '@/components/ax'
import { PendingSection } from '@/components/PendingSection'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import { canHandle, currentUser, roleLabels } from '@/lib/app/auth'
import { loadCaseRows, loadDraftRows, type CaseRow } from '@/lib/app/case-list'
import { assignDrafts } from '@/lib/app/drafts'
import { renewalAlerts, RENEWAL_WINDOW_DAYS } from '@/lib/app/renewal-alerts'
import { ddayText, deadlineAlertClass, fmtWon } from '@/lib/app/format'
import { CATEGORIES, listSubmissions } from '@/lib/modules/intake/submissions'
import { daysUntil, listOpenTasks, listPendingApprovals } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 28

// 안건 목록과 같은 열 (+ 내가 할 일). 이 화면의 표는 정렬 없이 마감이 빠른 순으로만 보여 준다.
const COLUMNS: { key: string; label: string; width: number; align?: 'right' }[] = [
  { key: 'code', label: '분류코드', width: 110 },
  { key: 'title', label: '안건', width: 300 },
  { key: 'todo', label: '내가 할 일', width: 220 },
  { key: 'draft', label: '속한 기안서', width: 220 },
  { key: 'type', label: '종류', width: 130 },
  { key: 'amount', label: '요청금액', width: 150, align: 'right' },
  { key: 'state', label: '상태', width: 190 },
  { key: 'settle', label: '지급 예정일', width: 120 },
  { key: 'deadline', label: '계약 체결 기한', width: 170 },
]

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { sql } = await getEngine()
  await assignDrafts(sql)
  const user = await currentUser(sql)
  const [approvals, tasks, subs, all] = await Promise.all([listPendingApprovals(sql), listOpenTasks(sql, 500), listSubmissions(sql, 'pending').catch(() => []), loadCaseRows(sql)])
  const drafts = await loadDraftRows(sql, all)
  // 자동 갱신 도래 알림은 마케팅팀(팀원·팀장)에게만 보여 준다
  const isMarketing = user.authenticated && (user.isAdmin || user.roles.some((r) => r === 'marketing_member' || r === 'marketing_team'))
  const renewals = isMarketing ? await renewalAlerts(sql, all) : []
  const draftName = new Map(drafts.map((d) => [d.id, d.name]))

  // 내가 처리할 일: "내 역할의 소관이고, 지금 내 차례인 것"만.
  //  · 승인은 그 승인을 맡은 역할 본인에게만, 승인 전에 끝나야 하는 앞 단계(재무 취합·계약 확인 등)가 열려 있으면 아직 결정할 차례가 아니다
  //  · 앞 작업이 끝나야 하는 작업(detail.after)도 아직 내 차례가 아니다
  const openByCase = new Map<number, typeof tasks>()
  for (const t of tasks) openByCase.set(t.caseId, [...(openByCase.get(t.caseId) ?? []), t])
  const gateTasksOf = (caseId: number) => (openByCase.get(caseId) ?? []).filter((t) => t.detail.gate === 'pre-approval')
  const isMyApproval = (requiredRole: string) => user.authenticated && user.roles.includes(requiredRole)
  const myApprovals = approvals.filter((a) => isMyApproval(a.requiredRole) && gateTasksOf(a.caseId).length === 0)
  const myTurn = (t: (typeof tasks)[number]) => !(t.detail.after && (openByCase.get(t.caseId) ?? []).some((x) => String(x.detail.key) === String(t.detail.after)))
  const mine = tasks.filter((t) => canHandle(user, t.assigneeRole) && myTurn(t))
  const toAccept = subs.filter((s) => user.authenticated && user.roles.includes(CATEGORIES.find((c) => c.id === s.category)!.acceptRole))

  // 안건마다 내가 할 일을 모은다
  const todoOf = new Map<number, string[]>()
  const add = (caseId: number, text: string) => todoOf.set(caseId, [...(todoOf.get(caseId) ?? []), text])
  for (const a of myApprovals) add(a.caseId, `${roleLabel(a.requiredRole)} 승인 결정`)
  for (const t of mine) add(t.caseId, t.title)

  const byId = new Map(all.map((r) => [r.id, r]))
  const mineRows = [...todoOf.keys()].map((id) => byId.get(id)).filter((r): r is CaseRow => !!r)
  const daysOf = (r: CaseRow) => (r.deadline ? daysUntil(r.deadline, AS_OF) : null)
  // 마감이 빠른 순 (마감일이 없는 안건은 맨 아래)
  mineRows.sort((a, b) => (daysOf(a) ?? 1e9) - (daysOf(b) ?? 1e9) || a.id - b.id)
  const soon = mineRows.filter((r) => daysOf(r) !== null && daysOf(r)! <= WINDOW_DAYS)

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, v)
    return p.toString() ? `/inbox?${p.toString()}` : '/inbox'
  }
  const selected = sp.id && Number.isInteger(Number(sp.id)) && todoOf.has(Number(sp.id)) ? byId.get(Number(sp.id)) : undefined

  const tableOf = (list: CaseRow[], storageKey: string, emptyText: string) => (
    <CaseTable
      storageKey={storageKey}
      plainHeader
      columns={COLUMNS.map((c) => ({ key: c.key, label: c.label, align: c.align, sortHref: '', defaultWidth: c.width }))}
      rows={list.map((r) => ({
        id: r.id,
        href: qs({ id: String(r.id) }),
        selected: selected?.id === r.id,
        cellClass: { deadline: deadlineAlertClass(daysOf(r)) },
        cells: {
          code: r.code || '—',
          title: r.title,
          todo: (todoOf.get(r.id) ?? []).join(' · '),
          draft: r.draftId !== null ? draftName.get(r.draftId) ?? '—' : '—',
          type: r.categoryLabel,
          amount: r.amount === null ? '—' : fmtWon(r.amount),
          state: r.state,
          settle: r.settlementDate ?? '—',
          deadline: r.deadline ? `${r.deadline} (${ddayText(daysOf(r)!)})` : '—',
        },
      }))}
      emptyText={emptyText}
    />
  )
  const toCases = (
    <div className="px-3 py-2">
      <Link href="/cases" className="inline-flex items-center border border-default px-3 py-1 t-small hover:bg-surface" style={{ borderRadius: 2 }}>안건 목록으로 이동하기</Link>
    </div>
  )

  return (
    <AppShell>
      <div className="flex flex-col gap-3">
        <PageHeader title="할 일" description="내 역할로 지금 처리할 수 있는 안건을 모아 보여 줘요. 안건을 누르면 아래에 안건 목록과 같은 업무 흐름표와 다음 행동이 나와서, 여기서 바로 처리할 수 있어요." />

        {user.roles.length === 0 && !user.isAdmin && (
          <Card>
            <Card.Content>
              <p className="t-small">아직 역할이 없어요. 관리자에게 역할(예: 재무, 마케팅 팀원, Masil 대표)을 부여해 달라고 요청하세요. 그동안은 안건 화면에서 내용을 볼 수만 있어요.</p>
            </Card.Content>
          </Card>
        )}

        {/* 인사 */}
        <div className="border border-default px-3 py-3" style={{ borderRadius: 2 }}>
          <p className="t-caption">{roleLabels(user.roles).join(' · ') || '역할 없음'}</p>
          <p className="t-small mt-1">안녕하세요 {user.name}님</p>
          <p className="t-small mt-1">
            처리해야 할 안건이 <b>{mineRows.length}건</b> 있어요. 그중 마감일이 {WINDOW_DAYS / 7}주 이내인 안건이{' '}
            <b className={soon.length > 0 ? 'text-danger' : ''}>{soon.length}건</b>이에요.
          </p>
          {isMarketing && (
            <p className="t-small mt-1">
              자동 갱신 시기가 {RENEWAL_WINDOW_DAYS / 7}주 이내로 다가온 인플루언서가 <b className={renewals.length > 0 ? 'text-danger' : ''}>{renewals.length}명</b> 있어요.
            </p>
          )}
          {toAccept.length > 0 && (
            <p className="t-caption mt-1">
              이 밖에 접수해야 할 기안이 {toAccept.length}건 있어요. <Link href="/intake" className="underline">기안 접수에서 보기</Link>
            </p>
          )}
        </div>

        {/* 자동 갱신 도래 알림 (마케팅팀): 통보 기한을 넘기면 동일 조건으로 자동 갱신되는 전속계약 */}
        {isMarketing && renewals.length > 0 && (
          <div className="border border-default" style={{ borderRadius: 2 }}>
            <div className="px-3 py-1.5">
              <span className="t-small font-semibold text-danger">자동 갱신 도래 알림 {renewals.length}명</span>{' '}
              <span className="t-caption">통보 기한({RENEWAL_WINDOW_DAYS / 7}주 이내, 지난 것 포함)까지 해지·조건 변경을 알리지 않으면 동일 조건으로 1년 자동 갱신돼요.</span>
            </div>
            <ul className="flex flex-col border-t border-default">
              {renewals.map((a) => (
                <li key={a.caseId} className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-3 py-1.5 last:border-b-0">
                  <span className="flex min-w-0 flex-col">
                    <span className="t-small font-semibold">{a.title}</span>
                    <span className="t-caption">
                      현 계약 만료일 {a.currentExpiry ?? '—'} · {a.autoRenew ? '자동 갱신 계약' : '자동 갱신 여부 미확인'} · 안건 상태: {a.state}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={`t-small ${a.days <= 7 ? 'font-semibold text-danger' : ''}`}>통보 기한 {a.noticeDeadline} ({ddayText(a.days)})</span>
                    <Link href={`/cases?id=${a.caseId}`} className="border border-default px-2 py-0.5 t-caption hover:bg-surface" style={{ borderRadius: 2 }}>안건 열기</Link>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 1) 마감 4주 이내 안건 */}
        <div className="border border-default" style={{ borderRadius: 2 }}>
          <div className="px-3 py-1.5">
            <span className="t-small font-semibold">마감 {WINDOW_DAYS / 7}주 이내 안건 {soon.length}건 <span className="t-caption">(계약 체결 기한이 이미 지난 안건 포함 · 마감이 빠른 순)</span></span>
          </div>
          {tableOf(soon, 'inbox-soon-widths-v1', `마감이 ${WINDOW_DAYS / 7}주 이내인 안건이 없어요.`)}
          {toCases}
        </div>

        {/* 2) 아직 확정이 안 된 안건 (후보) */}
        <PendingSection sql={sql} user={user} all={all} drafts={drafts} group={sp.pgroup} pid={sp.pid} qs={qs} />

        {/* 3) 내가 처리할 전체 안건 (4주 이내 포함) */}
        <div className="border border-default" style={{ borderRadius: 2 }}>
          <div className="px-3 py-1.5">
            <span className="t-small font-semibold">내가 처리할 전체 안건 {mineRows.length}건 <span className="t-caption">(내 역할로 지금 진행할 단계에 있는 안건 · 마감 {WINDOW_DAYS / 7}주 이내 포함)</span></span>
          </div>
          {tableOf(mineRows, 'inbox-all-widths-v1', '지금 내가 처리할 안건이 없어요.')}
          {toCases}
        </div>

        {/* 4) 업무 흐름표·다음 행동: 위 표에서 안건을 고르면 안건 목록과 같은 창이 여기에 나온다 */}
        {selected ? (
          <CaseDetail key={selected.id} caseId={selected.id} />
        ) : (
          <Card>
            <Card.Header>
              <Card.Title>업무 흐름 · 다음 행동</Card.Title>
            </Card.Header>
            <Card.Content>
              <div className="flex min-h-48 items-center justify-center border border-dashed border-default">
                <p className="t-small text-muted">위 표에서 안건을 누르면 업무 흐름표와 다음 행동이 여기에 나와요.</p>
              </div>
            </Card.Content>
          </Card>
        )}

      </div>
    </AppShell>
  )
}
