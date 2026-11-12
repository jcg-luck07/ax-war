'use client'

// 부서 사이 회부 화면 — 재무팀(300억 배분 대상 확인 → 성과·비용표 취합 → 회부), 계약 담당(계약서 첨부 + 조건·기한 확인 → 회부).
// 승인권자 앞 단계의 회부는 두 가지 중 하나를 골라요: ① 이전에 거쳐 온 팀에 보완요청 ② 다음 팀으로 절차진행.
// 해당 부서의 사람에게만 서버가 이 패널을 그려 준다. 실제 권한은 서버 동작이 다시 확인한다.
import { useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@heroui/react'
import { completeTaskAction, contractReferAction, financeReferAction, nonrenewalRequestAction, reworkRequestAction } from '@/app/actions'
import { NumberedList } from '@/components/NumberedList'
import { useConfirm } from '@/components/ax'

export interface CheckItem {
  key: string
  title: string
  body: ReactNode
}

/** 올린 파일 한 줄: 내려받기 링크 + 빼기 버튼 */
function CaseFileRow({ f, onRemoved }: { f: { id: number; filename: string; size: number }; onRemoved: () => void }) {
  const [pending, start] = useTransition()
  return (
    <div className="flex items-center justify-between gap-2 border-b border-default py-1">
      <a className="min-w-0 truncate t-small underline" href={`/api/case-files/${f.id}`} title={f.filename}>
        {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
      </a>
      <Button
        size="sm"
        variant="outline"
        isDisabled={pending}
        aria-label={`${f.filename} 빼기`}
        onPress={() => start(async () => {
          try {
            const res = await fetch(`/api/case-files/${f.id}`, { method: 'DELETE' })
            const r = (await res.json()) as { ok: boolean; message: string }
            if (r.ok) { toast.success(r.message); onRemoved() } else toast.danger(r.message)
          } catch {
            toast.danger('빼지 못했어요. 잠시 뒤 다시 시도해 주세요.')
          }
        })}
      >
        삭제
      </Button>
    </div>
  )
}

/** 빠진 자료 안내 — 있어야 하는데 아직 없는 자료를 빨간 테두리 상자로 알려 준다 */
function MissingBox({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-1 border border-danger p-2" style={{ borderRadius: 2 }}>
      <span className="t-small font-semibold text-danger">빠진 자료 {items.length}건</span>
      {items.map((m, i) => <p key={i} className="t-small">{i + 1}. {m}</p>)}
    </div>
  )
}

export interface TeamOption {
  role: string
  label: string
}

/** "로/으로" 조사 — 받침이 없거나 ㄹ 받침이면 "로", 그 밖에는 "으로" */
export function euro(label: string): string {
  const ch = label.trim().slice(-1)
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return `${label}(으)로`
  const jong = code % 28
  return jong === 0 || jong === 8 ? `${label}로` : `${label}으로`
}

/** 항목마다 왼쪽에 체크박스가 있는 체크리스트. */
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
 * 회부 방향 고르기 — "○○팀으로 보완요청하기"(이전에 거쳐 온 팀 중 드롭다운) / "○○팀으로 절차진행"(자동으로 다음 팀).
 * 고른 방향에 맞는 "○○팀으로 회부하기" 버튼 하나로 처리한다.
 */
function RouteChoice({
  caseId, fromKey, teams, nextLabel, ready, notReadyHint, onProceed,
}: {
  caseId: number
  fromKey: 'collect-performance' | 'confirm-terms'
  teams: TeamOption[]
  nextLabel: string
  /** 절차진행에 필요한 확인(체크리스트 등)이 모두 끝났는가 */
  ready: boolean
  notReadyHint: string
  onProceed: () => Promise<{ ok: boolean; message: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<'' | 'rework' | 'proceed'>('')
  const [team, setTeam] = useState(teams[0]?.role ?? '')
  const [note, setNote] = useState('')
  const teamLabel = teams.find((t) => t.role === team)?.label ?? ''
  const disabled = pending || mode === '' || (mode === 'proceed' && !ready) || (mode === 'rework' && !team)
  const go = () =>
    start(async () => {
      const r = mode === 'proceed' ? await onProceed() : await reworkRequestAction({ caseId, fromKey, toRole: team, note })
      if (r.ok) { toast.success(r.message); router.refresh() } else toast.danger(r.message)
    })
  return (
    <div className="flex flex-col gap-2 border border-default p-2">
      <label className="flex cursor-pointer flex-wrap items-center gap-2 t-small">
        <input type="radio" name={`route-${caseId}-${fromKey}`} checked={mode === 'rework'} onChange={() => setMode('rework')} />
        <strong>보완요청하기</strong>
        <select
          className="rounded-input border border-default bg-content px-2 py-1 t-small"
          value={team}
          onChange={(e) => { setTeam(e.target.value); setMode('rework') }}
          aria-label="보완을 요청할 팀"
        >
          {teams.map((t) => <option key={t.role} value={t.role}>{t.label}</option>)}
        </select>
        <span className="t-caption">이전에 거쳐 온 팀 중에서 고르세요</span>
      </label>
      {mode === 'rework' && (
        <input
          className="max-w-xl rounded-input border border-default bg-content px-2 py-1 t-small"
          placeholder="보완할 내용 (선택)"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="보완 요청 내용"
        />
      )}
      <label className="flex cursor-pointer items-center gap-2 t-small">
        <input type="radio" name={`route-${caseId}-${fromKey}`} checked={mode === 'proceed'} onChange={() => setMode('proceed')} />
        <span><strong>{euro(nextLabel)} 절차진행</strong> <span className="t-caption">(다음 진행 팀으로 자동 선택돼요)</span></span>
      </label>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button isDisabled={disabled} onPress={go}>{mode === 'rework' ? `${euro(teamLabel)} 회부하기` : `${euro(nextLabel)} 회부하기`}</Button>
        {mode === '' && <span className="t-caption">보완요청과 절차진행 중 하나를 고르세요.</span>}
        {mode === 'proceed' && !ready && <span className="t-caption">{notReadyHint}</span>}
      </div>
    </div>
  )
}

/**
 * 재무팀의 다음 행동:
 *  1. 그룹 300억 배분 대상인지 확인 (승인권자를 정하는 더 앞선 결정)
 *  2. 성과·비용표 취합 — 항목마다 확인하고 체크
 *  3. 회부 — 보완요청(마케팅팀) 또는 절차진행(계약 담당)
 * beyondPeriod: 집행 예정일이 300억 집행 기준기간(6개월)을 넘으면 그 날짜 — 이때만 '대상 아님'이 자동 선택된다.
 */
export function FinanceReferItems({
  caseId, items, current, beyondPeriod, start, warning, teams, nextLabel, missing,
}: {
  caseId: number; items: CheckItem[]; current: boolean | null; beyondPeriod: { date: string; end: string } | null; start: number
  warning: string | null; teams: TeamOption[]; nextLabel: string; missing: string[]
}) {
  const confirm = useConfirm()
  const [linked, setLinked] = useState<'yes' | 'no' | ''>(beyondPeriod ? 'no' : current === true ? 'yes' : current === false ? 'no' : '')
  const [on, setOn] = useState<Record<string, boolean>>({})
  const done = items.filter((i) => on[i.key]).length
  const ready = linked !== '' && done === items.length
  const proceed = async () => {
    if (warning && !(await confirm({ title: '연관 안건에 부결이 있어요', description: warning, details: `그래도 ${euro(nextLabel)} 회부하시겠습니까?`, confirmLabel: '회부', cancelLabel: '취소', variant: 'warning' }))) {
      return { ok: false, message: '회부를 취소했어요.' }
    }
    return financeReferAction({ caseId, linked: linked === 'yes' })
  }
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
              <MissingBox items={missing} />
              <span className="t-caption">{done} / {items.length} 확인</span>
              <CheckList items={items} on={on} setOn={setOn} />
            </div>
          ),
        },
        {
          key: 'route',
          title: '회부 방향을 고르세요',
          body: (
            <RouteChoice
              caseId={caseId}
              fromKey="collect-performance"
              teams={teams}
              nextLabel={nextLabel}
              ready={ready}
              notReadyHint={`${linked === '' ? '300억 배분 대상 여부를 고르고, ' : ''}모든 항목을 체크해야 절차진행할 수 있어요.`}
              onProceed={proceed}
            />
          ),
        },
      ]}
    />
  )
}

/** 계약 담당: 계약조건·기한 확인 단계. 항목마다 체크하고 계약서를 첨부한 뒤, 보완요청 또는 절차진행(승인권자)으로 회부한다. */
export function ContractReferPanel({
  caseId, items, files, warning, teams, nextLabel, missing,
}: {
  caseId: number; items: CheckItem[]; files: { id: number; filename: string; size: number }[]; warning: string | null
  teams: TeamOption[]; nextLabel: string; missing: string[]
}) {
  const router = useRouter()
  const confirm = useConfirm()
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
  const proceed = async () => {
    if (warning && !(await confirm({ title: '연관 안건에 부결이 있어요', description: warning, details: `그래도 ${euro(nextLabel)} 회부하시겠습니까?`, confirmLabel: '회부', cancelLabel: '취소', variant: 'warning' }))) {
      return { ok: false, message: '회부를 취소했어요.' }
    }
    return contractReferAction({ caseId })
  }

  return (
    <div className="flex flex-col gap-2">
      <MissingBox items={missing} />
      <span className="t-caption">{done} / {items.length} 확인</span>
      <CheckList items={items} on={on} setOn={setOn} />
      <div className="flex flex-col gap-2 border-b border-default py-2">
        <span className="t-small font-semibold">계약서 첨부 <span className="t-caption">(본 계약서 — 계약 담당이 만든 계약서)</span></span>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={ref} type="file" multiple hidden onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <Button size="sm" variant="secondary" isDisabled={pending} onPress={() => ref.current?.click()}>계약서 파일 선택</Button>
          <span className="t-caption">pdf·문서·hwp·이미지 등, 파일당 8MB 까지</span>
        </div>
        {files.length === 0 ? (
          <p className="t-caption">첨부된 계약서가 없어요. 계약서를 첨부해야 절차진행할 수 있어요.</p>
        ) : (
          <div className="flex flex-col">
            {files.map((f) => <CaseFileRow key={f.id} f={f} onRemoved={() => router.refresh()} />)}
          </div>
        )}
      </div>
      <RouteChoice
        caseId={caseId}
        fromKey="confirm-terms"
        teams={teams}
        nextLabel={nextLabel}
        ready={ready}
        notReadyHint={`${files.length === 0 ? '계약서를 첨부하고, ' : ''}모든 항목을 체크해야 절차진행할 수 있어요.`}
        onProceed={proceed}
      />
    </div>
  )
}

/** 부결된 계약 안건: 계약 담당이 후속조치로 계약 미갱신 통지서의 결재를 보고한다 (승인권자가 다시 승인해야 발송할 수 있다). */
export function NonrenewalRequestPanel({ caseId, approverLabel, warning }: { caseId: number; approverLabel: string; warning: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div className="flex flex-col gap-2 border border-default p-2">
      {warning && <p className="t-caption text-danger">{warning}</p>}
      <p className="t-small">계약을 연장하지 않기로 했어요. 후속조치로 계약 미갱신 통지서의 결재를 보고하고, {approverLabel}이 다시 승인하면 통지서를 발송해요.</p>
      <div>
        <Button isDisabled={pending} onPress={() => start(async () => { const r = await nonrenewalRequestAction({ caseId }); if (r.ok) { toast.success(r.message); router.refresh() } else toast.danger(r.message) })}>
          {euro(approverLabel)} 미갱신 통지서 결재 보고
        </Button>
      </div>
    </div>
  )
}

/** 계약 담당의 마지막 단계(통보·회신 기록 보관): 상대방의 통보 회신 증빙을 붙이고 기록 보관을 끝낸다. */
export function RecordReplyPanel({ caseId, taskId, files }: { caseId: number; taskId: number; files: { id: number; filename: string; size: number }[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const ref = useRef<HTMLInputElement>(null)
  const upload = (list: File[]) => {
    if (list.length === 0) return
    start(async () => {
      const fd = new FormData()
      fd.set('caseId', String(caseId))
      fd.set('kind', 'notice')
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
  return (
    <div className="flex flex-col gap-2 border border-default p-2">
      <p className="t-small">상대방이 통보를 받았다는 회신(통보 수령 증빙)을 붙이고 기록 보관을 끝내세요.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={ref} type="file" multiple hidden onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <Button size="sm" variant="secondary" isDisabled={pending} onPress={() => ref.current?.click()}>통보 회신 증빙 파일 선택</Button>
        <span className="t-caption">pdf·문서·메일·이미지 등, 파일당 8MB 까지</span>
      </div>
      {files.length > 0 && (
        <div className="flex flex-col">
          {files.map((f) => <CaseFileRow key={f.id} f={f} onRemoved={() => router.refresh()} />)}
        </div>
      )}
      <div>
        <Button isDisabled={pending} onPress={() => start(async () => { const r = await completeTaskAction({ taskId }); if (r.ok) { toast.success(r.message); router.refresh() } else toast.danger(r.message) })}>
          기록 보관 완료
        </Button>
      </div>
    </div>
  )
}
