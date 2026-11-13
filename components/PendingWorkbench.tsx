'use client'

// 미확정 안건 — 한 분류(예: "승인 후보") 안의 안건 목록. 왼쪽 체크박스로 여러 안건을 고르고, 한꺼번에 확정하거나 다른 후보로 바꾼다.
// 안건 목록과 같은 모양인데 맨 오른쪽에 공헌이익 열이 더해진다. 안건을 누르면 그 아래에 수익성 검증(children)이 나오고, 그 아래에 처리 버튼이 있다.
// 처리하기 전에는 항상 "안건 N개가 선택되었어요"라고 한 번 더 묻는다. 실제 권한·상태는 서버가 안건마다 다시 확인한다.
import { useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@heroui/react'
import { useConfirm } from '@/components/ax'
import { changeCandidatesAction, confirmCandidatesAction, removeCandidateAction } from '@/app/actions'
import type { CandidateKind } from '@/lib/modules/w02/candidates'

export interface PendingRow {
  id: number
  href: string
  code: string
  title: string
  draft: string
  type: string
  amount: string
  state: string
  settle: string
  deadline: string
  deadlineClass: string
  profit: string
  profitNegative: boolean
  /** 내 역할로 이 후보를 확정할 수 있는가 (아니어도 고르고 볼 수는 있다 — 처리 때 건너뛴다) */
  mine: boolean
}

export interface ChangeOption {
  kind: CandidateKind
  label: string
}

const COLS: { key: keyof PendingRow; label: string; width: number; align?: 'right' }[] = [
  { key: 'code', label: '분류코드', width: 100 },
  { key: 'title', label: '안건', width: 260 },
  { key: 'draft', label: '속한 기안서', width: 200 },
  { key: 'type', label: '종류', width: 110 },
  { key: 'amount', label: '요청금액', width: 130, align: 'right' },
  { key: 'state', label: '상태', width: 170 },
  { key: 'settle', label: '지급 예정일', width: 110 },
  { key: 'deadline', label: '계약 체결 기한', width: 160 },
  { key: 'profit', label: '공헌이익', width: 140, align: 'right' },
]
const CHECK_W = 40

export function PendingWorkbench({
  groupLabel, rows, selectedId, changeOptions, reworkTeams, askLinked, children,
}: {
  groupLabel: string
  rows: PendingRow[]
  selectedId: number | null
  /** 이 분류에서 바꿀 수 있는 다른 후보 */
  changeOptions: ChangeOption[]
  /** 보완요청 후보로 바꿀 때 고를 수 있는 팀 */
  reworkTeams: { role: string; label: string }[]
  /** 회부 후보로 바꿀 때 재무팀 단계라면 300억 배분 대상 여부를 정해야 한다 */
  askLinked: boolean
  children: ReactNode
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [team, setTeam] = useState(reworkTeams[0]?.role ?? '')
  const [linked, setLinked] = useState<'yes' | 'no'>('no')
  const [memo, setMemo] = useState('')

  const ids = rows.map((r) => r.id)
  const chosen = ids.filter((id) => picked.has(id))
  const allOn = ids.length > 0 && chosen.length === ids.length
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const total = COLS.reduce((s, c) => s + c.width, CHECK_W)
  const notMine = rows.filter((r) => picked.has(r.id) && !r.mine).length

  // 확인창은 전환(start) 밖에서 기다려야 해요 (전환 안에서 기다리면 확인창이 뜨지 않고 버튼이 멈춰요).
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn()
      if (r.ok) { toast.success(r.message); setPicked(new Set()); router.refresh() } else toast.danger(r.message)
    })

  const onConfirm = async () => {
    if (chosen.length === 0) return
    const ok = await confirm({
      title: `안건 ${chosen.length}개가 선택되었어요`,
      description: `선택한 안건을 "${groupLabel}" 그대로 확정할까요? 확정하면 안건의 진행 상태가 실제로 바뀌어요.`,
      details: notMine > 0 ? `내 역할로 처리할 수 없는 ${notMine}건은 건너뛰어요.` : undefined,
      confirmLabel: '확정',
      cancelLabel: '취소',
      variant: 'warning',
    })
    if (ok) run(() => confirmCandidatesAction({ caseIds: chosen }))
  }
  const onChange = async (o: ChangeOption) => {
    if (chosen.length === 0) return
    const ok = await confirm({
      title: `안건 ${chosen.length}개가 선택되었어요`,
      description: `선택한 안건을 "${o.label}"로 바꿀까요? 후보만 바뀌고 안건의 진행 상태는 바뀌지 않아요.`,
      confirmLabel: '변경',
      cancelLabel: '취소',
    })
    if (!ok) return
    const params = o.kind === 'rework' ? { toRole: team, note: memo } : o.kind === 'proceed' ? { linked: linked === 'yes' } : { comment: memo }
    run(() => changeCandidatesAction({ caseIds: chosen, kind: o.kind, params }))
  }
  const onRemove = async () => {
    if (chosen.length === 0) return
    const ok = await confirm({ title: `안건 ${chosen.length}개가 선택되었어요`, description: '선택한 안건을 후보에서 뺄까요? 안건의 진행 상태는 그대로예요.', confirmLabel: '빼기', cancelLabel: '취소' })
    if (ok) run(() => removeCandidateAction({ caseIds: chosen }))
  }

  const wantsTeam = changeOptions.some((o) => o.kind === 'rework')
  const wantsLinked = askLinked && changeOptions.some((o) => o.kind === 'proceed')

  return (
    <div className="flex flex-col gap-3">
      {/* 안건 표: 왼쪽 체크박스, 맨 오른쪽 공헌이익 */}
      <div className="max-h-80 overflow-auto border border-default" style={{ borderRadius: 2 }}>
        <table className="border-collapse t-small" style={{ tableLayout: 'fixed', width: total }}>
          <colgroup>
            <col style={{ width: CHECK_W }} />
            {COLS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="border-b border-r border-default px-2 py-1.5 text-center">
                <input type="checkbox" aria-label="전체 선택" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(ids))} />
              </th>
              {COLS.map((c) => (
                <th key={c.key} className={`border-b border-r border-default px-3 py-1.5 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-default align-top ${selectedId === r.id ? 'bg-primary-soft' : 'hover:bg-surface'} ${r.mine ? '' : 'opacity-60'}`} aria-selected={selectedId === r.id} title={r.mine ? undefined : '내 역할로는 확정할 수 없는 후보예요 (볼 수는 있어요)'}>
                <td className="border-r border-default px-2 py-1.5 text-center">
                  <input type="checkbox" aria-label={`${r.title} 선택`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                {COLS.map((c) => {
                  const text = String(r[c.key] ?? '')
                  const extra = c.key === 'deadline' ? r.deadlineClass : c.key === 'profit' && r.profitNegative ? 'text-danger' : ''
                  return (
                    <td key={c.key} className={`border-r border-default p-0 ${c.key === 'title' ? 'font-semibold' : ''} ${c.align === 'right' ? 'text-right' : ''}`}>
                      <Link href={r.href} scroll={false} className={`block truncate whitespace-nowrap px-3 py-1.5 ${extra}`} title={text}>{text}</Link>
                    </td>
                  )
                })}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={COLS.length + 1} className="px-3 py-3 t-small">이 분류에 후보가 없어요.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 고른 안건의 수익성 검증 (안건 화면과 같은 화면) */}
      {selectedId ? children : (
        <div className="flex min-h-24 items-center justify-center border border-dashed border-default">
          <p className="t-small text-muted">안건을 누르면 수익성 검증이 여기에 나와요.</p>
        </div>
      )}

      {/* 처리 버튼 — 체크한 안건들에 한꺼번에 적용된다 */}
      <div className="flex flex-col gap-2 border border-default p-3" style={{ borderRadius: 2 }}>
        <p className="t-small font-semibold">
          체크한 안건 {chosen.length}건 <span className="t-caption font-normal">— 아래 버튼은 체크한 안건 모두에 적용돼요 (누르면 한 번 더 물어요)</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button isDisabled={pending || chosen.length === 0} onPress={onConfirm}>확정하기</Button>
          {changeOptions.map((o) => (
            <Button key={o.kind} variant="outline" isDisabled={pending || chosen.length === 0 || (o.kind === 'rework' && !team)} onPress={() => onChange(o)}>{o.label}로 변경하기</Button>
          ))}
          <Button variant="outline" data-color="danger" isDisabled={pending || chosen.length === 0} onPress={onRemove}>후보에서 빼기</Button>
        </div>
        {(wantsTeam || wantsLinked || changeOptions.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 t-small">
            {wantsTeam && (
              <label className="flex items-center gap-1">보완요청할 팀
                <select className="rounded-input border border-default bg-content px-2 py-1 t-small" value={team} onChange={(e) => setTeam(e.target.value)}>
                  {reworkTeams.map((t) => <option key={t.role} value={t.role}>{t.label}</option>)}
                </select>
              </label>
            )}
            {wantsLinked && (
              <label className="flex items-center gap-1">300억 배분
                <select className="rounded-input border border-default bg-content px-2 py-1 t-small" value={linked} onChange={(e) => setLinked(e.target.value as 'yes' | 'no')}>
                  <option value="no">대상 아님</option>
                  <option value="yes">검토 대상</option>
                </select>
              </label>
            )}
            <input
              className="min-w-64 max-w-md rounded-input border border-default bg-content px-2 py-1 t-small"
              placeholder="바꿀 때 남길 사유·내용 (선택)"
              maxLength={200}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              aria-label="바꿀 때 남길 사유"
            />
          </div>
        )}
      </div>
    </div>
  )
}
