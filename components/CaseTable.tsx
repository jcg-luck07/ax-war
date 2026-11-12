'use client'

// 안건 목록 표 — 열마다 세로줄로 나뉘고, 열 제목 오른쪽 경계를 끌어서 폭을 늘이거나 줄일 수 있다 (칸보다 긴 글자는 줄바꿈하지 않고 잘린다 — 엑셀처럼. 마우스를 올리면 전체가 보인다).
// 경계를 더블클릭하면 그 열 폭이 처음 값으로 돌아간다. 정한 폭은 이 브라우저에 기억된다.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

export interface TableColumn {
  key: string
  label: string
  align?: 'right'
  /** 열 제목을 눌렀을 때 갈 주소(정렬) */
  sortHref: string
  /** 지금 이 열로 정렬 중이면 방향 */
  sortDir?: 'asc' | 'desc'
  defaultWidth: number
}

export interface TableRow {
  id: number
  href: string
  selected: boolean
  cells: Record<string, string>
}

const MIN = 56

export function CaseTable({ columns, rows, emptyText, storageKey = 'cases-table-widths-v1' }: { columns: TableColumn[]; rows: TableRow[]; emptyText: string; storageKey?: string }) {
  const STORE = storageKey
  const [widths, setWidths] = useState<Record<string, number>>(() => Object.fromEntries(columns.map((c) => [c.key, c.defaultWidth])))
  const drag = useRef<{ key: string; startX: number; startW: number } | null>(null)

  // 저장된 폭 불러오기 (저장소를 못 쓰는 환경이면 처음 폭 그대로)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Record<string, number> | null
      // 저장된 폭은 브라우저에서만 읽을 수 있어 화면이 그려진 뒤 반영한다 (효과 본문에서 바로 상태를 바꾸지 않도록 한 박자 늦춘다)
      if (saved) queueMicrotask(() => setWidths((w) => ({ ...w, ...Object.fromEntries(Object.entries(saved).filter(([k, v]) => columns.some((c) => c.key === k) && Number.isFinite(v) && v >= MIN)) })))
    } catch { /* 저장소를 못 쓰면 무시 */ }
  }, [columns])

  const save = (w: Record<string, number>) => {
    try { localStorage.setItem(STORE, JSON.stringify(w)) } catch { /* 무시 */ }
  }

  const total = columns.reduce((s, c) => s + (widths[c.key] ?? c.defaultWidth), 0)

  return (
    <div className="max-h-72 overflow-auto border-t border-default">
      <table className="border-collapse t-small" style={{ tableLayout: 'fixed', width: total }}>
        <colgroup>
          {columns.map((c) => <col key={c.key} style={{ width: widths[c.key] ?? c.defaultWidth }} />)}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`relative border-b border-r border-default px-3 py-1.5 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                aria-sort={c.sortDir ? (c.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
<Link href={c.sortHref} scroll={false} className="flex items-center gap-1 whitespace-nowrap" title={c.label}>
                  <span className="min-w-0 truncate">{c.label}</span><span className="t-caption shrink-0">{c.sortDir ? (c.sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                </Link>
                {/* 열 경계: 끌어서 폭 조절, 더블클릭하면 처음 폭 */}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`${c.label} 열 폭 조절`}
                  title="끌어서 폭 조절 · 더블클릭하면 처음 폭"
                  className="absolute right-0 top-0 h-full cursor-col-resize select-none"
                  style={{ width: 8, marginRight: -4, touchAction: 'none' }}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    drag.current = { key: c.key, startX: e.clientX, startW: widths[c.key] ?? c.defaultWidth }
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current
                    if (!d || d.key !== c.key) return
                    setWidths((w) => ({ ...w, [c.key]: Math.max(MIN, Math.round(d.startW + e.clientX - d.startX)) }))
                  }}
                  onPointerUp={() => {
                    if (drag.current) { drag.current = null; setWidths((w) => { save(w); return w }) }
                  }}
                  onDoubleClick={() => setWidths((w) => { const n = { ...w, [c.key]: c.defaultWidth }; save(n); return n })}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3 py-3 t-small">{emptyText}</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className={`border-b border-default align-top ${r.selected ? 'bg-primary-soft' : 'hover:bg-surface'}`} aria-selected={r.selected}>
              {columns.map((c) => (
                <td key={c.key} className={`border-r border-default p-0 ${c.key === 'title' ? 'font-semibold' : ''} ${c.align === 'right' ? 'text-right' : ''}`}>
                  <Link href={r.href} scroll={false} className="block truncate whitespace-nowrap px-3 py-1.5" title={r.cells[c.key] ?? ''}>{r.cells[c.key] ?? ''}</Link>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
