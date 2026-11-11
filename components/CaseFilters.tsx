'use client'

// 안건 목록 필터 — 접었다 폈다 할 수 있다. 값은 주소(?type=&state=&basis=&from=&to=&q=)에 담겨서, 선택한 안건·정렬은 그대로 유지된다.
import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@heroui/react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import { formatDateInput } from '@/lib/app/date-input'

const INPUT = 'rounded-input border border-default bg-content px-2 py-1 t-small'
const KEYS = ['type', 'state', 'basis', 'from', 'to', 'q'] as const

export function CaseFilters({ types, states }: { types: { id: string; label: string }[]; states: string[] }) {
  const router = useRouter()
  const path = usePathname()
  const sp = useSearchParams()
  const [open, setOpen] = useState(true)
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? (k === 'basis' ? 'settle' : '')])))
  const set = (k: string) => (val: string) => setV((s) => ({ ...s, [k]: val }))
  const active = KEYS.filter((k) => k !== 'basis' && (sp.get(k) ?? '') !== '').length

  const go = (next: Record<string, string>) => {
    const q = new URLSearchParams(sp.toString())
    for (const k of KEYS) {
      if (next[k]) q.set(k, next[k])
      else q.delete(k)
    }
    router.replace(`${path}?${q.toString()}`, { scroll: false })
  }
  const reset = () => { const empty = { type: '', state: '', basis: 'settle', from: '', to: '', q: '' }; setV(empty); go({ ...empty, basis: '' }) }

  return (
    <div className="border border-default" style={{ borderRadius: 2 }}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <CaretDown size={14} /> : <CaretRight size={14} />}
        <span className="t-small font-semibold">필터</span>
        <span className="t-caption">{active > 0 ? `${active}개 조건 적용 중` : '조건 없음'}</span>
      </button>
      {open && (
        <form
          className="flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-default px-3 py-2"
          onSubmit={(e) => { e.preventDefault(); go(v) }}
        >
          <label className="flex flex-col gap-1 t-caption">종류
            <select className={INPUT} value={v.type} onChange={(e) => set('type')(e.target.value)}>
              <option value="">전체</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 t-caption">상태
            <select className={INPUT} value={v.state} onChange={(e) => set('state')(e.target.value)}>
              <option value="">전체</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 t-caption">날짜 기준
            <select className={INPUT} value={v.basis} onChange={(e) => set('basis')(e.target.value)}>
              <option value="settle">결산일</option>
              <option value="deadline">계약 체결 기한</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 t-caption">부터
            <input className={`${INPUT} w-32`} inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" value={v.from} onChange={(e) => set('from')(formatDateInput(e.target.value))} />
          </label>
          <label className="flex flex-col gap-1 t-caption">까지
            <input className={`${INPUT} w-32`} inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" value={v.to} onChange={(e) => set('to')(formatDateInput(e.target.value))} />
          </label>
          <label className="flex flex-col gap-1 t-caption">제목·코드 검색
            <input className={`${INPUT} w-44`} placeholder="제목·분류코드" value={v.q} onChange={(e) => set('q')(e.target.value)} />
          </label>
          <Button size="sm" type="submit">적용</Button>
          <Button size="sm" variant="outline" onPress={reset}>초기화</Button>
        </form>
      )}
    </div>
  )
}
