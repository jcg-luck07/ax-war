'use client'

// 안건 접수 화면의 조각: 팀원의 안건 제출 폼(파일 첨부 + 공헌이익 계산), 팀장의 접수 체크리스트.
// 무엇을 할 수 있는지는 서버가 정해서 넘겨주고(allowed), 실제 권한·필수 항목 확인은 서버가 다시 한다.
import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { digitsOnly, formatDateInput, formatMoneyInput } from '@/lib/app/date-input'
import { fmtWon } from '@/lib/app/format'
import { Button, toast } from '@heroui/react'
import { acceptSubmissionAction, returnSubmissionAction } from '@/app/actions'
import { DEAL_LABEL, DEAL_TYPES, nextCampaignName, uniqueTitle } from '@/lib/app/submission-title'
import { useConfirm } from '@/components/ax'
import { CONTRIBUTION_FIELDS, CONTRIBUTION_FORMULA, calcContribution, validateContribution } from '@/lib/metrics/contribution-calc'

export interface CategoryView {
  id: string
  label: string
  refLabel: string
  idRule: string
  allowed: boolean
  /** 접수 권한자 이름 (예: 마케팅 팀장) */
  acceptLabel: string
  fields: { name: string; label: string; type: 'text' | 'number' | 'date' | 'choice'; options?: string[]; required?: boolean; placeholder?: string }[]
  options: { id: string; label: string; name: string; product?: string }[]
  /** 신규 ID 로 넣을 때 제안하는 다음 번호 (예: INF-011) */
  nextId: string
  /** 신규 ID 앞부분 (예: INF-) — 분류를 고르면 자동으로 적히고, 사용자는 뒤의 숫자만 쓴다 */
  idPrefix: string
  idDigits: number
  /** 이미 쓰고 있는 분류 ID (원본 + 다른 신규 제출) — 신규로 같은 ID 를 넣으면 경고한다 */
  takenIds: string[]
  /** 캠페인의 소속 인플루언서 선택지 (신규 캠페인일 때) */
  parents: { id: string; label: string; name: string }[]
  /** 소속 인플루언서별 가장 큰 캠페인 번호 — 새 캠페인 이름은 그다음 번호 */
  campaignSeq: Record<string, number>
  /** 이미 있는 제목 (제출된 안건 + 안건) — 자동 제목이 겹치지 않게 번호를 붙인다 */
  takenTitles: string[]
  /** 제품 종류 선택지 (색조·기초 …) */
  productLines: string[]
}

export interface KindView {
  id: string
  label: string
  required: boolean
  /** 이 분류(예: influencer)에서만 필수 */
  requiredFor?: string[]
  /** 원본에 이미 있는 대상(갱신·확대)일 때만 받고 그때는 필수 — 신규 ID 는 칸이 없다 */
  existingOnly?: boolean
}

/** 숫자만 쳐도 YYYY-MM-DD 로 만들어 준다 (하이픈은 자동) */
const formatDate = formatDateInput
const NEW = '__new__'
// 첨부서류 한 줄: 종류 이름 | 파일 선택 | (지우기) — 고정 칸과 직접 추가 칸이 같은 모양
const ROW = 'grid grid-cols-[13rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-default py-1.5 max-w-4xl'
const INPUT = 'rounded-input border border-default bg-content px-2 py-1 t-small w-full'
const fmtRoas = (r: number | null) => (r === null ? '계산 불가' : `${r.toFixed(2)}배`)

/** 파일 선택 버튼 — 숨겨 둔 파일 입력을 버튼으로 연다. 여러 파일 선택 가능 */
/** 파일 고르기 — 고를 때마다 목록에 더해지고, 잘못 올린 파일은 파일마다 있는 "삭제"로 뺄 수 있다 */
function FilePick({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <input ref={ref} type="file" multiple hidden onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />
      <Button size="sm" variant="secondary" className="shrink-0" onPress={() => ref.current?.click()}>파일 선택</Button>
      {files.length === 0 && <span className="t-caption">선택된 파일 없음</span>}
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="flex min-w-0 items-center gap-1 border border-default px-2 py-0.5 t-caption" style={{ borderRadius: 2 }}>
          <span className="min-w-0 max-w-64 truncate" title={f.name}>{f.name}</span>
          <button type="button" className="shrink-0 font-semibold text-danger underline" aria-label={`${f.name} 삭제`} onClick={() => onChange(files.filter((_, j) => j !== i))}>삭제</button>
        </span>
      ))}
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
  // 필수 항목을 채우지 않고 제출하기 — 켜면 비어 있어도 제출할 수 있고, 누를 때 한 번 더 묻는다
  const [allowInc, setAllowInc] = useState(false)
  // 첨부문서를 AI 로 읽어 빈칸 채우기: 채운 칸(이름 → 어디서 읽었는지), 읽은 결과 안내
  const [aiFilled, setAiFilled] = useState<Record<string, string>>({})
  const [reading, setReading] = useState(false)
  const [aiReport, setAiReport] = useState<{ filled: number; differs: { label: string; typed: string; doc: string }[]; warnings: string[]; skipped: string[]; tokens: string; model: string } | null>(null)
  const confirm = useConfirm()
  const cat = categories.find((c) => c.id === catId)
  const isNew = refId === NEW
  const newDigits = (vals.newId ?? '').replace(/\D/g, '').slice(0, cat?.idDigits ?? 4)
  const newIdFull = cat ? `${cat.idPrefix}${newDigits.padStart(cat.idDigits, '0')}` : ''
  const idTaken = Boolean(cat && isNew && newDigits && cat.takenIds.includes(newIdFull))
  // 직접 고친 칸은 더 이상 "AI 가 채움"이 아니다
  const set = (k: string) => (v: string) => { setVals((s) => ({ ...s, [k]: v })); setAiFilled((a) => (k in a ? Object.fromEntries(Object.entries(a).filter(([x]) => x !== k)) : a)) }
  /** AI 가 채운 칸은 테두리를 달리해 눈에 띄게 하고, 어디서 읽었는지 마우스를 올리면 보인다 */
  const ai = (k: string) => (aiFilled[k] !== undefined ? ' border-primary bg-primary-soft' : '')
  const aiTitle = (k: string) => (aiFilled[k] !== undefined ? `AI 가 읽은 곳: ${aiFilled[k] || '첨부서류'} — 꼭 확인하세요` : undefined)

  const contribKeys = CONTRIBUTION_FIELDS.map((f) => f.key)
  const calcRaw = Object.fromEntries(contribKeys.map((k) => [k, vals[k] ?? '']))
  // 인플루언서 계약은 계약 방식에 따른 고정 피 + 성과 피가 요청금액이다
  const feeType = vals.feeType ?? ''
  const needFixed = feeType === '고정 피' || feeType === '혼합 피'
  const needPerf = feeType === '성과 피' || feeType === '혼합 피'
  const requestedStr = cat?.id === 'influencer'
    ? String((needFixed ? Number(vals.fixedFee || 0) : 0) + (needPerf ? Number(vals.performanceFee || 0) : 0) || '')
    : (vals.requested ?? '')
  const calcError = validateContribution({ ...calcRaw, marketingSpend: requestedStr }, contribKeys)
  const result = useMemo(() => {
    if (calcError || !(Number(requestedStr) > 0)) return null
    const n = (k: string) => Number(vals[k])
    return calcContribution({ gmv: n('gmv'), refund: n('refund'), cogs: n('cogs'), channelFee: n('channelFee'), shipping: n('shipping'), returnLogistics: n('returnLogistics'), marketingSpend: Number(requestedStr) })
  }, [vals, calcError, requestedStr])

  // 아직 남은 것 — 모두 채워야 제출할 수 있다
  const todo: string[] = []
  const deal = isNew ? '신규' : (vals.dealType ?? '')
  const dealChosen = Boolean(deal)
  const isRequired = (k: KindView) => k.required || Boolean(cat && k.requiredFor?.includes(cat.id)) || Boolean(k.existingOnly && !noOld)
  // 신규 ID 는 맺은 계약이 없어 '기존 계약서' 칸을 보여 주지 않는다
  // 첨부서류는 구분(신규/갱신·확대)을 먼저 정해야 보인다 — 신규는 기존 계약서가 없어 그 칸이 빠진다
  const noOld = isNew || deal === '신규'
  const shownKinds = dealChosen ? kinds.filter((k) => !(k.existingOnly && noOld)) : []
  // 신규 인플루언서는 현 계약이 없어 '현 계약 만료일' 칸이 필요 없다
  // 구분: 새 ID 는 항상 "신규" (확대·갱신은 이미 있는 대상에 대해서만)
  const dealOptions = cat ? DEAL_TYPES[cat.id] ?? [] : []
  const picked = cat?.options.find((o) => o.id === refId)
  const productLine = cat?.id === 'campaign' ? (isNew ? (vals.productLine ?? '') : (picked?.product ?? '')) : ''
  // 대상 이름: 새 캠페인은 "인플루언서 제품종류 캠페인N"(자동), 새 인플루언서는 적은 이름, 기존 대상은 원본 이름
  const parentId = vals.parentInfluencerId ?? ''
  const parentName = cat?.parents.find((o) => o.id === parentId)?.name ?? ''
  const newCampaignName = cat?.id === 'campaign' && isNew && parentId && productLine ? nextCampaignName(parentName, productLine, cat.campaignSeq[parentId] ?? 0) : ''
  const targetName = !cat ? '' : cat.id === 'campaign' ? (isNew ? newCampaignName : picked?.name ?? '') : isNew ? ((vals.refName ?? '').trim() && newDigits ? `${(vals.refName ?? '').trim()}(${newIdFull})` : '') : picked ? `${picked.name}(${picked.id})` : ''
  const autoTitle = cat && targetName && deal
    ? uniqueTitle({ category: cat.id, name: targetName, deal, feeType: feeType || undefined, amountText: requestedStr ? `${Number(requestedStr).toLocaleString('ko-KR')}원` : '금액 미입력' }, cat.takenTitles)
    : ''
  // 신규 계약(새 인플루언서이거나 구분이 "신규")은 현 계약이 없어 '현 계약 만료일' 칸이 필요 없다
  const visibleFields = (cat?.fields ?? []).filter((f) => !((isNew || deal === '신규') && (f.name === 'currentExpiry' || f.name === 'autoRenew')))
  if (cat) {
    if (!refId) todo.push(cat.refLabel)
    if (!deal) todo.push(DEAL_LABEL[cat.id])
    if (cat.id === 'campaign' && isNew && !productLine) todo.push('제품 종류')
    if (isNew) {
      if (!newDigits || Number(newDigits) === 0) todo.push('신규 ID 번호')
      if (idTaken) todo.push('이미 있는 분류ID')
      if (cat.id === 'influencer' && !(vals.refName ?? '').trim()) todo.push('신규 인플루언서 이름')
      if (cat.id === 'campaign' && !(vals.parentInfluencerId ?? '')) todo.push('소속 인플루언서')
    }
    for (const f of visibleFields) if (f.required && !(vals[f.name] ?? '').trim()) todo.push(f.label)
    if (cat.id === 'influencer') {
      if (!feeType) todo.push('계약 방식')
      if (needFixed && !(Number(vals.fixedFee) > 0)) todo.push('고정 피 금액')
      if (needPerf && !(Number(vals.performanceFee) > 0)) todo.push('성과 피 금액')
    }
    if (calcError) todo.push('공헌이익 계산 칸')
    for (const k of shownKinds) if (isRequired(k) && !(files[k.id]?.length)) todo.push(`첨부: ${k.label}`)
    extras.forEach((x, i) => { if (!x.label.trim() || x.files.length === 0) todo.push(`추가 첨부 ${i + 1}: ${!x.label.trim() ? '종류 이름' : '파일'}`) })
  }

  // 확인창은 전환(start) 밖에서 기다려야 해요. 전환 안에서 기다리면 확인창을 띄우는 상태 변경이 전환이 끝날 때까지 미뤄져 버튼이 멈춰요.
  const submit = async () => {
    if (!cat) return
    if (todo.length > 0) {
      const ok = await confirm({
        title: '정말 제출하시겠습니까?',
        description: '필수 항목이 비어 있어요. 이대로 제출하면 팀장이 접수할 수 없고 반려될 수 있어요.',
        details: <ul className="list-disc pl-5 t-small">{todo.map((x) => <li key={x}>{x}</li>)}</ul>,
        confirmLabel: '제출',
        cancelLabel: '취소',
        variant: 'warning',
      })
      if (!ok) return
    }
    send(cat)
  }

  const readDocs = async () => {
    if (!cat) return
    const fileCount = Object.entries(files).filter(([k]) => shownKinds.some((x) => x.id === k)).reduce((n, [, l]) => n + l.length, 0) + extras.reduce((n, x) => n + x.files.length, 0)
    if (fileCount === 0) return
    const ok = await confirm({
      title: '첨부서류를 AI 로 읽을까요?',
      description: `첨부한 서류 ${fileCount}개가 Claude API 로 전송돼 읽혀요. 호출마다 비용이 들고 수십 초 걸려요. 채워진 칸은 꼭 확인한 뒤 제출하세요. (이미 적은 칸은 덮어쓰지 않아요)`,
      confirmLabel: '읽기',
      cancelLabel: '취소',
    })
    if (!ok) return
    const fd = new FormData()
    fd.set('category', cat.id)
    const shownIds = new Set(shownKinds.map((k) => k.id))
    for (const [kind, list] of Object.entries(files)) if (shownIds.has(kind)) list.forEach((f, i) => fd.append(`f:${kind}#${i}`, f))
    extras.forEach((x, i) => { fd.set(`cl:${i}`, x.label.trim()); x.files.forEach((f, j) => fd.append(`cf:${i}#${j}`, f)) })
    setReading(true)
    try {
      const res = await fetch('/api/submissions/extract', { method: 'POST', body: fd })
      const r = (await res.json()) as {
        ok: boolean; message?: string; values?: Record<string, string>; evidence?: Record<string, string>; warnings?: string[]; skipped?: string[]; model?: string; inputTokens?: number; outputTokens?: number
      }
      if (!r.ok) { toast.danger(r.message ?? '서류를 읽지 못했어요.'); return }
      applyExtracted(cat, r.values ?? {}, r.evidence ?? {})
      setAiReport((prev) => ({ ...(prev ?? { filled: 0, differs: [], tokens: '', model: '' }), warnings: r.warnings ?? [], skipped: r.skipped ?? [], tokens: `입력 ${(r.inputTokens ?? 0).toLocaleString()} / 출력 ${(r.outputTokens ?? 0).toLocaleString()} 토큰`, model: r.model ?? '' }) as typeof aiReport)
    } catch {
      toast.danger('서류를 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    } finally {
      setReading(false)
    }
  }

  /** AI 가 뽑은 값을 빈칸에만 넣는다. 이미 적은 칸은 그대로 두고, 값이 다르면 안내만 한다. */
  const applyExtracted = (c: NonNullable<typeof categories[number]>, v: Record<string, string>, evidence: Record<string, string>) => {
    const next: Record<string, string> = {}
    const marks: Record<string, string> = {}
    const differs: { label: string; typed: string; doc: string }[] = []
    const label = (k: string) => c.fields.find((f) => f.name === k)?.label ?? ({ feeType: '계약 방식', fixedFee: '고정 피 금액', performanceFee: '성과 피 금액', performanceRate: '성과 피 비율', gmv: '예상 GMV', refund: '환불', cogs: '제품 원가', channelFee: '채널 수수료', shipping: '출고(배송)비', returnLogistics: '반품 물류비', memo: '메모', dealType: DEAL_LABEL[c.id], productLine: '제품 종류' } as Record<string, string>)[k] ?? k
    // 대상 ID: 아직 안 골랐으면 문서의 ID 로 고른다 (목록에 없으면 신규 ID 로)
    let nowNew = isNew
    if (!refId && v.refId) {
      const known = c.options.some((o) => o.id === v.refId)
      if (known) setRefId(v.refId)
      else if (v.refId.startsWith(c.idPrefix)) {
        setRefId(NEW); nowNew = true
        next.newId = v.refId.slice(c.idPrefix.length).replace(/\D/g, '').slice(0, c.idDigits)
        marks.newId = evidence.refId ?? ''
        if (c.id === 'influencer' && v.refName && !(vals.refName ?? '').trim()) { next.refName = v.refName; marks.refName = evidence.refName ?? '' }
        if (c.id === 'campaign') {
          if (v.parentInfluencerId && !(vals.parentInfluencerId ?? '')) { next.parentInfluencerId = v.parentInfluencerId; marks.parentInfluencerId = evidence.parentInfluencerId ?? '' }
          if (v.productLine && !(vals.productLine ?? '')) { next.productLine = v.productLine; marks.productLine = evidence.productLine ?? '' }
        }
      }
      if (known || v.refId.startsWith(c.idPrefix)) marks.refId = evidence.refId ?? ''
    }
    const SIMPLE = ['settlementDate', 'contractDeadline', 'currentExpiry', 'autoRenew', 'requested', 'feeType', 'fixedFee', 'performanceFee', 'performanceRate', 'gmv', 'refund', 'cogs', 'channelFee', 'shipping', 'returnLogistics', 'memo', 'dealType']
    for (const k of SIMPLE) {
      const val = v[k]
      if (val === undefined) continue
      if (k === 'dealType' && nowNew) continue // 새 ID 는 항상 신규
      const typed = (vals[k] ?? '').trim()
      if (typed === '') { next[k] = val; marks[k] = evidence[k] ?? '' }
      else if (typed.replace(/,/g, '') !== val) differs.push({ label: label(k), typed, doc: val })
    }
    setVals((s) => ({ ...s, ...next }))
    setAiFilled((a) => ({ ...a, ...marks }))
    setAiReport({ filled: Object.keys(marks).length, differs, warnings: [], skipped: [], tokens: '', model: '' })
  }

  const send = (cat: NonNullable<typeof categories[number]>) =>
    start(async () => {
      const fd = new FormData()
      if (todo.length > 0) fd.set('allowIncomplete', '1')
      fd.set('category', cat.id)
      fd.set('refId', isNew ? newIdFull : refId)
      if (isNew) fd.set('v:isNewRef', '1')
      for (const [k, v] of Object.entries(vals)) fd.set(`v:${k}`, v)
      if (deal) fd.set('v:dealType', deal)
      if (productLine) fd.set('v:productLine', productLine)
      if (cat.id === 'influencer') fd.set('v:requested', requestedStr)
      // 신규 ID 로 바꾸기 전에 올려 둔 기존 계약서는 보내지 않는다 (칸이 없어졌으므로)
      const shown = new Set(shownKinds.map((k) => k.id))
      for (const [kind, list] of Object.entries(files)) if (shown.has(kind)) list.forEach((f, i) => fd.append(`f:${kind}#${i}`, f))
      extras.forEach((x, i) => { fd.set(`cl:${i}`, x.label.trim()); x.files.forEach((f, j) => fd.append(`cf:${i}#${j}`, f)) })
      try {
        const res = await fetch('/api/submissions', { method: 'POST', body: fd })
        const r = (await res.json()) as { ok: boolean; message: string }
        if (r.ok) {
          toast.success(r.message)
          setRefId(''); setVals({}); setFiles({}); setExtras([]); setAllowInc(false); setAiFilled({}); setAiReport(null); setFormKey((x) => x + 1)
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
              onClick={() => { setCatId(c.id); setRefId(''); setVals({}); setFiles({}); setExtras([]); setAiFilled({}); setAiReport(null); setFormKey((x) => x + 1) }}
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
            {/* 제목은 자동으로 만들어져요 — 대상·구분·금액을 고르면 채워지고, 직접 고칠 수 없어요 */}
            <label className="flex flex-col gap-1 t-small sm:col-span-2 lg:col-span-3">
              <span className="font-semibold">제목 <span className="t-caption">(자동 생성 · 입력할 수 없어요 — 이미 있는 제목이면 확대2, 갱신2처럼 번호가 올라가요)</span></span>
              <input className={`${INPUT} bg-muted`} disabled readOnly value={autoTitle} placeholder={`${cat.refLabel}와 ${DEAL_LABEL[cat.id]}을 고르면 제목이 만들어져요`} aria-label="제목 (자동 생성)" />
            </label>
            <label className="flex flex-col gap-1 t-small">
              <span className="font-semibold">{cat.refLabel} <span className="t-caption">({cat.idRule}, 전사 ID 규칙)</span></span>
              <select className={INPUT + ai('refId')} title={aiTitle('refId')} value={refId} onChange={(e) => { setRefId(e.target.value); setAiFilled((a) => ('refId' in a ? Object.fromEntries(Object.entries(a).filter(([x]) => x !== 'refId')) : a)) }}>
                <option value="">{cat.refLabel}를 고르세요</option>
                <option value={NEW}>➕ 신규 ID 입력 (원본에 없는 {cat.refLabel.replace(' ID', '')})</option>
                {cat.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            {isNew && (
              <>
                <label className="flex flex-col gap-1 t-small">
                  <span className="font-semibold">신규 {cat.refLabel} * <span className="t-caption">(뒤 숫자만 입력, 제안: {cat.nextId.slice(cat.idPrefix.length)})</span></span>
                  <span className="flex items-stretch">
                    <span className={`${INPUT} w-auto bg-muted font-semibold`} style={{ borderRight: 0 }}>{cat.idPrefix}</span>
                    <input className={INPUT + ai('newId')} title={aiTitle('newId')} inputMode="numeric" maxLength={cat.idDigits} placeholder={'0'.repeat(cat.idDigits)} value={newDigits} onChange={(e) => set('newId')(e.target.value.replace(/\D/g, ''))} aria-label={`신규 ${cat.refLabel} 번호`} />
                  </span>
                  {idTaken ? <span className="t-caption font-semibold text-danger" role="alert">이미 있는 분류ID입니다!</span> : newDigits && <span className="t-caption">등록될 ID: {newIdFull}</span>}
                </label>
                {cat.id === 'influencer' && (
                  <label className="flex flex-col gap-1 t-small">
                    <span className="font-semibold">신규 인플루언서 이름 *</span>
                    <input className={INPUT + ai('refName')} title={aiTitle('refName')} value={vals.refName ?? ''} onChange={(e) => set('refName')(e.target.value)} />
                  </label>
                )}
                {cat.id === 'campaign' && (
                  <label className="flex flex-col gap-1 t-small">
                    <span className="font-semibold">소속 인플루언서 *</span>
                    <select className={INPUT + ai('parentInfluencerId')} title={aiTitle('parentInfluencerId')} value={vals.parentInfluencerId ?? ''} onChange={(e) => set('parentInfluencerId')(e.target.value)}>
                      <option value="">고르세요</option>
                      {cat.parents.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      <option value="NONE">해당 없음 (NONE)</option>
                    </select>
                  </label>
                )}
              </>
            )}
            <div className="flex flex-col gap-1 t-small">
              <span className="font-semibold">{DEAL_LABEL[cat.id]} *{isNew && <span className="t-caption"> (새 ID 는 신규만 가능)</span>}</span>
              <div className="flex gap-2" role="radiogroup" aria-label={DEAL_LABEL[cat.id]}>
                {dealOptions.map((d) => {
                  const off = isNew && d !== '신규'
                  return (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={deal === d}
                      disabled={off}
                      onClick={() => set('dealType')(d)}
                      title={aiTitle('dealType')}
                      className={`rounded-input border px-3 py-1 t-small ${deal === d ? 'border-primary bg-primary-soft font-semibold' : 'border-default'} ${off ? 'opacity-50' : ''} ${deal === d && aiFilled.dealType !== undefined ? 'ring-2 ring-primary' : ''}`}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
            {cat.id === 'campaign' && (
              <label className="flex flex-col gap-1 t-small">
                <span className="font-semibold">제품 종류 *{!isNew && <span className="t-caption"> (기존 캠페인은 자동)</span>}</span>
                {isNew ? (
                  <select className={INPUT + ai('productLine')} title={aiTitle('productLine')} value={vals.productLine ?? ''} onChange={(e) => set('productLine')(e.target.value)}>
                    <option value="">제품 종류를 고르세요</option>
                    {cat.productLines.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <div className={`${INPUT} bg-muted`}>{productLine || '캠페인을 고르면 표시돼요'}</div>
                )}
              </label>
            )}
            {visibleFields.map((f) => (
              <label key={f.name} className="flex flex-col gap-1 t-small">
                <span className="font-semibold">{f.label} *{f.name === 'autoRenew' && <span className="t-caption"> (통보 기한을 넘기면 동일 조건으로 갱신되는 계약인가요?)</span>}</span>
                {f.type === 'choice' ? (
                  <select className={INPUT + ai(f.name)} title={aiTitle(f.name)} value={vals[f.name] ?? ''} onChange={(e) => set(f.name)(e.target.value)}>
                    <option value="">고르세요</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                <input
                  className={INPUT + ai(f.name)}
                  title={aiTitle(f.name)}
                  inputMode={f.type === 'number' || f.type === 'date' ? 'numeric' : undefined}
                  maxLength={f.type === 'date' ? 10 : undefined}
                  placeholder={f.type === 'date' ? 'YYYY-MM-DD (숫자만 입력)' : f.placeholder}
                  value={f.type === 'number' ? formatMoneyInput(digitsOnly(vals[f.name] ?? '')) : (vals[f.name] ?? '')}
                  onChange={(e) => set(f.name)(f.type === 'date' ? formatDate(e.target.value) : f.type === 'number' ? digitsOnly(e.target.value) : e.target.value)}
                />
                )}
              </label>
            ))}
            {cat.id === 'influencer' && (
              <>
                <label className="flex flex-col gap-1 t-small">
                  <span className="font-semibold">계약 방식 *</span>
                  <select className={INPUT + ai('feeType')} title={aiTitle('feeType')} value={feeType} onChange={(e) => set('feeType')(e.target.value)}>
                    <option value="">계약 방식을 고르세요</option>
                    <option value="고정 피">고정 피</option>
                    <option value="성과 피">성과 피</option>
                    <option value="혼합 피">혼합 피 (고정 피 + 성과 피)</option>
                  </select>
                </label>
                {needFixed && (
                  <label className="flex flex-col gap-1 t-small">
                    <span className="font-semibold">고정 피 금액 (연, 원) *</span>
                    <input className={INPUT + ai('fixedFee')} title={aiTitle('fixedFee')} inputMode="numeric" placeholder="예: 2,800,000,000" value={formatMoneyInput(digitsOnly(vals.fixedFee ?? ''))} onChange={(e) => set('fixedFee')(digitsOnly(e.target.value))} />
                  </label>
                )}
                {needPerf && (
                  <label className="flex flex-col gap-1 t-small">
                    <span className="font-semibold">성과 피 금액 (연 예상, 원) *</span>
                    <input className={INPUT + ai('performanceFee')} title={aiTitle('performanceFee')} inputMode="numeric" placeholder="예: 300,000,000" value={formatMoneyInput(digitsOnly(vals.performanceFee ?? ''))} onChange={(e) => set('performanceFee')(digitsOnly(e.target.value))} />
                  </label>
                )}
                {needPerf && (
                  <label className="flex flex-col gap-1 t-small">
                    <span className="font-semibold">성과 피 비율 (귀속 GMV 대비 %, 선택)</span>
                    <input className={INPUT + ai('performanceRate')} title={aiTitle('performanceRate')} inputMode="decimal" placeholder="예: 5" maxLength={6} value={vals.performanceRate ?? ''} onChange={(e) => set('performanceRate')(e.target.value.replace(/[^0-9.]/g, ''))} />
                  </label>
                )}
                {feeType && <div className="flex flex-col gap-1 t-small"><span className="font-semibold">요청금액 합계 <span className="t-caption">(자동)</span></span><div className={`${INPUT} bg-muted`}>{requestedStr ? fmtWon(Number(requestedStr)) : '금액을 입력하세요'}</div></div>}
              </>
            )}
            <label className="flex flex-col gap-1 t-small sm:col-span-2 lg:col-span-3">
              <span className="font-semibold">메모</span>
              <input className={INPUT + ai('memo')} title={aiTitle('memo')} placeholder="팀장에게 전할 내용, 특이사항" value={vals.memo ?? ''} onChange={(e) => set('memo')(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-col gap-1 border-t border-default pt-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="t-small font-semibold">첨부서류</span>
              <Button size="sm" variant="secondary" isDisabled={reading || pending || !dealChosen || !(Object.entries(files).some(([k, l]) => l.length > 0 && shownKinds.some((x) => x.id === k)) || extras.some((x) => x.files.length > 0))} onPress={readDocs}>
                {reading ? '서류를 읽는 중… (수십 초 걸려요)' : 'AI 로 첨부서류 읽고 빈칸 채우기'}
              </Button>
              <span className="t-caption">기안서·추계서 등을 올린 뒤 누르면 비어 있는 칸을 채워요. 이미 적은 칸은 그대로 두고, 채운 칸은 파란 테두리로 보여요 — 꼭 확인하세요.</span>
            </div>
            {aiReport && (
              <div className="flex flex-col gap-1 border border-primary p-2 t-small" style={{ borderRadius: 2 }} role="status">
                <span><strong>AI 읽기 결과</strong> — {aiReport.filled}개 칸을 채웠어요{aiReport.tokens ? ` (${aiReport.model} · ${aiReport.tokens})` : ''}.</span>
                {aiReport.differs.length > 0 && (
                  <div>
                    <span className="font-semibold">이미 적은 값과 서류의 값이 달라요 (적은 값을 그대로 뒀어요):</span>
                    <ul className="list-disc pl-5">{aiReport.differs.map((d) => <li key={d.label}>{d.label}: 적은 값 {d.typed} · 서류 {d.doc}</li>)}</ul>
                  </div>
                )}
                {aiReport.warnings.length > 0 && (
                  <div>
                    <span className="font-semibold text-danger">서류에서 의심스러운 점:</span>
                    <ul className="list-disc pl-5">{aiReport.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                )}
                {aiReport.skipped.length > 0 && <span className="t-caption">읽지 못한 파일(지원하지 않는 형식): {aiReport.skipped.join(', ')}</span>}
              </div>
            )}
            {!dealChosen && (
              <p className="border border-dashed border-default px-3 py-3 t-small text-muted" style={{ borderRadius: 2 }}>
                위에서 <b>{cat ? DEAL_LABEL[cat.id] : '구분'}</b>(신규 / {cat?.id === 'influencer' ? '갱신' : '확대'})을 먼저 고르면 첨부서류 칸이 나와요. 구분에 따라 올릴 서류가 달라져요 (신규는 기존 계약서가 없어요).
              </p>
            )}
            <div className="flex flex-col">
              {shownKinds.map((k) => (
                <div key={k.id} className={ROW}>
                  <span className="t-small">{k.label} {isRequired(k) ?<span className="text-danger">*</span> : <span className="t-caption">(선택)</span>}</span>
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
              <Button size="sm" isDisabled={!dealChosen} variant="outline" onPress={() => setExtras((list) => [...list, { label: '', files: [] }])}>+ 첨부 추가</Button>
            </div>
            <p className="t-caption">pdf·문서·표·이미지·메일(eml, msg) 등, 파일당 8MB 까지.</p>
          </div>

          <div className="flex flex-col gap-2 border-t border-default pt-2">
            <span className="t-small font-semibold">공헌이익 계산 <span className="t-caption">(모두 원 단위, 1원까지 입력, 해당 없으면 0)</span></span>
            <p className="t-caption">{CONTRIBUTION_FORMULA}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CONTRIBUTION_FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 t-small">
                  <span>{f.label} *</span>
                  <input className={INPUT + ai(f.key)} title={aiTitle(f.key)} inputMode="numeric" placeholder={f.hint} value={formatMoneyInput(digitsOnly(vals[f.key] ?? ''))} onChange={(e) => set(f.key)(digitsOnly(e.target.value))} />
                </label>
              ))}
              <div className="flex flex-col gap-1 t-small">
                <span>마케팅 지출 <span className="t-caption">(= 요청금액, 자동)</span></span>
                <div className={`${INPUT} bg-muted`}>{requestedStr ? fmtWon(Number(requestedStr)) : '요청금액을 입력하세요'}</div>
              </div>
            </div>
            <div className="rounded-card border border-default p-2">
              {result ? (
                <div className="flex flex-wrap gap-x-8 gap-y-1 t-small">
                  <span>순매출 <strong>{fmtWon(result.netRevenue)}</strong></span>
                  <span>공헌이익 <strong className={result.contributionProfit < 0 ? 'text-danger' : ''}>{fmtWon(result.contributionProfit)}</strong></span>
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
            {todo.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 t-small">
                <input type="checkbox" checked={allowInc} onChange={(e) => setAllowInc(e.target.checked)} />
                필수 항목을 채우지 않고 제출하기
              </label>
            )}
            <div>
              <Button isDisabled={pending || (todo.length > 0 && !allowInc) || !refId || (isNew && !newDigits) || idTaken} onPress={submit}>
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
export function AcceptReview({
  id, sections, mustCheck, drafts,
}: { id: number; sections: ReviewSection[]; mustCheck: { id: string; text: string }[]; drafts: { id: number; name: string }[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [on, setOn] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState('')
  const [draftId, setDraftId] = useState('')
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
      {/* 마케팅 팀장이 꼭 확인할 일 — 확인하면 아래 체크박스를 누를 때 함께 체크 표시된다 */}
      <div className="flex flex-col gap-1 border border-warning bg-warning-soft p-2" style={{ borderRadius: 2 }}>
        <span className="t-small font-semibold">마케팅 팀장이 확인할 일</span>
        <p className="t-caption">첨부 파일이 올라와 있는지, 아래 내용이 들어 있는지 확인해 주세요. 모두 확인해야 재무팀에 회부할 수 있어요.</p>
        <ol className="flex flex-col gap-2 pl-1 pt-1">
          {mustCheck.map((m, i) => (
            <li key={m.id} className="flex gap-2 t-small">
              <span className="w-5 shrink-0 font-semibold">{i + 1}.</span>
              <span className={on[m.id] ? 'text-success' : ''}>{on[m.id] ? '✔ ' : ''}{m.text}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="t-small font-semibold">기안 접수 검토 — 각 항목을 확인하고 왼쪽에 체크하세요</span>
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
      <div className="flex flex-wrap items-center gap-2 border-t border-default pt-2">
        <label className="flex items-center gap-2 t-small">
          <span className="font-semibold">등록할 기안</span>
          <select className={`${INPUT} w-auto max-w-xs`} value={draftId} onChange={(e) => setDraftId(e.target.value)}>
            <option value="">새 기안으로 등록</option>
            {drafts.map((d) => <option key={d.id} value={d.id}>{d.name} 에 추가</option>)}
          </select>
        </label>
        <span className="t-caption">팀원들이 올린 안건을 같은 기안에 모아 등록할 수 있어요.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button isDisabled={pending || !all} onPress={() => run(() => acceptSubmissionAction({ id, checked: ids.filter((x) => on[x]), draftId: draftId ? Number(draftId) : null }))}>
          기안 접수 · 재무팀에 회부
        </Button>
        {!all && <span className="t-caption">모든 항목을 확인해야 재무팀에 회부할 수 있어요.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-default pt-2">
        <input className={`${INPUT} max-w-xs`} placeholder="반려 사유 (선택)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="반려 사유" />
        <Button size="sm" variant="outline" isDisabled={pending} onPress={() => run(() => returnSubmissionAction({ id, note }))}>반려 (팀원에게 돌려보냄)</Button>
      </div>
    </div>
  )
}
