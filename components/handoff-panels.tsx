'use client'

// 부서 사이 회부 화면 — 재무팀(300억 배분 대상 확인 → 성과·비용표 취합 → 계약 담당에게), 계약 담당(계약서 첨부 + 조건·기한 확인 → 승인권자에게).
// 해당 부서의 사람에게만 서버가 이 패널을 그려 준다. 실제 권한은 서버 동작이 다시 확인한다.
import { useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@heroui/react'
import { contractReferAction, financeReferAction } from '@/app/actions'
import { NumberedList } from '@/components/NumberedList'

export interface CheckItem {
  key: string
  title: string
  body: ReactNode
}

/** 항목마다 왼쪽에 체크박스가 있는 체크리스트. 확인한 항목 수를 위에서 알 수 있게 한다. */
function CheckList({ items, on, setOn }: { items: CheckItem[]; on: Record<string, boolean>; setOn: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void }) {
  return (
    <div className="flex flex-col">
      {items.map((it) => (
        <label key={it.key} className={`grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)] gap-2 border-b border-default py-2 ${on[it.key] ? 'bg-success-soft' : ''}`}>
          <input type="checkbox" className="mt-1" checked={!!on[it.key]} onChange={(e) => setOn((s) => ({ ...s, [it.key]: e.target.checked }))} aria-label={`${it.title} 확인`} />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="t-small font-semibold">{it.title}</span>
            {it.body}
          </span>
        </label>
      ))}
    </div>
  )
}

/**
 * 재무팀의 다음 행동 두 가지:
 *  1. 그룹 300억 배분 대상인지 확인 (승인권자를 정하는 더 앞선 결정)
 *  2. 성과·비용표 취합 — 항목마다 확인하고 체크, 모두 끝나면 계약 담당에게 회부
 * beyondPeriod: 집행 예정일이 300억 집행 기준기간(6개월)을 넘으면 그 날짜 — 이때만 '대상 아님'이 자동 선택된다.
 */
export function FinanceReferItems({
  caseId, items, current, beyondPeriod, start,
}: { caseId: number; items: CheckItem[]; current: boolean | null; beyondPeriod: { date: string; end: string } | null; start: number }) {
  const router = useRouter()
  const [pending, run] = useTransition()
  const [linked, setLinked] = useState<'yes' | 'no' | ''>(beyondPeriod ? 'no' : current === true ? 'yes' : current === false ? 'no' : '')
  const [on, setOn] = useState<Record<string, boolean>>({})
  const done = items.filter((i) => on[i.key]).length
  const ready = linked !== '' && done === items.length
  const go = () =>
    run(async () => {
      const r = await financeReferAction({ caseId, linked: linked === 'yes' })
      if (r.ok) { toast.success(r.message); router.refresh() } else toast.danger(r.message)
    })
  return (
    <NumberedList
      start={start}
      items={[
        {
          key: 'g300',
          title: '그룹 300억 배분 대상인지 확인이 필요합니다',
          body: (
            <div className="flex flex-col gap-2 border border-default p-2">
              {beyondPeriod && (
                <p className="t-caption">집행 예정일 {beyondPeriod.date} 이 300억 집행 기준기간(향후 6개월, {beyondPeriod.end}까지)을 넘어서 <strong>대상 아님</strong>으로 자동 선택됐어요.</p>
              )}
              <label className="flex cursor-pointer items-start gap-2 t-small">
                <input type="radio" name={`g300-${caseId}`} className="mt-1" checked={linked === 'no'} onChange={() => setLinked('no')} />
                <span><strong>대상 아님</strong></span>
              </label>
              <label className={`flex items-start gap-2 t-small ${beyondPeriod ? 'opacity-50' : 'cursor-pointer'}`}>
                <input type="radio" name={`g300-${caseId}`} className="mt-1" disabled={Boolean(beyondPeriod)} checked={linked === 'yes'} onChange={() => setLinked('yes')} />
                <span><strong>그룹 300억 배분 검토 대상</strong> — 승인권자가 CEO/이사회가 돼요</span>
              </label>
            </div>
          ),
        },
        {
          key: 'collect',
          title: '성과·비용표 취합 — 항목마다 확인하고 체크하세요',
          body: (
            <div className="flex flex-col gap-2">
              <span className="t-caption">{done} / {items.length} 확인</span>
              <CheckList items={items} on={on} setOn={setOn} />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button isDisabled={pending || !ready} onPress={go}>계약 담당에게 회부</Button>
                {!ready && <span className="t-caption">{linked === '' ? '300억 배분 대상 여부를 고르고, ' : ''}모든 항목을 체크해야 회부할 수 있어요.</span>}
              </div>
            </div>
          ),
        },
      ]}
    />
  )
}

/** 계약 담당: 계약조건·기한 확인 단계. 항목마다 체크하고 계약서를 첨부하면 승인권자에게 회부한다. */
export function ContractReferPanel({
  caseId, items, files,
}: { caseId: number; items: CheckItem[]; files: { id: number; filename: string; size: number }[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [on, setOn] = useState<Record<string, boolean>>({})
  const ref = useRef<HTMLInputElement>(null)
  const done = items.filter((i) => on[i.key]).length
  const ready = done === items.length && files.length > 0

  const upload = (list: File[]) => {
    if (list.length === 0) return
    start(async () => {
      const fd = new FormData()
      fd.set('caseId', String(caseId))
      list.forEach((f) => fd.append('file', f))
      try {
        const res = await fetch('/api/case-files', { method: 'POST', body: fd })
        const r = (await res.json()) as { ok: boolean; message: string }
        if (r.ok) { toast.success(r.message); router.refresh() } else toast.danger(r.message)
      } catch {
        toast.danger('첨부하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
      }
    })
  }
  const go = () =>
    start(async () => {
      const r = await contractReferAction({ caseId })
      if (r.ok) { toast.success(r.message); router.refresh() } else toast.danger(r.message)
    })

  return (
    <div className="flex flex-col gap-2">
      <span className="t-caption">{done} / {items.length} 확인</span>
      <CheckList items={items} on={on} setOn={setOn} />
      <div className="flex flex-col gap-2 border-b border-default py-2">
        <span className="t-small font-semibold">계약서 첨부</span>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={ref} type="file" multiple hidden onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <Button size="sm" variant="secondary" isDisabled={pending} onPress={() => ref.current?.click()}>계약서 파일 선택</Button>
          <span className="t-caption">pdf·문서·hwp·이미지 등, 파일당 8MB 까지</span>
        </div>
        {files.length === 0 ? (
          <p className="t-caption">첨부된 계약서가 없어요. 계약서를 첨부해야 회부할 수 있어요.</p>
        ) : (
          <div className="flex flex-col">
            {files.map((f) => (
              <a key={f.id} className="border-b border-default py-1 t-small underline" href={`/api/case-files/${f.id}`}>
                {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button isDisabled={pending || !ready} onPress={go}>승인권자에게 회부</Button>
        {!ready && <span className="t-caption">{files.length === 0 ? '계약서를 첨부하고, ' : ''}모든 항목을 체크해야 회부할 수 있어요.</span>}
      </div>
    </div>
  )
}
