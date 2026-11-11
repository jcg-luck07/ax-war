import Link from 'next/link'
import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { CaseDetail } from '@/components/CaseDetail'
import { CaseFilters } from '@/components/CaseFilters'
import { PageHeader } from '@/components/ax'
import { AS_OF, getEngine } from '@/lib/app/engine'
import { ddayText, fmtWon } from '@/lib/app/format'
import { loadCaseRows, type CaseRow } from '@/lib/app/case-list'
import { CATEGORY_LABEL } from '@/lib/app/labels'
import { daysUntil } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

type SortKey = 'code' | 'title' | 'type' | 'amount' | 'state' | 'settle' | 'deadline'
const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'code', label: '분류코드' },
  { key: 'title', label: '안건' },
  { key: 'type', label: '종류' },
  { key: 'amount', label: '요청금액', align: 'right' },
  { key: 'state', label: '상태' },
  { key: 'settle', label: '결산일' },
  { key: 'deadline', label: '계약 체결 기한' },
]

/** 정렬 값 — 비어 있는 값은 어느 방향이든 맨 아래로 간다 */
const sortValue = (r: CaseRow, k: SortKey): string | number | null =>
  k === 'code' ? r.code || null : k === 'title' ? r.title : k === 'type' ? r.categoryLabel : k === 'amount' ? r.amount : k === 'state' ? r.stage * 1000 + r.id : k === 'settle' ? r.settlementDate : r.deadline

export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { sql } = await getEngine()
  const all = await loadCaseRows(sql)

  // 필터
  const basis = sp.basis === 'deadline' ? 'deadline' : 'settle'
  const dateOf = (r: CaseRow) => (basis === 'deadline' ? r.deadline : r.settlementDate)
  const q = (sp.q ?? '').trim().toLowerCase()
  const rows = all.filter(
    (r) =>
      (!sp.type || r.category === sp.type) &&
      (!sp.state || r.state === sp.state) &&
      (!q || r.title.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)) &&
      (!sp.from || (dateOf(r) !== null && dateOf(r)! >= sp.from)) &&
      (!sp.to || (dateOf(r) !== null && dateOf(r)! <= sp.to)),
  )

  // 정렬 (기본: 계약 체결 기한이 빠른 순)
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

  const selectedId = Number(sp.id)
  const selected = Number.isInteger(selectedId) ? all.find((r) => r.id === selectedId) : undefined

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, v)
    return `/cases?${p.toString()}`
  }
  const sortHref = (k: SortKey) => qs({ sort: k, dir: sort === k && dir === 1 ? 'desc' : 'asc' })
  const states = [...new Map(all.map((r) => [r.state, r.stage])).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], 'ko')).map(([s]) => s)

  return (
    <AppShell>
      <div className="flex flex-col gap-3">
        <PageHeader title="안건 목록" description="안건을 고르면 아래에 그 안건의 업무 흐름표와 다음 행동이 나와요. 제목 줄을 누르면 정렬돼요." />

        <CaseFilters types={Object.entries(CATEGORY_LABEL).map(([id, label]) => ({ id, label }))} states={states} />

        <div className="border border-default" style={{ borderRadius: 2 }}>
          <div className="flex items-baseline justify-between px-3 py-1.5">
            <span className="t-small font-semibold">안건 {rows.length}건{rows.length !== all.length ? ` (전체 ${all.length}건 중)` : ''}</span>
            <span className="t-caption">정렬: {COLUMNS.find((c) => c.key === sort)?.label} {dir === 1 ? '▲' : '▼'}</span>
          </div>
          {/* 목록이 길어져도 업무 흐름표가 멀어지지 않도록 일정 높이에서 안쪽으로 스크롤 */}
          <div className="max-h-72 overflow-auto border-t border-default">
            <table className="w-full border-collapse t-small" style={{ minWidth: "62rem" }}>
              <thead className="sticky top-0 z-10 bg-surface">
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`border-b border-default px-3 py-1.5 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`} aria-sort={sort === c.key ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>
                      <Link href={sortHref(c.key)} scroll={false} className="inline-flex items-center gap-1">
                        {c.label}<span className="t-caption">{sort === c.key ? (dir === 1 ? '▲' : '▼') : ''}</span>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={COLUMNS.length} className="px-3 py-3 t-small">조건에 맞는 안건이 없어요. {all.length === 0 && '안건 접수에서 새 안건을 받으세요.'}</td></tr>
                )}
                {rows.map((r) => {
                  const cell = (children: React.ReactNode) => (
                    <Link href={qs({ id: String(r.id) })} scroll={false} className="block px-3 py-1.5">{children}</Link>
                  )
                  const on = selected?.id === r.id
                  return (
                    <tr key={r.id} className={`border-b border-default ${on ? 'bg-primary-soft' : 'hover:bg-surface'}`} aria-selected={on}>
                      <td className="p-0">{cell(r.code || '—')}</td>
                      <td className="p-0 font-semibold">{cell(r.title)}</td>
                      <td className="p-0">{cell(r.categoryLabel)}</td>
                      <td className="p-0 text-right">{cell(r.amount === null ? '—' : fmtWon(r.amount))}</td>
                      <td className="p-0">{cell(r.state)}</td>
                      <td className="p-0">{cell(r.settlementDate ?? '—')}</td>
                      <td className="p-0">{cell(r.deadline ? `${r.deadline} (${ddayText(daysUntil(r.deadline, AS_OF))})` : '—')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 업무 흐름표: 처음에는 비어 있다가, 위 목록에서 안건을 고르면 여기에 나온다 */}
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
