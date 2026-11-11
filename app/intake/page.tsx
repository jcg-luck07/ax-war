import Link from 'next/link'
import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { Pill } from '@/components/bits'
import { ImportPlansButton } from '@/components/case-actions'
import { AcceptReview, SubmitForm, type CategoryView, type ReviewSection } from '@/components/intake-forms'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import { canAcceptCategory, canSubmitCategory, currentUser } from '@/lib/app/auth'
import { ddayText, fmtDateTime, fmtWon } from '@/lib/app/format'
import { daysUntil } from '@/lib/engine/engine'
import { calcContribution } from '@/lib/metrics/contribution-calc'
import { dateInBreachWindow } from '@/lib/modules/cash/simulate'
import { pendingExpansionPlans } from '@/lib/modules/w02/intake'
import {
  ATTACHMENT_KINDS, CATEGORIES, CUSTOM_KIND, fileCheckId, checksFor, contributionFromInput, findOpenCasesFor, listFiles, listSubmissions, categoryById,
} from '@/lib/modules/intake/submissions'
import { MASIL_MODEL } from '@/lib/semantic/model'
import { entityRows } from '@/lib/semantic/run'

export const dynamic = 'force-dynamic'

const STATUS = { pending: { label: '접수 대기', color: 'warning' }, accepted: { label: '접수됨', color: 'success' }, returned: { label: '반려', color: 'danger' } } as const

export default async function IntakePage({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string }> }) {
  const sp = await searchParams
  const { sql, cash } = await getEngine()
  const user = await currentUser(sql)
  const canAccept = canAcceptCategory(user, 'marketing_team')
  const tab = sp.tab === 'accept' && canAccept ? 'accept' : 'submit'

  const [infl, camp, subs] = await Promise.all([
    entityRows(sql, MASIL_MODEL, 'influencer').catch(() => []),
    entityRows(sql, MASIL_MODEL, 'campaign').catch(() => []),
    listSubmissions(sql),
  ])
  const nameOf = new Map<string, string>([
    ...infl.map((i) => [String(i.influencer_id), String(i.influencer_name)] as [string, string]),
    ...camp.map((c) => [String(c.campaign_id), String(c.campaign_name)] as [string, string]),
  ])
  const options: Record<string, { id: string; label: string }[]> = {
    influencer: infl.map((i) => ({ id: String(i.influencer_id), label: `${i.influencer_id} ${i.influencer_name}` })),
    campaign: camp.map((c) => ({ id: String(c.campaign_id), label: `${c.campaign_id} ${c.campaign_name}` })),
  }
  // 신규 ID 제안: 원본 + 이미 제출된 신규 ID 중 가장 큰 번호의 다음 번호
  const nextOf = (prefix: string, width: number, ids: string[]) => {
    const used = [...ids, ...subs.filter((x) => x.input.isNewRef === '1').map((x) => x.refId)]
    const max = used.filter((x) => x.startsWith(prefix)).map((x) => Number(x.slice(prefix.length))).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0)
    return `${prefix}${String(max + 1).padStart(width, '0')}`
  }
  const categories: CategoryView[] = CATEGORIES.map((c) => ({
    id: c.id, label: c.label, refLabel: c.refLabel, idRule: c.idRule,
    allowed: canSubmitCategory(user, c.submitRoles, c.acceptRole), acceptLabel: roleLabel(c.acceptRole),
    fields: c.fields, options: options[c.id] ?? [],
    nextId: c.id === 'influencer' ? nextOf('INF-', 3, infl.map((i) => String(i.influencer_id))) : nextOf('CMP-', 4, camp.map((x) => String(x.campaign_id))),
    parents: options.influencer ?? [],
    idPrefix: c.id === 'influencer' ? 'INF-' : 'CMP-',
    idDigits: c.id === 'influencer' ? 3 : 4,
  }))

  const waiting = subs.filter((s) => s.status === 'pending' && canAcceptCategory(user, categoryById(s.category)!.acceptRole))
  const mine = subs.filter((s) => s.submittedBy === user.name).slice(0, 12)

  const tabLink = (key: string, label: string, count?: number) => (
    <Link
      key={key}
      href={`/intake?tab=${key}`}
      className={`border border-default px-3 py-1.5 t-small ${tab === key ? 'border-primary bg-primary-soft font-semibold' : ''}`}
      style={{ borderRadius: 2 }}
    >
      {label}{count ? ` (${count})` : ''}
    </Link>
  )

  return (
    <AppShell>
      <div className="flex flex-col gap-3">
        <PageHeader title="기안 접수" description="안건 제출(팀원)과 기안 접수(팀장)를 한 곳에서 해요. 팀원들이 서류와 함께 안건을 제출하면 팀장에게 보고되고, 팀장이 안건들을 하나의 기안으로 모아 체크리스트를 확인한 뒤 재무팀에 회부해요." />
        <div className="flex gap-1">
          {tabLink('submit', '안건 제출')}
          {canAccept && tabLink('accept', '기안 접수', subs.filter((s) => s.status === 'pending').length)}
        </div>

        {tab === 'submit' && (
          <>
            <Card>
              <Card.Header>
                <Card.Title>안건 제출</Card.Title>
                <Card.Description>안건 종류를 고르면 첨부서류와 입력칸이 나와요. 모두 채워야 팀장에게 보고할 수 있어요.</Card.Description>
              </Card.Header>
              <Card.Content>
                {user.roles.length === 0 ? (
                  <p className="t-small">역할이 있는 사람만 제출할 수 있어요.</p>
                ) : (
                  <SubmitForm categories={categories} kinds={ATTACHMENT_KINDS.map((k) => ({ id: k.id, label: k.label, required: k.required, requiredFor: k.requiredFor }))} />
                )}
              </Card.Content>
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>내가 보고한 안건</Card.Title>
                <Card.Description>보고한 안건이 어디까지 갔는지 보여요.</Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-col gap-1">
                {mine.length === 0 && <p className="t-small">아직 보고한 안건이 없어요.</p>}
                {mine.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-default py-1.5">
                    <span className="flex flex-col">
                      <span className="t-small font-semibold">{s.title}</span>
                      <span className="t-caption">{fmtDateTime(s.createdAt)}{s.status === 'returned' && s.note ? ` · 반려 사유: ${s.note}` : ''}{s.decidedBy ? ` · 처리 ${s.decidedBy}` : ` · 접수 담당 ${roleLabel(s.acceptRole)}`}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Pill color={STATUS[s.status].color}>{STATUS[s.status].label}</Pill>
                      {s.caseId && <Link href={`/cases?id=${s.caseId}`} className="t-caption underline">안건 #{s.caseId}</Link>}
                    </span>
                  </div>
                ))}
              </Card.Content>
            </Card>
          </>
        )}

        {tab === 'accept' && (
          <AcceptTab
            waiting={waiting}
            selectedId={Number(sp.id)}
            nameOf={nameOf}
            sql={sql}
            windows={cash?.windows ?? null}
            bulk={await pendingExpansionPlans(sql).catch(() => ({ all: [], fresh: [] }))}
          />
        )}
      </div>
    </AppShell>
  )
}

async function AcceptTab({
  waiting, selectedId, nameOf, sql, windows, bulk,
}: {
  waiting: Awaited<ReturnType<typeof listSubmissions>>
  selectedId: number
  nameOf: Map<string, string>
  sql: Awaited<ReturnType<typeof getEngine>>['sql']
  windows: { start: string; end: string }[] | null
  bulk: Awaited<ReturnType<typeof pendingExpansionPlans>>
}) {
  const sel = waiting.find((s) => s.id === selectedId) ?? waiting[0]
  const files = sel ? await listFiles(sql, sel.id) : []
  const draftOptions = (await sql`SELECT id, name FROM drafts ORDER BY id`).map((d) => ({ id: Number(d.id), name: String(d.name) }))
  const dups = sel ? await findOpenCasesFor(sql, sel.category, sel.refId) : []
  const bulkTotal = bulk.fresh.reduce((s, p) => s + Number(p.requested_budget_krw), 0)

  let detail = null
  if (sel) {
    const cat = categoryById(sel.category)!
    const v = sel.input
    const contrib = contributionFromInput(v)
    const r = calcContribution(contrib)
    const dl = daysUntil(v.contractDeadline, AS_OF)
    const inWin = windows && v.settlementDate ? dateInBreachWindow(windows as never, v.settlementDate) : null
    const isNewRef = v.isNewRef === '1'
    const refName = isNewRef ? v.refName : nameOf.get(sel.refId) ?? '(이름 없음)'
    const chk = Object.fromEntries(checksFor(sel.category, isNewRef).map((c) => [c.id, c.label]))
    const fileLabel = (f: (typeof files)[number]) => (f.kind === CUSTOM_KIND ? `${f.label ?? '기타'} (직접 추가)` : ATTACHMENT_KINDS.find((k) => k.id === f.kind)?.label ?? f.kind)
    const link = (f: (typeof files)[number]) => (
      <a className="underline" href={`/api/submission-files/${f.id}`}>
        {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
      </a>
    )
    const money = (won: number) => fmtWon(won)
    // 확인할 값 옆에 바로 체크박스가 오도록, 항목마다 한 줄씩 (id 가 있는 줄이 체크 대상)
    const sections: ReviewSection[] = [
      {
        title: '안건 정보',
        rows: [
          { id: 'ref', label: cat.refLabel, value: `${sel.refId} ${refName}${isNewRef ? ' (신규)' : ''}`, hint: chk.ref },
          ...(isNewRef ? [{ id: 'newref', label: '신규 ID 확인', value: `${sel.refId} · 이름 ${v.refName}${v.parentInfluencerId ? ` · 소속 ${v.parentInfluencerId} ${nameOf.get(v.parentInfluencerId) ?? ''}` : ''} (규칙 ${cat.idRule})`, hint: chk.newref }] : []),
          { id: 'deadline', label: '계약 체결 기한', value: `${v.contractDeadline} (${ddayText(dl)})`, hint: chk.deadline },
          { id: 'settle', label: '지급 예정일', value: <>{v.settlementDate}{inWin === null ? '' : inWin ? <span className="text-danger"> · 현금 하회 예상 구간 안 (승인권자가 올라가요)</span> : ' · 하회 구간 밖'}</>, hint: chk.settle },
          { id: 'amount', label: '요청금액', value: fmtWon(contrib.marketingSpend), hint: chk.amount },
          ...(v.currentExpiry ? [{ label: '현 계약 만료일', value: v.currentExpiry }] : []),
          { id: 'memo', label: '메모', value: v.memo || '(메모 없음)', hint: chk.memo },
        ],
      },
      {
        title: '첨부서류 (파일마다 열어 보고 체크)',
        rows: [
          ...files.map((f) => ({ id: fileCheckId(f.id), label: fileLabel(f), value: link(f), hint: '이 파일을 열어 내용을 확인했다' })),
          ...(sel.category === 'influencer'
            ? [
                { id: 'terms', label: '계약서 내용', value: files.some((f) => f.kind === 'contract') ? '성과 피 정산 조건과 고정 피 금액이 표시돼 있는지 확인' : <span className="text-danger">계약서 첨부 없음</span>, hint: chk.terms },
                { id: 'notice', label: '통보 수령 증빙', value: files.some((f) => f.kind === 'notice') ? '실제로 통보를 받았다는 증빙인지 확인' : <span className="text-danger">통보 수령 증빙 첨부 없음</span>, hint: chk.notice },
              ]
            : []),
        ],
      },
      {
        title: '공헌이익 계산 (팀원 입력, 예상·추계)',
        rows: [
          { label: '예상 GMV', value: money(contrib.gmv) },
          { label: '− 예상 반품 환불액', value: money(contrib.refund) },
          { label: '= 순매출', value: money(r.netRevenue) },
          { label: '− 제품 원가', value: money(contrib.cogs) },
          { label: '− 채널 수수료', value: money(contrib.channelFee) },
          { label: '− 출고(배송)비', value: money(contrib.shipping) },
          { label: '− 반품 물류비', value: money(contrib.returnLogistics) },
          { label: '− 마케팅 지출', value: `${money(contrib.marketingSpend)} (= 요청금액)` },
          { id: 'calc', label: '공헌이익', value: <strong className={r.contributionProfit < 0 ? 'text-danger' : ''}>{money(r.contributionProfit)} · 실질 ROAS {r.realRoas === null ? '-' : `${r.realRoas.toFixed(2)}배`}</strong>, hint: chk.calc },
        ],
      },
      {
        title: '중복 확인',
        rows: [{ id: 'dup', label: '같은 대상 진행 안건', value: dups.length ? `${dups.length}건: ${dups.map((x) => `#${x.id}`).join(', ')}` : '없음', hint: chk.dup }],
      },
    ]
    detail = (
      <Card>
        <Card.Header>
          <Card.Title>{sel.title}</Card.Title>
          <Card.Description>{cat.label} · 보고자 {sel.submittedBy} · {fmtDateTime(sel.createdAt)}</Card.Description>
        </Card.Header>
        <Card.Content>
          <AcceptReview
            key={sel.id}
            id={sel.id}
            sections={sections}
            drafts={draftOptions}
            mustCheck={[
              ...(sel.category === 'influencer'
                ? [
                    { id: 'terms', text: '계약서 첨부 확인 — 성과 피 정산 조건과 고정 피 금액이 표시돼 있는지' },
                    { id: 'notice', text: '실제 통보 수령 증빙 첨부 확인' },
                  ]
                : []),
              { id: 'calc', text: '공헌이익 산출 여부 확인' },
            ]}
          />
        </Card.Content>
      </Card>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[18rem_1fr]">
        <Card>
          <Card.Header>
            <Card.Title>접수 필요 안건 ({waiting.length}건)</Card.Title>
            <Card.Description>팀원이 보고한 안건이에요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col">
            {waiting.length === 0 && <p className="t-small">접수할 안건이 없어요.</p>}
            {waiting.map((s) => (
              <Link key={s.id} href={`/intake?tab=accept&id=${s.id}`} className={`flex flex-col gap-0.5 border-b border-default px-2 py-1.5 ${sel?.id === s.id ? 'bg-primary-soft' : ''}`}>
                <span className="t-small font-semibold">{s.title}</span>
                <span className="t-caption">{categoryById(s.category)!.label} · {s.submittedBy} · 기한 {s.input.contractDeadline}</span>
              </Link>
            ))}
          </Card.Content>
        </Card>
        {detail ?? <Card><Card.Content><p className="t-small">왼쪽에서 접수할 안건을 고르세요.</p></Card.Content></Card>}
      </div>

      {bulk.all.length > 0 && (
        <Card>
          <Card.Header>
            <Card.Title>원본 기안 일괄 접수</Card.Title>
            <Card.Description>원본 자료(02_masil/marketing/mkt_budget_plan_ms.csv)의 기안 {bulk.all.length}건 중 아직 접수하지 않은 건을 한꺼번에 접수해요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-2">
            <p className="t-small">접수 대기 {bulk.fresh.length}건{bulk.fresh.length > 0 ? ` · 요청액 합계 ${fmtWon(bulkTotal)}` : ''}</p>
            <div><ImportPlansButton fresh={bulk.fresh.length} /></div>
          </Card.Content>
        </Card>
      )}
    </>
  )
}
