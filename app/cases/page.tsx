import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { CaseDetail } from '@/components/CaseDetail'
import { CaseFilters } from '@/components/CaseFilters'
import { CaseTable } from '@/components/CaseTable'
import { PageHeader } from '@/components/ax'
import { AS_OF, getEngine } from '@/lib/app/engine'
import { ddayText, fmtWon } from '@/lib/app/format'
import { loadCaseRows, loadDraftRows, type CaseRow, type DraftRow } from '@/lib/app/case-list'
import { assignDrafts } from '@/lib/app/drafts'
import { CATEGORY_LABEL } from '@/lib/app/labels'
import { daysUntil } from '@/lib/engine/engine'
import { allStateTexts } from '@/lib/process/status'

export const dynamic = 'force-dynamic'

type SortKey = 'code' | 'title' | 'type' | 'amount' | 'state' | 'settle' | 'deadline'
const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'code', label: '분류코드' },
  { key: 'title', label: '안건' },
  { key: 'type', label: '종류' },
  { key: 'amount', label: '요청금액', align: 'right' },
  { key: 'state', label: '상태' },
  { key: 'settle', label: '지급 예정일' },
  { key: 'deadline', label: '계약 체결 기한' },
]

// 열의 처음 폭(px) — 표에서 경계를 끌어 바꿀 수 있다
const WIDTH: Record<SortKey, number> = { code: 110, title: 300, type: 130, amount: 150, state: 190, settle: 120, deadline: 170 }

/** 정렬 값 — 비어 있는 값은 어느 방향이든 맨 아래로 간다 */
const sortValue = (r: CaseRow, k: SortKey): string | number | null =>
  k === 'code' ? r.code || null : k === 'title' ? r.title : k === 'type' ? r.categoryLabel : k === 'amount' ? r.amount : k === 'state' ? r.stage * 1000 + r.id : k === 'settle' ? r.settlementDate : r.deadline

// 기안 표 (맨 위): 기안마다 안건을 묶어 한 줄로 보여 준다
type DraftSort = 'name' | 'type' | 'count' | 'amount' | 'state' | 'deadline'
const DRAFT_COLUMNS: { key: DraftSort; label: string; align?: 'right'; width: number }[] = [
  { key: 'name', label: '기안', width: 300 },
  { key: 'type', label: '종류', width: 140 },
  { key: 'count', label: '안건 수', align: 'right', width: 90 },
  { key: 'amount', label: '요청금액 합계', align: 'right', width: 170 },
  { key: 'state', label: '안건 상태', width: 300 },
  { key: 'deadline', label: '가장 빠른 계약 체결 기한', width: 200 },
]
const draftSortValue = (d: DraftRow, k: DraftSort): string | number | null =>
  k === 'name' ? d.name : k === 'type' ? d.categoryLabel : k === 'count' ? d.caseCount : k === 'amount' ? d.amount : k === 'state' ? d.stage * 1000 + d.id : d.deadline

export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { sql } = await getEngine()
  await assignDrafts(sql) // 기안이 아직 없는 안건은 기안에 넣는다 (앱 안의 분류일 뿐, 원본은 바뀌지 않는다)
  const all = await loadCaseRows(sql)
  const drafts = await loadDraftRows(sql, all)

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, v)
    return `/cases?${p.toString()}`
  }

  // ── 기안 표 정렬 (기본: 가장 빠른 계약 체결 기한 순) ──
  const dsort = (DRAFT_COLUMNS.some((c) => c.key === sp.dsort) ? sp.dsort : 'deadline') as DraftSort
  const ddir = sp.ddir === 'desc' ? -1 : 1
  const draftRows = [...drafts].sort((a, b) => {
    const x = draftSortValue(a, dsort), y = draftSortValue(b, dsort)
    if (x === null && y === null) return a.id - b.id
    if (x === null) return 1
    if (y === null) return -1
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko')
    return c * ddir || a.id - b.id
  })

  // ── 선택한 기안 (안건 주소만 있어도 그 안건이 속한 기안을 연다) ──
  const idCase = Number.isInteger(Number(sp.id)) && sp.id ? all.find((r) => r.id === Number(sp.id)) : undefined
  const draftId = Number.isInteger(Number(sp.draft)) && sp.draft ? Number(sp.draft) : idCase?.draftId ?? null
  const draft = draftId !== null ? drafts.find((d) => d.id === draftId) : undefined
  const inDraft = draft ? all.filter((r) => r.draftId === draft.id) : []

  // ── 안건 표: 선택한 기안 안의 안건에 필터·정렬을 건다 ──
  const basis = sp.basis === 'deadline' ? 'deadline' : 'settle'
  const dateOf = (r: CaseRow) => (basis === 'deadline' ? r.deadline : r.settlementDate)
  const q = (sp.q ?? '').trim().toLowerCase()
  const rows = inDraft.filter(
    (r) =>
      (!sp.type || r.category === sp.type) &&
      (!sp.state || r.stateBase === sp.state) &&
      (!q || r.title.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)) &&
      (!sp.from || (dateOf(r) !== null && dateOf(r)! >= sp.from)) &&
      (!sp.to || (dateOf(r) !== null && dateOf(r)! <= sp.to)),
  )
  const sort = (COLUMNS.some((c) => c.key === sp.sort) ? sp.sort : 'deadline') as SortKey
  const dir = sp.dir === 'desc' ? -1 : 1
  rows.sort((a, b) => {
    const x = sortValue(a, sort), y = sortValue(b, sort)
    if (x === null && y === null) return a.id - b.id
    if (x === null) return 1
    if (y === null) return -1
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko')
    return c * dir || a.id - b.id
  })
  const selected = idCase && idCase.draftId === draft?.id ? idCase : undefined

  const sortHref = (k: SortKey) => qs({ sort: k, dir: sort === k && dir === 1 ? 'desc' : 'asc' })
  const draftSortHref = (k: DraftSort) => qs({ dsort: k, ddir: dsort === k && ddir === 1 ? 'desc' : 'asc' })
  // 상태 필터는 7가지 상태를 모두 보여 주고(지금 없는 상태도 고를 수 있다), 이 기안 안의 안건 수를 옆에 적는다
  const present = new Map<string, number>()
  for (const r of inDraft) present.set(r.stateBase, (present.get(r.stateBase) ?? 0) + 1)
  const states = allStateTexts().map((k) => ({ value: k.base, label: `${k.base} (${present.get(k.base) ?? 0}건)` }))

  return (
    <AppShell>
      <div className="flex flex-col gap-3">
        <PageHeader title="기안 목록" description="기안을 고르면 그 안의 안건이 나오고, 안건을 고르면 아래에 업무 흐름표와 다음 행동이 나와요. 제목 줄을 누르면 정렬돼요." />

        {/* 1) 기안 */}
        <div className="border border-default" style={{ borderRadius: 2 }}>
          <div className="flex items-baseline justify-between px-3 py-1.5">
            <span className="t-small font-semibold">기안 {drafts.length}건 <span className="t-caption">(안건 {all.length}건)</span></span>
            <span className="t-caption">정렬: {DRAFT_COLUMNS.find((c) => c.key === dsort)?.label} {ddir === 1 ? '▲' : '▼'}</span>
          </div>
          <CaseTable
            storageKey="draft-table-widths-v1"
            columns={DRAFT_COLUMNS.map((c) => ({
              key: c.key, label: c.label, align: c.align, sortHref: draftSortHref(c.key), sortDir: dsort === c.key ? (ddir === 1 ? 'asc' : 'desc') : undefined, defaultWidth: c.width,
            }))}
            rows={draftRows.map((d) => ({
              id: d.id,
              href: qs({ draft: String(d.id), id: undefined }),
              selected: draft?.id === d.id,
              cells: {
                name: d.name,
                type: d.categoryLabel,
                count: `${d.caseCount}건`,
                amount: d.amount === null ? '—' : fmtWon(d.amount),
                state: d.stateSummary,
                deadline: d.deadline ? `${d.deadline} (${ddayText(daysUntil(d.deadline, AS_OF))})` : '—',
              },
            }))}
            emptyText="기안이 없어요. 기안 접수에서 새 안건을 받으세요."
          />
        </div>

        {/* 2) 선택한 기안 안의 안건 */}
        {draft ? (
          <>
            {/* 필터와 안건 표는 한 상자 안에 둔다 — 필터가 이 표에만 걸린다는 것이 한눈에 보이도록 */}
            <div className="border border-default" style={{ borderRadius: 2 }}>
              <div className="flex items-baseline justify-between px-3 py-1.5">
                <span className="t-small font-semibold">{draft.name} 안의 안건 {rows.length}건{rows.length !== inDraft.length ? ` (기안 전체 ${inDraft.length}건 중)` : ''}</span>
                <span className="t-caption">정렬: {COLUMNS.find((c) => c.key === sort)?.label} {dir === 1 ? '▲' : '▼'}</span>
              </div>
              <CaseFilters bare types={Object.entries(CATEGORY_LABEL).map(([id, label]) => ({ id, label }))} states={states} />
              {/* 목록이 길어져도 업무 흐름표가 멀어지지 않도록 일정 높이에서 안쪽으로 스크롤. 열은 세로줄로 나뉘고 경계를 끌어 폭을 바꿀 수 있다 */}
              <CaseTable
                columns={COLUMNS.map((c) => ({
                  key: c.key, label: c.label, align: c.align, sortHref: sortHref(c.key), sortDir: sort === c.key ? (dir === 1 ? 'asc' : 'desc') : undefined, defaultWidth: WIDTH[c.key],
                }))}
                rows={rows.map((r) => ({
                  id: r.id,
                  href: qs({ id: String(r.id), draft: String(draft.id) }),
                  selected: selected?.id === r.id,
                  cells: {
                    code: r.code || '—',
                    title: r.title,
                    type: r.categoryLabel,
                    amount: r.amount === null ? '—' : fmtWon(r.amount),
                    state: r.state,
                    settle: r.settlementDate ?? '—',
                    deadline: r.deadline ? `${r.deadline} (${ddayText(daysUntil(r.deadline, AS_OF))})` : '—',
                  },
                }))}
                emptyText="조건에 맞는 안건이 없어요."
              />
            </div>
          </>
        ) : (
          <div className="flex min-h-24 items-center justify-center border border-dashed border-default">
            <p className="t-small text-muted">위 표에서 기안을 고르면 그 기안 안의 안건이 여기에 나와요.</p>
          </div>
        )}

        {/* 3) 업무 흐름표: 처음에는 비어 있다가, 위 목록에서 안건을 고르면 여기에 나온다 */}
        {selected ? (
          <CaseDetail caseId={selected.id} />
        ) : (
          <Card>
            <Card.Header>
              <Card.Title>업무 흐름</Card.Title>
            </Card.Header>
            <Card.Content>
              <div className="flex min-h-48 items-center justify-center border border-dashed border-default">
                <p className="t-small text-muted">위 목록에서 안건을 고르면 업무 흐름표가 여기에 나와요.</p>
              </div>
            </Card.Content>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
