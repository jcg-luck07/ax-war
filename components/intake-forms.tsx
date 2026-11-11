'use client'

// 안건 접수 화면의 조각: 팀원의 안건 제출 폼(파일 첨부 + 공헌이익 계산), 팀장의 접수 체크리스트.
// 무엇을 할 수 있는지는 서버가 정해서 넘겨주고(allowed), 실제 권한·필수 항목 확인은 서버가 다시 한다.
import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@heroui/react'
import { acceptSubmissionAction, returnSubmissionAction } from '@/app/actions'
import { CONTRIBUTION_FIELDS, CONTRIBUTION_FORMULA, calcContribution, validateContribution } from '@/lib/metrics/contribution-calc'

export interface CategoryView {
  id: string
  label: string
  refLabel: string
  idRule: string
  allowed: boolean
  /** 접수 권한자 이름 (예: 마케팅 팀장) */
  acceptLabel: string
  fields: { name: string; label: string; type: 'text' | 'number' | 'date'; required?: boolean; placeholder?: string }[]
  options: { id: string; label: string }[]
  /** 신규 ID 로 넣을 때 제안하는 다음 번호 (예: INF-011) */
  nextId: string
  /** 신규 ID 앞부분 (예: INF-) — 분류를 고르면 자동으로 적히고, 사용자는 뒤의 숫자만 쓴다 */
  idPrefix: string
  idDigits: number
  /** 캠페인의 소속 인플루언서 선택지 (신규 캠페인일 때) */
  parents: { id: string; label: string }[]
}

export interface KindView {
  id: string
  label: string
  required: boolean
}

/** 숫자만 쳐도 YYYY-MM-DD 로 만들어 준다 (하이픈은 자동) */
const formatDate = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d
}
const NEW = '__new__'
// 첨부서류 한 줄: 종류 이름 | 파일 선택 | (지우기) — 고정 칸과 직접 추가 칸이 같은 모양
const ROW = 'grid grid-cols-[13rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-default py-1.5 max-w-4xl'
const INPUT = 'rounded-input border border-default bg-content px-2 py-1 t-small w-full'
const MAN = 10_000
const fmtMan = (won: number) => `${Math.round(won / MAN).toLocaleString('ko-KR')}만 원`
const fmtRoas = (r: number | null) => (r === null ? '계산 불가' : `${r.toFixed(2)}배`)

/** 파일 선택 버튼 — 숨겨 둔 파일 입력을 버튼으로 연다. 여러 파일 선택 가능 */
function FilePick({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <input ref={ref} type="file" multiple hidden onChange={(e) => { onChange(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      <Button size="sm" variant="secondary" className="shrink-0" onPress={() => ref.current?.click()}>파일 선택</Button>
      <span className="t-caption min-w-0 truncate" title={files.map((f) => f.name).join(', ')}>{files.length > 0 ? files.map((f) => f.name).join(', ') : '선택된 파일 없음'}</span>
    </span>
  )
}

export function SubmitForm({ categories, kinds }: { categories: CategoryView[]; kinds: KindView[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [catId, setCatId] = useState('')
  const [refId, setRefId] = useState('')
  const [vals, setVals] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, File[]>>({})
  // 직접 종류 이름을 적어 추가하는 첨부 (+ 버튼)
  const [extras, setExtras] = useState<{ label: string; files: File[] }[]>([])
  const [formKey, setFormKey] = useState(0)
  const cat = categories.find((c) => c.id === catId)
  const isNew = refId === NEW
  const newDigits = (vals.newId ?? '').replace(/\D/g, '').slice(0, cat?.idDigits ?? 4)
  const newIdFull = cat ? `${cat.idPrefix}${newDigits.padStart(cat.idDigits, '0')}` : ''
  const set = (k: string) => (v: string) => setVals((s) => ({ ...s, [k]: v }))

  const contribKeys = CONTRIBUTION_FIELDS.map((f) => f.key)
  const calcRaw = Object.fromEntries(contribKeys.map((k) => [k, vals[`${k}Man`] ?? '']))
  const calcError = validateContribution({ ...calcRaw, marketingSpend: vals.requestedMan ?? '' }, contribKeys)
  const result = useMemo(() => {
    if (calcError || !(Number(vals.requestedMan) > 0)) return null
    const n = (k: string) => Number(vals[`${k}Man`]) * MAN
    return calcContribution({ gmv: n('gmv'), refund: n('refund'), cogs: n('cogs'), channelFee: n('channelFee'), shipping: n('shipping'), returnLogistics: n('returnLogistics'), marketingSpend: Number(vals.requestedMan) * MAN })
  }, [vals, calcError])

  // 아직 남은 것 — 모두 채워야 제출할 수 있다
  const todo: string[] = []
  // 신규 인플루언서는 현 계약이 없어 '현 계약 만료일' 칸이 필요 없다
  const visibleFields = (cat?.fields ?? []).filter((f) => !(isNew && f.name === 'currentExpiry'))
  if (cat) {
    if (!refId) todo.push(cat.refLabel)
    if (isNew) {
      if (!newDigits || Number(newDigits) === 0) todo.push('신규 ID 번호')
      if (!(vals.refName ?? '').trim()) todo.push('신규 이름')
      if (cat.id === 'campaign' && !(vals.parentInfluencerId ?? '')) todo.push('소속 인플루언서')
    }
    for (const f of visibleFields) if (f.required && !(vals[f.name] ?? '').trim()) todo.push(f.label)
    if (calcError) todo.push('공헌이익 계산 칸')
    for (const k of kinds) if (k.required && !(files[k.id]?.length)) todo.push(`첨부: ${k.label}`)
    extras.forEach((x, i) => { if (!x.label.trim() || x.files.length === 0) todo.push(`추가 첨부 ${i + 1}: ${!x.label.trim() ? '종류 이름' : '파일'}`) })
  }

  const submit = () =>
    start(async () => {
      if (!cat) return
      const fd = new FormData()
      fd.set('category', cat.id)
      fd.set('refId', isNew ? newIdFull : refId)
      if (isNew) fd.set('v:isNewRef', '1')
      for (const [k, v] of Object.entries(vals)) fd.set(`v:${k}`, v)
      for (const [kind, list] of Object.entries(files)) list.forEach((f, i) => fd.append(`f:${kind}#${i}`, f))
      extras.forEach((x, i) => { fd.set(`cl:${i}`, x.label.trim()); x.files.forEach((f, j) => fd.append(`cf:${i}#${j}`, f)) })
      try {
        const res = await fetch('/api/submissions', { method: 'POST', body: fd })
        const r = (await res.json()) as { ok: boolean; message: string }
        if (r.ok) {
          toast.success(r.message)
          setRefId(''); setVals({}); setFiles({}); setExtras([]); setFormKey((x) => x + 1)
          router.refresh()
        } else toast.danger(r.message)
      } catch {
        toast.danger('보고하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
      }
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="t-small font-semibold">안건 종류</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="안건 종류">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={catId === c.id}
              disabled={!c.allowed}
              onClick={() => { setCatId(c.id); setRefId(''); setVals({}); setFiles({}); setExtras([]); setFormKey((x) => x + 1) }}
              className={`rounded-input border px-3 py-1.5 t-small ${catId === c.id ? 'border-primary bg-primary-soft font-semibold' : 'border-default'} ${c.allowed ? '' : 'opacity-50'}`}
            >
              {c.label}{c.allowed ? '' : ' (권한필요)'}
            </button>
          ))}
        </div>
      </div>

      {cat && (
        <div key={formKey} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 t-small">
              <span className="font-semibold">{cat.refLabel} <span className="t-caption">({cat.idRule}, 전사 ID 규칙)</span></span>
              <select className={INPUT} value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">{cat.refLabel}를 고르세요</option>
                {cat.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                <option value={NEW}>➕ 신규 ID 입력 (원본에 없는 {cat.refLabel.replace(' ID', '')})</option>
              </select>
            </label>
            {isNew && (
              <>
                <label className="flex flex-col gap-1 t-small">
                  <span className="font-semibold">신규 {cat.refLabel} * <span className="t-caption">(뒤 숫자만 입력, 제안: {cat.nextId.slice(cat.idPrefix.length)})</span></span>
                  <span className="flex items-stretch">
                    <span className={`${INPUT} w-auto bg-muted font-semibold`} style={{ borderRight: 0 }}>{cat.idPrefix}</span>
                    <input className={INPUT} inputMode="numeric" maxLength={cat.idDigits} placeholder={'0'.repeat(cat.idDigits)} value={newDigits} onChange={(e) => set('newId')(e.target.value.replace(/\D/g, ''))} aria-label={`신규 ${cat.refLabel} 번호`} />
                  </span>
                  {newDigits && <span className="t-caption">등록될 ID: {newIdFull}</span>}
                </label>
                <label className="flex flex-col gap-1 t-small">
                  <span className="font-semibold">신규 {cat.refLabel.replace(' ID', '')} 이름 *</span>
                  <input className={INPUT} value={vals.refName ?? ''} onChange={(e) => set('refName')(e.target.value)} />
                </label>
                {cat.id === 'campaign' && (
                  <label className="flex flex-col gap-1 t-small">
                    <span className="font-semibold">소속 인플루언서 *</span>
                    <select className={INPUT} value={vals.parentInfluencerId ?? ''} onChange={(e) => set('parentInfluencerId')(e.target.value)}>
                      <option value="">고르세요</option>
                      {cat.parents.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      <option value="NONE">해당 없음 (NONE)</option>
                    </select>
                  </label>
                )}
              </>
            )}
            {visibleFields.map((f) => (
              <label key={f.name} className="flex flex-col gap-1 t-small">
                <span className="font-semibold">{f.label} *</span>
                <input
                  className={INPUT}
                  inputMode={f.type === 'number' || f.type === 'date' ? 'numeric' : undefined}
                  maxLength={f.type === 'date' ? 10 : undefined}
                  placeholder={f.type === 'date' ? 'YYYY-MM-DD (숫자만 입력)' : f.placeholder}
                  value={vals[f.name] ?? ''}
                  onChange={(e) => set(f.name)(f.type === 'date' ? formatDate(e.target.value) : e.target.value)}
                />
              </label>
            ))}
            <label className="flex flex-col gap-1 t-small sm:col-span-2 lg:col-span-3">
              <span className="font-semibold">메모</span>
              <input className={INPUT} placeholder="팀장에게 전할 내용, 특이사항" value={vals.memo ?? ''} onChange={(e) => set('memo')(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-col gap-1 border-t border-default pt-2">
            <span className="t-small font-semibold">첨부서류</span>
            <div className="flex flex-col">
              {kinds.map((k) => (
                <div key={k.id} className={ROW}>
                  <span className="t-small">{k.label} {k.required ? <span className="text-danger">*</span> : <span className="t-caption">(선택)</span>}</span>
                  <FilePick files={files[k.id] ?? []} onChange={(list) => setFiles((x) => ({ ...x, [k.id]: list }))} />
                  <span />
                </div>
              ))}
              {extras.map((x, i) => (
                <div key={i} className={ROW}>
                  <input
                    className={INPUT}
                    placeholder="첨부 종류 이름 (직접 적기)"
                    maxLength={30}
                    value={x.label}
                    aria-label={`추가 첨부 ${i + 1} 종류 이름`}
                    onChange={(e) => setExtras((list) => list.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))}
                  />
                  <FilePick files={x.files} onChange={(fl) => setExtras((list) => list.map((y, j) => (j === i ? { ...y, files: fl } : y)))} />
                  <Button size="sm" variant="outline" onPress={() => setExtras((list) => list.filter((_, j) => j !== i))} aria-label={`추가 첨부 ${i + 1} 지우기`}>지우기</Button>
                </div>
              ))}
            </div>
            <div>
              <Button size="sm" variant="outline" onPress={() => setExtras((list) => [...list, { label: '', files: [] }])}>+ 첨부 추가</Button>
            </div>
            <p className="t-caption">pdf·문서·표·이미지·메일(eml, msg) 등, 파일당 8MB 까지.</p>
          </div>

          <div className="flex flex-col gap-2 border-t border-default pt-2">
            <span className="t-small font-semibold">공헌이익 계산 <span className="t-caption">(모두 만 원 단위, 해당 없으면 0)</span></span>
            <p className="t-caption">{CONTRIBUTION_FORMULA}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CONTRIBUTION_FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 t-small">
                  <span>{f.label} *</span>
                  <input className={INPUT} inputMode="decimal" placeholder={f.hint} value={vals[`${f.key}Man`] ?? ''} onChange={(e) => set(`${f.key}Man`)(e.target.value)} />
                </label>
              ))}
              <div className="flex flex-col gap-1 t-small">
                <span>마케팅 지출 <span className="t-caption">(= 요청금액, 자동)</span></span>
                <div className={`${INPUT} bg-muted`}>{vals.requestedMan ? `${Number(vals.requestedMan).toLocaleString('ko-KR')}만 원` : '요청금액을 입력하세요'}</div>
              </div>
            </div>
            <div className="rounded-card border border-default p-2">
              {result ? (
                <div className="flex flex-wrap gap-x-8 gap-y-1 t-small">
                  <span>순매출 <strong>{fmtMan(result.netRevenue)}</strong></span>
                  <span>공헌이익 <strong className={result.contributionProfit < 0 ? 'text-danger' : ''}>{fmtMan(result.contributionProfit)}</strong></span>
                  <span>실질 ROAS <strong>{fmtRoas(result.realRoas)}</strong></span>
                  <span>명목 ROAS <strong>{fmtRoas(result.nominalRoas)}</strong></span>
                  <span>반품률 <strong>{result.returnRate === null ? '-' : `${(result.returnRate * 100).toFixed(1)}%`}</strong></span>
                </div>
              ) : (
                <span className="t-caption">칸을 모두 채우면 공헌이익이 계산돼요.{calcError && Object.values(calcRaw).some(Boolean) ? ` (${calcError})` : ''}</span>
              )}
              <p className="mt-1 t-caption">입력값은 예상(추계)이라 실제 성과가 아니에요. 안건에는 [가정·추계]로 남아요.</p>
            </div>
          </div>

          <div className="flex flex-col gap-1 border-t border-default pt-2">
            {todo.length > 0 && <p className="t-caption">아직 남은 것: {todo.join(' · ')}</p>}
            <div>
              <Button isDisabled={pending || todo.length > 0} onPress={submit}>
                {cat.acceptLabel}에게 보고하기
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export interface ReviewRow {
  /** 체크 항목이면 id (없으면 보기만 하는 줄) */
  id?: string
  label: string
  value: ReactNode
  /** 마우스를 올리면 보이는 확인 내용 */
  hint?: string
}
export interface ReviewSection {
  title: string
  rows: ReviewRow[]
}

/** 팀장의 접수 검토 — 확인할 값이 있는 줄마다 왼쪽에 체크박스가 있고, 모두 체크해야 접수 버튼이 켜진다. 한 줄씩, 폭은 중간 정도로. */
export function AcceptReview({ id, sections }: { id: number; sections: ReviewSection[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [on, setOn] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState('')
  const ids = sections.flatMap((s) => s.rows.filter((r) => r.id).map((r) => r.id as string))
  const done = ids.filter((x) => on[x]).length
  const all = done === ids.length

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn()
      if (r.ok) { toast.success(r.message); router.push('/intake?tab=accept'); router.refresh() } else toast.danger(r.message)
    })

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="t-small font-semibold">접수 검토 — 각 항목을 확인하고 왼쪽에 체크하세요</span>
        <span className="t-caption">{done} / {ids.length} 확인</span>
      </div>
      {sections.map((sec) => (
        <div key={sec.title} className="flex flex-col">
          <span className="border-b border-default pb-1 t-small font-semibold">{sec.title}</span>
          {sec.rows.map((r, i) => (
            <label key={r.id ?? `${sec.title}-${i}`} title={r.hint} className={`grid grid-cols-[1.25rem_9.5rem_minmax(0,1fr)] items-center gap-2 border-b border-default py-1 ${r.id ? 'cursor-pointer' : ''} ${r.id && on[r.id] ? 'bg-success-soft' : ''}`}>
              {r.id ? (
                <input type="checkbox" checked={!!on[r.id]} onChange={(e) => setOn((s) => ({ ...s, [r.id as string]: e.target.checked }))} aria-label={`${r.label} 확인`} />
              ) : (
                <span />
              )}
              <span className="t-caption">{r.label}</span>
              <span className="t-small min-w-0">{r.value}</span>
            </label>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button isDisabled={pending || !all} onPress={() => run(() => acceptSubmissionAction({ id, checked: ids.filter((x) => on[x]) }))}>
          안건 접수
        </Button>
        {!all && <span className="t-caption">모든 항목을 확인해야 접수할 수 있어요.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-default pt-2">
        <input className={`${INPUT} max-w-xs`} placeholder="반려 사유 (선택)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="반려 사유" />
        <Button size="sm" variant="outline" isDisabled={pending} onPress={() => run(() => returnSubmissionAction({ id, note }))}>반려 (팀원에게 돌려보냄)</Button>
      </div>
    </div>
  )
}
