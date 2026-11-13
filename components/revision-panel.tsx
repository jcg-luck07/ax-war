'use client'

// 수정 보고 — 승인 또는 부결 뒤에 사정이 바뀌어 금액만 달라질 때 쓴다.
// 원 계약금액과 원래 첨부는 그대로 보이게 두고(지우거나 고치지 않는다), 바뀐 금액과 추가 첨부만 더해 다시 보고한다.
//   금액 변동 5% 이내 → 최초로 결정한 승인권자에게 바로 보고 / 5% 초과 → 재무팀 절차부터 다시.
// 승인권한 기준을 넘나들어도 승인권자는 바뀌지 않는다.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@heroui/react'
import { useConfirm } from '@/components/ax'
import { digitsOnly, formatMoneyInput } from '@/lib/app/date-input'
import { fmtWon } from '@/lib/app/format'
import { REVISION_THRESHOLD, revisionRoute } from '@/lib/app/revision-rule'

export interface FileLink {
  href: string
  label: string
  size: number
}

export function RevisionPanel({
  caseId, amountLabel, originalAmount, currentAmount, approverLabel, originalFiles,
}: {
  caseId: number
  /** "계약 금액" 또는 "요청 금액" */
  amountLabel: string
  originalAmount: number
  currentAmount: number
  /** 최초로 결정한 승인권자 이름 */
  approverLabel: string
  originalFiles: FileLink[]
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const ref = useRef<HTMLInputElement>(null)
  const next = Number(amount)
  const valid = Number.isInteger(next) && next > 0 && (next !== currentAmount || reason.trim().length > 0)
  const { pct, route } = valid ? revisionRoute(currentAmount, next) : { pct: 0, route: 'direct' as const }

  // 확인창은 전환(start) 밖에서 기다려야 해요. 전환 안에서 기다리면 확인창을 띄우는 상태 변경이 전환이 끝날 때까지 미뤄져 버튼이 멈춰요.
  const submit = async () => {
      const ok = await confirm({
        title: '수정 보고하시겠습니까?',
        description: `${amountLabel} ${fmtWon(currentAmount)} → ${fmtWon(next)} (${(pct * 100).toFixed(1)}% ${next > currentAmount ? '증가' : '감소'})`,
        details: route === 'direct'
          ? `변동이 ${REVISION_THRESHOLD * 100}% 이내라 ${approverLabel}에게 바로 보고해요.`
          : `변동이 ${REVISION_THRESHOLD * 100}%를 넘어 재무팀 절차부터 다시 진행한 뒤 ${approverLabel}에게 보고해요.`,
        confirmLabel: '수정 보고',
        cancelLabel: '취소',
        variant: 'warning',
      })
      if (!ok) return
      send()
    }

  const send = () =>
    start(async () => {
      const fd = new FormData()
      fd.set('caseId', String(caseId))
      fd.set('newAmount', amount)
      fd.set('reason', reason)
      files.forEach((f) => fd.append('file', f))
      try {
        const res = await fetch('/api/revisions', { method: 'POST', body: fd })
        const r = (await res.json()) as { ok: boolean; message: string }
        if (r.ok) { toast.success(r.message); setAmount(''); setReason(''); setFiles([]); router.refresh() } else toast.danger(r.message)
      } catch {
        toast.danger('보고하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
      }
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="flex flex-col gap-1 border border-default p-2">
          <span className="t-caption">원 {amountLabel}{currentAmount !== originalAmount ? ' (최초)' : ''}</span>
          <strong className="t-body">{fmtWon(originalAmount)}</strong>
          {currentAmount !== originalAmount && <span className="t-caption">현재 {fmtWon(currentAmount)}</span>}
        </div>
        <span className="t-body font-semibold" aria-hidden="true">→</span>
        <label className="flex flex-col gap-1 t-small">
          <span className="font-semibold">수정 {amountLabel} (원)</span>
          <input
            className="rounded-input border border-default bg-content px-2 py-1 t-small"
            inputMode="numeric"
            placeholder={`현재 ${currentAmount.toLocaleString('ko-KR')}`}
            value={formatMoneyInput(digitsOnly(amount))}
            onChange={(e) => setAmount(digitsOnly(e.target.value))}
          />
        </label>
      </div>
      {valid && (
        <p className="t-small">
          변동 <strong>{(pct * 100).toFixed(1)}%</strong> {next > currentAmount ? '증가' : '감소'} →{' '}
          {route === 'direct' ? <>5% 이내라 <strong>{approverLabel}</strong>에게 바로 보고해요.</> : <>5%를 넘어 <strong>재무팀 절차부터 다시</strong> 거친 뒤 {approverLabel}에게 보고해요.</>}
          <span className="t-caption"> 금액이 승인권한 기준을 넘나들어도 승인권자는 바뀌지 않아요.</span>
        </p>
      )}

      <div className="flex flex-col gap-1 border-t border-default pt-2">
        <span className="t-small font-semibold">원래 첨부 파일 <span className="t-caption">(그대로 두고 지우거나 고치지 않아요)</span></span>
        {originalFiles.length === 0 ? (
          <p className="t-caption">원래 첨부된 파일이 없어요.</p>
        ) : (
          originalFiles.map((f) => (
            <a key={f.href} className="border-b border-default py-1 t-small underline" href={f.href}>
              {f.label} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
            </a>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-default pt-2">
        <span className="t-small font-semibold">추가 첨부 <span className="t-caption">(바뀐 계약서 등 — 원래 파일에 더해서 등록돼요)</span></span>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={ref} type="file" multiple hidden onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 5)); e.target.value = '' }} />
          <Button size="sm" variant="secondary" isDisabled={pending || files.length >= 5} onPress={() => ref.current?.click()}>파일 선택</Button>
          <span className="t-caption">5개까지, 파일당 8MB</span>
        </div>
        {files.map((f, i) => (
          <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 border-b border-default py-1">
            <span className="min-w-0 truncate t-small" title={f.name}>{f.name}</span>
            <Button size="sm" variant="outline" aria-label={`${f.name} 빼기`} onPress={() => setFiles((list) => list.filter((_, j) => j !== i))}>삭제</Button>
          </div>
        ))}
      </div>

      <label className="flex flex-col gap-1 t-small">
        <span className="font-semibold">수정 사유 (선택)</span>
        <input className="max-w-xl rounded-input border border-default bg-content px-2 py-1 t-small" maxLength={300} placeholder="예: 상대방이 고정 피 인하를 제안" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div>
        <Button isDisabled={pending || !valid} onPress={submit}>수정 보고</Button>
      </div>
    </div>
  )
}
