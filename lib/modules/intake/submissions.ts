// 안건 제출·접수 — 팀원이 안건을 제출(보고)하면 접수 권한자(팀장)에게 넘어가고, 팀장이 체크리스트를 모두 확인한 뒤 접수하면 안건이 된다 (서버 전용).
// 분류(대분류)마다 제출할 수 있는 역할과 접수할 수 있는 역할이 다르다. ID 는 id_conventions.md 규칙을 따른다.
import type { Sql } from 'postgres'
import { assignDrafts } from '@/lib/app/drafts'
import { EngineError, openCase, type EngineConfig } from '@/lib/engine/engine'
import { fmtWon } from '@/lib/app/format'
import { DEAL_TYPES, campaignNumber, nextCampaignName, uniqueTitle } from '@/lib/app/submission-title'
import { calcContribution, validateContribution, CONTRIBUTION_FIELDS, type ContributionInput } from '@/lib/metrics/contribution-calc'
import { MASIL_MODEL } from '@/lib/semantic/model'
import { entityRows } from '@/lib/semantic/run'
import { receiveContractNotice } from '@/lib/modules/w02/intake'
import { EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'

import { CATEGORY_LABEL, type CategoryId } from '@/lib/app/labels'
export type { CategoryId }

export interface FieldDef {
  name: string
  label: string
  type: 'text' | 'number' | 'date'
  required?: boolean
  placeholder?: string
}

export interface Category {
  id: CategoryId
  label: string
  /** 분류 ID 입력칸 이름과 규칙 (id_conventions.md) */
  refLabel: string
  idRule: string
  idPattern: RegExp
  /** 제출할 수 있는 역할 (접수 권한자 이상은 항상 제출할 수 있다) */
  submitRoles: string[]
  /** 접수할 수 있는 최소 역할 */
  acceptRole: string
  fields: FieldDef[]
}

const COMMON_FIELDS = (settleLabel: string, deadlineLabel: string, amountLabel: string): FieldDef[] => [
  { name: 'settlementDate', label: settleLabel, type: 'date', required: true },
  { name: 'contractDeadline', label: deadlineLabel, type: 'date', required: true },
  { name: 'requested', label: amountLabel, type: 'number', required: true, placeholder: '예: 30,000,000' },
]

export const CATEGORIES: Category[] = [
  {
    id: 'influencer', label: CATEGORY_LABEL.influencer, refLabel: '인플루언서 ID', idRule: 'INF-nnn', idPattern: /^INF-\d{3}$/,
    submitRoles: ['marketing_member', 'marketing_team'], acceptRole: 'marketing_team',
    fields: [
      // 요청금액은 계약 방식에 따라 입력한 고정 피·성과 피 금액의 합으로 정해진다
      ...COMMON_FIELDS('지급 예정일 (고정 피)', '계약 체결 기한 (갱신 통보 기한)', '').filter((f) => f.name !== 'requested'),
      { name: 'currentExpiry', label: '현 계약 만료일', type: 'date', required: true },
    ],
  },
  {
    id: 'campaign', label: CATEGORY_LABEL.campaign, refLabel: '캠페인 ID', idRule: 'CMP-nnnn', idPattern: /^CMP-\d{4}$/,
    submitRoles: ['marketing_member', 'marketing_team'], acceptRole: 'marketing_team',
    fields: COMMON_FIELDS('지급 예정일 (집행 대금)', '계약 체결 기한 (계약 확정기한)', '요청금액 (집행 예산, 원)'),
  },
]

export const categoryById = (id: string) => CATEGORIES.find((c) => c.id === id)

/** 인플루언서 계약 방식 — 고정 피 / 성과 피 / 혼합 피 */
export const FEE_TYPES = ['고정 피', '성과 피', '혼합 피'] as const
export type FeeType = (typeof FEE_TYPES)[number]
/** 계약 방식에 따라 입력해야 하는 금액 */
export const feeNeeds = (t: string) => ({ fixed: t === '고정 피' || t === '혼합 피', performance: t === '성과 피' || t === '혼합 피' })

/** 첨부서류 종류. required 는 없으면 제출할 수 없다. requiredFor 는 그 분류에서만 필수다. */
export const ATTACHMENT_KINDS: { id: string; label: string; required: boolean; requiredFor?: CategoryId[] }[] = [
  { id: 'draft', label: '기안서', required: true },
  { id: 'estimate', label: '비용 및 성과 추계서', required: true },
  // 아직 계약을 체결한 것이 아니고 본 계약서는 계약 담당이 만들기 때문에, 기존 계약서와 협의서는 없을 수 있다 (선택)
  { id: 'contract', label: '기존 계약서', required: false },
  { id: 'consult', label: '협의서 (메일, 공문 등)', required: false },
]
/** 이 분류에서 꼭 첨부해야 하는 종류 */
export const requiredKinds = (category: string) => ATTACHMENT_KINDS.filter((k) => k.required || k.requiredFor?.includes(category as CategoryId))

/** 그 밖의 첨부 — 종류 이름을 제출하는 사람이 직접 적는다 (예: 예상 GMV, 주문기록 …). 여러 개 가능 */
export const CUSTOM_KIND = 'custom'

const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'hwpx', 'txt', 'md', 'csv', 'eml', 'msg', 'png', 'jpg', 'jpeg']
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_FILES = 12

/** 팀장이 접수하기 전에 하나씩 확인해야 하는 항목. 첨부서류는 파일마다 따로 확인한다(id `file:<파일번호>`). 모두 확인해야 접수할 수 있다 (서버도 다시 확인한다). */
export const ACCEPT_CHECKS: { id: string; label: string; only?: CategoryId | 'new' }[] = [
  { id: 'terms', label: '기존 계약서가 첨부된 경우, 성과 피 정산 조건과 고정 피 금액이 표시돼 있다 (첨부가 없으면 없다는 사실을 확인했다)', only: 'influencer' },
  { id: 'ref', label: '분류 ID가 맞고, 안건 내용이 그 대상(인플루언서·캠페인)에 대한 것이다' },
  { id: 'newref', label: '신규 ID: 전사 ID 규칙에 맞고, 이름(·소속 인플루언서)이 맞으며, 기존 ID와 겹치지 않는다', only: 'new' },
  { id: 'deadline', label: '계약 체결 기한을 확인했고, 남은 기간 안에 승인까지 끝낼 수 있다' },
  { id: 'settle', label: '지급 예정일(돈이 나가는 날)이 기안서와 일치한다' },
  { id: 'amount', label: '요청금액이 기안서·추계서와 일치한다' },
  { id: 'calc', label: '공헌이익이 산출돼 있고, 계산 입력값을 추계서와 대조했으며, 결과(양수·음수)를 확인했다' },
  { id: 'dup', label: '같은 대상으로 이미 진행 중인 안건이 없다' },
  { id: 'memo', label: '메모와 특이사항을 읽었다' },
]
/** isNew: 원본에 없는 신규 ID 로 제출한 경우 신규 ID 확인 항목이 더해진다 */
/** 첨부파일 하나를 확인했다는 체크 id */
export const fileCheckId = (fileId: number) => `file:${fileId}`
export const checksFor = (category: CategoryId, isNew = false) => ACCEPT_CHECKS.filter((c) => !c.only || c.only === category || (c.only === 'new' && isNew))

export interface SubmissionRow {
  id: number
  category: CategoryId
  refId: string
  title: string
  input: Record<string, string>
  submittedBy: string
  acceptRole: string
  status: 'pending' | 'accepted' | 'returned'
  decidedBy: string | null
  decidedAt: string | null
  note: string | null
  caseId: number | null
  createdAt: string
}

export interface FileMeta {
  id: number
  submissionId: number
  kind: string
  /** 직접 적은 종류 이름 (kind 가 custom 일 때) */
  label: string | null
  filename: string
  mime: string
  size: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toRow = (r: any): SubmissionRow => ({
  id: Number(r.id), category: r.category, refId: r.ref_id, title: r.title, input: r.input ?? {}, submittedBy: r.submitted_by,
  acceptRole: r.accept_role, status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
  note: r.note, caseId: r.case_id === null ? null : Number(r.case_id), createdAt: new Date(r.created_at).toISOString(),
})

export async function listSubmissions(sql: Sql, status?: SubmissionRow['status']): Promise<SubmissionRow[]> {
  const rows = status
    ? await sql`SELECT * FROM submissions WHERE status = ${status} ORDER BY id DESC`
    : await sql`SELECT * FROM submissions ORDER BY id DESC LIMIT 200`
  return rows.map(toRow)
}

export async function listFiles(sql: Sql, submissionId: number): Promise<FileMeta[]> {
  const rows = await sql`SELECT id, submission_id, kind, label, filename, mime, size FROM submission_files WHERE submission_id = ${submissionId} ORDER BY id`
  return rows.map((r: any) => ({ id: Number(r.id), submissionId: Number(r.submission_id), kind: r.kind, label: r.label ?? null, filename: r.filename, mime: r.mime, size: Number(r.size) }))
}

export async function getFile(sql: Sql, id: number): Promise<(FileMeta & { content: Buffer }) | null> {
  const [r] = await sql`SELECT * FROM submission_files WHERE id = ${id}`
  return r ? { id: Number(r.id), submissionId: Number(r.submission_id), kind: r.kind, label: r.label ?? null, filename: r.filename, mime: r.mime, size: Number(r.size), content: r.content as Buffer } : null
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
const CONTRIB_KEYS = CONTRIBUTION_FIELDS.map((f) => f.key)

/** 제출한 칸에서 공헌이익 입력(원 단위)을 만든다 */
export function contributionFromInput(input: Record<string, string>): ContributionInput {
  const n = (k: string) => Math.round(Number(input[k] ?? 0))
  return {
    gmv: n('gmv'), refund: n('refund'), cogs: n('cogs'), channelFee: n('channelFee'), shipping: n('shipping'), returnLogistics: n('returnLogistics'),
    marketingSpend: n('requested'),
  }
}

export interface UploadedFile {
  kind: string
  /** kind 가 custom 이면 직접 적은 종류 이름 */
  label?: string
  filename: string
  mime: string
  content: Buffer
}

/** 제출 내용을 검사하고 접수 대기(보고)로 올린다. 필수 칸·첨부·공헌이익 칸이 모두 채워져야 한다. */
/** 아직 비어 있는 필수 항목 (제출·접수 때 같은 기준으로 쓴다). 파일은 종류만 본다. */
export function missingRequired(category: string, v: Record<string, string>, fileKinds: string[]): string[] {
  const cat = categoryById(category)
  if (!cat) return []
  const isNew = v.isNewRef === '1'
  const out: string[] = []
  if (isNew) {
    // 신규 인플루언서만 이름을 적는다 (신규 캠페인의 이름은 소속 인플루언서·제품 종류·번호로 자동 생성)
    if (cat.id === 'influencer' && !(v.refName ?? '').trim()) out.push('신규 인플루언서 이름')
    if (cat.id === 'campaign' && !(v.parentInfluencerId ?? '').trim()) out.push('소속 인플루언서')
  }
  // 제품 종류: 신규 캠페인은 직접 고른다 (기존 캠페인은 원본 마스터에 있다)
  if (cat.id === 'campaign' && isNew && v.productLine !== undefined && !v.productLine.trim()) out.push('제품 종류')
  for (const f of cat.fields) {
    // 신규 계약(새 인플루언서이거나 구분이 "신규")은 아직 현 계약이 없다
    if (f.name === 'currentExpiry' && (isNew || v.dealType === '신규')) continue
    if (f.required && !(v[f.name] ?? '').trim()) out.push(f.label)
  }
  if (cat.id === 'influencer') {
    if (!FEE_TYPES.includes(v.feeType as FeeType)) out.push('계약 방식')
    else {
      const need = feeNeeds(v.feeType)
      if (need.fixed && !(Number(v.fixedFee) > 0)) out.push('고정 피 금액')
      if (need.performance && !(Number(v.performanceFee) > 0)) out.push('성과 피 금액')
    }
  }
  if (CONTRIB_KEYS.some((k) => !(v[k] ?? '').trim())) out.push('공헌이익 계산 칸')
  for (const k of requiredKinds(cat.id)) if (!fileKinds.includes(k.id)) out.push(`첨부: ${k.label}`)
  return out
}

/** allowIncomplete: 필수 항목이 비어 있어도 제출한다 (제출자가 확인한 경우). 접수 때 팀장이 보완·반려를 판단한다. */
export async function submitIntake(
  sql: Sql, input: { category: string; refId: string; values: Record<string, string>; files: UploadedFile[]; by: string; allowIncomplete?: boolean },
): Promise<SubmissionRow> {
  const inc = Boolean(input.allowIncomplete)
  const cat = categoryById(input.category)
  if (!cat) throw new EngineError('안건 종류를 골라 주세요')
  const refId = input.refId.trim().toUpperCase()
  if (!cat.idPattern.test(refId)) throw new EngineError(`${cat.refLabel} 형식이 맞지 않아요 (${cat.idRule})`)

  const isNew = input.values.isNewRef === '1'
  // 구분: 캠페인은 신규/확대, 인플루언서 전속계약은 신규/갱신. 보내지 않으면 ID 로 짐작한다 (새 ID → 신규, 기존 ID → 갱신/확대)
  const deal = (input.values.dealType ?? '').trim() || (isNew ? '신규' : cat.id === 'influencer' ? '갱신' : '확대')
  if (!DEAL_TYPES[cat.id].includes(deal)) throw new EngineError(`구분은 ${DEAL_TYPES[cat.id].join(' / ')} 중에서 골라 주세요`)
  if (isNew && deal !== '신규') throw new EngineError('새로 만드는 ID 는 "신규"로만 올릴 수 있어요')
  const v: Record<string, string> = { dealType: deal }
  for (const f of cat.fields) {
    // 신규 계약은 아직 계약이 없어 현 계약 만료일이 없다
    if (f.name === 'currentExpiry' && (isNew || deal === '신규')) { v.currentExpiry = ''; continue }
    const val = (input.values[f.name] ?? '').trim().replace(f.type === 'number' ? /,/g : /^$/, '')
    if (f.required && !val && !inc) throw new EngineError(`${f.label} 을(를) 입력해 주세요`)
    if (val && f.type === 'date' && !isDate(val)) throw new EngineError(`${f.label} 은(는) YYYY-MM-DD 형식으로 입력해 주세요`)
    if (val && f.type === 'number' && !(Number.isInteger(Number(val)) && Number(val) > 0)) throw new EngineError(`${f.label} 은(는) 0보다 큰 정수(원)여야 해요`)
    v[f.name] = val
  }
  v.memo = (input.values.memo ?? '').trim()
  // 인플루언서 계약: 계약 방식(고정 피/성과 피/혼합 피)과 방식에 맞는 금액. 요청금액 = 고정 피 + 성과 피
  if (cat.id === 'influencer') {
    let feeType = (input.values.feeType ?? '').trim()
    let fixed = (input.values.fixedFee ?? '').replace(/,/g, '').trim()
    const perf = (input.values.performanceFee ?? '').replace(/,/g, '').trim()
    if (!feeType && !fixed && !perf && (input.values.requested ?? '').trim()) { feeType = '고정 피'; fixed = input.values.requested.replace(/,/g, '').trim() } // 예전 입력 방식(요청금액 = 고정 피)
    if (!feeType && !inc) throw new EngineError('계약 방식(고정 피·성과 피·혼합 피)을 골라 주세요')
    if (feeType && !FEE_TYPES.includes(feeType as FeeType)) throw new EngineError('알 수 없는 계약 방식이에요')
    const need = feeNeeds(feeType)
    for (const [label, raw, needed] of [['고정 피 금액', fixed, need.fixed], ['성과 피 금액', perf, need.performance]] as const) {
      if (raw && !(Number.isInteger(Number(raw)) && Number(raw) > 0)) throw new EngineError(`${label} 은(는) 0보다 큰 정수(원)여야 해요`)
      if (needed && !raw && !inc) throw new EngineError(`${label} 을(를) 입력해 주세요`)
    }
    v.feeType = feeType
    v.fixedFee = need.fixed ? fixed : ''
    v.performanceFee = need.performance ? perf : ''
    // 성과 피 비율(귀속 GMV 대비 %) — 선택. 적으면 0 초과 100 이하의 숫자여야 한다
    const rate = (input.values.performanceRate ?? '').replace(/,/g, '').trim()
    if (rate && need.performance && !(Number(rate) > 0 && Number(rate) <= 100)) throw new EngineError('성과 피 비율은 0보다 크고 100 이하인 숫자(%)로 입력해 주세요')
    v.performanceRate = need.performance ? rate : ''
    const total = (need.fixed ? Number(fixed || 0) : 0) + (need.performance ? Number(perf || 0) : 0)
    v.requested = total > 0 ? String(total) : ''
  }
  // 공헌이익 칸 (원, 1원 단위) — 요청금액은 마케팅 지출로 자동 들어간다
  const rawContrib: Record<string, string> = {}
  for (const k of CONTRIB_KEYS) {
    v[k] = (input.values[k] ?? '').replace(/,/g, '').trim()
    rawContrib[k] = v[k]
  }
  // 일부만 채운 경우에도 값의 형식은 검사한다 (불완전 제출이면 빈 칸은 허용)
  const filled = Object.fromEntries(Object.entries(rawContrib).filter(([, x]) => x !== ''))
  const bad = inc ? validateContribution(filled, Object.keys(filled) as never) : validateContribution(rawContrib, CONTRIB_KEYS)
  if (bad) throw new EngineError(bad)

  // 첨부
  if (input.files.length > MAX_FILES) throw new EngineError(`첨부파일은 ${MAX_FILES}개까지 올릴 수 있어요`)
  for (const k of requiredKinds(cat.id)) {
    if (!input.files.some((f) => f.kind === k.id) && !inc) throw new EngineError(`${k.label} 을(를) 첨부해 주세요`)
  }
  for (const f of input.files) {
    if (f.kind === CUSTOM_KIND) {
      const label = (f.label ?? '').trim()
      if (!label) throw new EngineError(`${f.filename}: 추가 첨부의 종류 이름을 적어 주세요`)
      if (label.length > 30) throw new EngineError('첨부 종류 이름은 30자 이내로 적어 주세요')
    } else if (!ATTACHMENT_KINDS.some((k) => k.id === f.kind)) throw new EngineError('알 수 없는 첨부 종류예요')
    const ext = f.filename.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXT.includes(ext)) throw new EngineError(`${f.filename}: 올릴 수 없는 파일 형식이에요 (${ALLOWED_EXT.join(', ')})`)
    if (f.content.length === 0) throw new EngineError(`${f.filename}: 빈 파일이에요`)
    if (f.content.length > MAX_FILE_BYTES) throw new EngineError(`${f.filename}: 파일이 너무 커요 (8MB 까지)`)
  }

  // 신규 ID(원본에 없는 인플루언서·캠페인): 규칙에 맞는 새 ID + 이름이 필요하고, 기존 ID·다른 신규 제출과 겹치면 안 된다
  const influencers = await entityRows(sql, MASIL_MODEL, 'influencer')
  const campaigns = await entityRows(sql, MASIL_MODEL, 'campaign')
  let name = refId
  if (isNew) {
    // 신규 인플루언서만 이름을 적는다. 신규 캠페인의 이름은 아래에서 자동으로 만든다 ("인플루언서 제품종류 캠페인N")
    const refName = cat.id === 'influencer' ? (input.values.refName ?? '').trim() : ''
    if (cat.id === 'influencer') {
      if (!refName && !inc) throw new EngineError('신규 인플루언서의 이름을 입력해 주세요')
      if (refName.length > 40) throw new EngineError('이름은 40자 이내로 입력해 주세요')
    }
    const exists = cat.id === 'influencer' ? influencers.some((i) => i.influencer_id === refId) : campaigns.some((c) => c.campaign_id === refId)
    if (exists) throw new EngineError(`이미 있는 분류ID입니다! (${refId}) 목록에서 골라 주세요`)
    const clash = await sql`SELECT 1 FROM submissions WHERE category = ${cat.id} AND ref_id = ${refId} AND input->>'isNewRef' = '1' AND status <> 'returned' LIMIT 1`
    if (clash.length > 0) throw new EngineError(`이미 있는 분류ID입니다! (${refId}) 다른 신규 제출에서 쓰고 있어요`)
    v.isNewRef = '1'; v.refName = refName
    if (cat.id === 'campaign') {
      const parent = (input.values.parentInfluencerId ?? '').trim().toUpperCase()
      if (!(inc && parent === '') && parent !== 'NONE' && !influencers.some((i) => i.influencer_id === parent)) throw new EngineError('소속 인플루언서 ID 를 목록에서 고르거나 해당 없음(NONE)을 골라 주세요')
      v.parentInfluencerId = parent
      const lines = [...new Set(campaigns.map((c) => String(c.product_line)))]
      const pl = (input.values.productLine ?? '').trim()
      if (!pl && !inc) throw new EngineError('제품 종류(색조·기초 등)를 골라 주세요')
      if (pl && !lines.includes(pl)) throw new EngineError(`제품 종류는 ${lines.join(' · ')} 중에서 골라 주세요`)
      v.productLine = pl
      // 캠페인 이름 자동 생성: 그 인플루언서의 다음 번호 (원본 이름 방식 — 혜인 색조 캠페인1, 혜인 색조 캠페인2, 혜인 기초 캠페인3 …)
      const parentName = parent && parent !== 'NONE' ? String(influencers.find((i) => i.influencer_id === parent)?.influencer_name ?? '') : ''
      const sameParent = (id: unknown) => (parent === 'NONE' ? !id || id === 'NONE' : id === parent)
      const pending = await sql`SELECT input FROM submissions WHERE category = 'campaign' AND input->>'isNewRef' = '1' AND status <> 'returned'`
      const maxN = Math.max(
        0,
        ...campaigns.filter((c) => sameParent(c.influencer_id)).map((c) => campaignNumber(String(c.campaign_name))),
        ...pending.filter((r: any) => sameParent(r.input?.parentInfluencerId)).map((r: any) => campaignNumber(String(r.input?.refName ?? ''))),
      )
      v.refName = nextCampaignName(parentName, pl, maxN)
    }
    name = cat.id === 'campaign' ? v.refName : refName ? `${refName}(${refId})` : refId
  } else if (cat.id === 'influencer') {
    const infl = influencers.find((i) => i.influencer_id === refId)
    if (!infl) throw new EngineError(`인플루언서 ${refId} 를 찾을 수 없어요 (새로 등록하려면 "신규 ID 입력"을 고르세요)`)
    name = `${infl.influencer_name}(${refId})`
  } else {
    const c = campaigns.find((x) => x.campaign_id === refId)
    if (!c) throw new EngineError(`캠페인 ${refId} 를 찾을 수 없어요 (새로 등록하려면 "신규 ID 입력"을 고르세요)`)
    name = String(c.campaign_name)
    v.productLine = String(c.product_line) // 기존 캠페인의 제품 종류는 원본 마스터 값
  }
  const amountText = v.requested ? `${Number(v.requested).toLocaleString('ko-KR')}원` : '금액 미입력'
  if (inc) {
    const miss = missingRequired(cat.id, v, input.files.map((f) => f.kind))
    if (miss.length > 0) v.incomplete = '1'
  }
  // 제목은 자동으로 만든다 (제출 화면의 미리보기와 같은 규칙). 이미 있는 제목과 겹치면 구분 뒤에 번호를 올린다 (확대2, 확대3 …).
  const existingTitles = [
    ...(await sql`SELECT title FROM submissions`).map((r: any) => String(r.title)),
    ...(await sql`SELECT title FROM decision_cases`).map((r: any) => String(r.title)),
  ]
  const title = uniqueTitle({ category: cat.id, name, deal, feeType: v.feeType, amountText }, existingTitles)

  return (await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const [row] = await t`
      INSERT INTO submissions (category, ref_id, title, input, submitted_by, accept_role)
      VALUES (${cat.id}, ${refId}, ${title}, ${t.json(v as never)}, ${input.by}, ${cat.acceptRole}) RETURNING *`
    for (const f of input.files) {
      await t`INSERT INTO submission_files (submission_id, kind, label, filename, mime, size, content) VALUES (${row.id}, ${f.kind}, ${f.kind === CUSTOM_KIND ? (f.label ?? '').trim() : null}, ${f.filename}, ${f.mime || 'application/octet-stream'}, ${f.content.length}, ${f.content})`
    }
    return toRow(row)
  })) as SubmissionRow
}

/** 같은 대상으로 이미 진행 중인 안건 (접수 체크리스트의 '중복 없음' 확인용) */
export async function findOpenCasesFor(sql: Sql, category: CategoryId, refId: string): Promise<{ id: number; title: string; status: string }[]> {
  const key = category === 'influencer' ? 'influencer' : 'campaign'
  const rows = await sql`
    SELECT id, title, status FROM decision_cases
    WHERE subject_refs->>${key} = ${refId} AND status NOT IN ('closed', 'rejected') ORDER BY id`
  return rows.map((r: any) => ({ id: Number(r.id), title: r.title, status: r.status }))
}

/** 접수: 체크리스트를 모두 확인했을 때만 안건으로 만든다. 만들면 규칙집이 바로 평가한다. */
export async function acceptSubmission(
  sql: Sql, cfg: EngineConfig, id: number, by: string, checked: string[], draftId: number | null = null,
): Promise<{ caseId: number; authorityLabel: string | null; needInfo: boolean }> {
  const [row] = await sql`SELECT * FROM submissions WHERE id = ${id}`
  if (!row) throw new EngineError('접수 대기 안건을 찾을 수 없어요')
  const s = toRow(row)
  if (s.status !== 'pending') throw new EngineError('이미 처리된 안건이에요')
  const need = checksFor(s.category, s.input.isNewRef === '1')
  const files = await listFiles(sql, s.id)
  const missing = [
    ...need.filter((c) => !checked.includes(c.id)).map((c) => c.label.slice(0, 18)),
    ...files.filter((f) => !checked.includes(fileCheckId(f.id))).map((f) => `첨부 ${f.filename}`),
  ]
  if (missing.length > 0) throw new EngineError(`확인하지 않은 항목이 있어요: ${missing.join(' / ')}`)
  // 필수 항목을 채우지 않고 제출된 건은 비어 있는 항목이 남아 있으면 접수할 수 없다 (반려해서 보완하게 한다)
  if (s.input.incomplete === '1') {
    const miss = missingRequired(s.category, s.input, files.map((f) => f.kind))
    if (miss.length > 0) throw new EngineError(`필수 항목이 비어 있어 접수할 수 없어요: ${miss.join(', ')}. 반려해서 팀원이 다시 올리게 해 주세요`)
  }
  if (draftId !== null && (await sql`SELECT 1 FROM drafts WHERE id = ${draftId}`).length === 0) throw new EngineError('고른 기안을 찾을 수 없어요')

  const v = s.input
  const contrib = contributionFromInput(v)
  const result = calcContribution(contrib)
  const submission = {
    id: s.id, submittedBy: s.submittedBy, category: s.category, refId: s.refId, submittedAt: s.createdAt,
    newRef: v.isNewRef === '1' ? { id: s.refId, name: v.refName, parentInfluencerId: v.parentInfluencerId ?? null, origin: '사용자입력(원본에 없는 신규 ID)' } : null,
    calc: { inputs: contrib, result, origin: '가정(추계)' },
    checklist: { by, at: new Date().toISOString(), items: [...need.map((c) => c.label), ...files.map((f) => `첨부서류 확인: ${f.label ?? f.filename}${f.label ? ` (${f.filename})` : ''}`)] },
    memo: v.memo ?? '',
  }
  let res: { caseId: number; decision: { status: string; authorityLabel: string | null } }
  if (s.category === 'influencer') {
    res = await receiveContractNotice(sql, cfg, {
      influencerId: s.refId, annualFixedFeeKrw: Math.round(Number(v.requested)), notifyDeadline: v.contractDeadline,
      feeType: v.feeType || undefined, fixedFeeKrw: v.fixedFee ? Number(v.fixedFee) : undefined, performanceFeeKrw: v.performanceFee ? Number(v.performanceFee) : undefined, performanceRate: v.performanceRate ? Number(v.performanceRate) : undefined,
      currentExpiry: v.currentExpiry || null, fixedFeePaymentDate: v.settlementDate || null, note: v.memo ?? '',
      newInfluencerName: v.isNewRef === '1' ? v.refName : undefined,
    }, by)
    // 새 방식으로 제출된 건은 제출 때 자동 생성한 제목을 안건 제목으로 쓴다
    if (v.dealType) await sql`UPDATE decision_cases SET title = ${s.title} WHERE id = ${res.caseId}`
  } else {
    const camp = (await entityRows(sql, MASIL_MODEL, 'campaign')).find((c) => c.campaign_id === s.refId)
    const campName = camp ? String(camp.campaign_name) : v.isNewRef === '1' ? v.refName : s.refId
    const parentInfl = camp ? String(camp.influencer_id) : v.parentInfluencerId || 'NONE'
    const amount = Math.round(Number(v.requested))
    res = await openCase(sql, cfg, {
      caseType: EXPANSION_CASE_TYPE,
      title: v.dealType
        ? `SUB-${s.id} ${s.title}` // 제출 때 자동 생성한 제목 (예: SUB-12 혜인 기초 캠페인3 확대 — 요청 15,000,000원)
        : `SUB-${s.id} ${campName} 집행 — 요청 ${fmtWon(amount)}${v.isNewRef === '1' ? ' [신규 ID]' : ''}`,
      deadline: v.contractDeadline,
      subjectRefs: { plan: `SUB-${s.id}`, campaign: s.refId, influencer: parentInfl },
      payload: {
        facts: { per_plan_amount_krw: amount, draft_total_krw: amount, creates_cash_outflow: true, linked_to_group_300: null },
        plan: { plan_id: `SUB-${s.id}`, campaign_id: s.refId, requested_budget_krw: String(amount), expected_gmv_krw: String(contrib.gmv), settlement_date: v.settlementDate, contract_deadline: v.contractDeadline },
        memo: v.memo ?? '',
      },
      dataOrigin: '사용자입력',
      actorName: by,
    })
  }
  await sql`UPDATE decision_cases SET payload = payload || ${sql.json({ submission } as never)} WHERE id = ${res.caseId}`
  await sql`UPDATE submissions SET status = 'accepted', decided_by = ${by}, decided_at = now(), case_id = ${res.caseId} WHERE id = ${id}`
  // 기안 접수: 고른 기안에 묶어 넣거나(여러 팀원의 안건을 하나로 모음), 고르지 않으면 새 기안 하나로 등록된다
  if (draftId !== null) await sql`UPDATE decision_cases SET draft_id = ${draftId} WHERE id = ${res.caseId}`
  await assignDrafts(sql)
  return { caseId: res.caseId, authorityLabel: res.decision.authorityLabel, needInfo: res.decision.status !== 'decided' }
}

export async function returnSubmission(sql: Sql, id: number, by: string, note: string) {
  const [row] = await sql`SELECT status FROM submissions WHERE id = ${id}`
  if (!row) throw new EngineError('접수 대기 안건을 찾을 수 없어요')
  if (row.status !== 'pending') throw new EngineError('이미 처리된 안건이에요')
  await sql`UPDATE submissions SET status = 'returned', decided_by = ${by}, decided_at = now(), note = ${note || null} WHERE id = ${id}`
}
