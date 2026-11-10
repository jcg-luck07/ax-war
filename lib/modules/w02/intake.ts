// 안건 접수 — 새 일이 들어오는 입구 (서버 전용). 접수하면 곧바로 규칙집이 평가해서 승인 요청 또는 확인 요청이 생긴다.
//  1) 캠페인 확대 기안: 마케팅팀이 올린 기안(mkt_budget_plan_ms)을 한꺼번에 접수한다. 이미 접수한 기안은 건너뛴다.
//  2) 전속계약 갱신 통보: 통보서의 값을 입력해 접수한다.
//  3) 재고 발주 승인 요청: 발주 내용을 입력해 접수한다.
import type { Sql } from 'postgres'
import { EngineError, listCases, openCase, type EngineConfig } from '@/lib/engine/engine'
import { fmtWon } from '@/lib/app/format'
import { MASIL_MODEL } from '@/lib/semantic/model'
import { entityRows } from '@/lib/semantic/run'
import { CONTRACT_CASE_TYPE, EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'
import { PO_CASE_TYPE } from '@/lib/modules/w01/handlers'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const isDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(s))

/** 아직 접수하지 않은 확대 기안 목록 */
export async function pendingExpansionPlans(sql: Sql) {
  const [plans, existing] = await Promise.all([entityRows(sql, MASIL_MODEL, 'budget_plan'), listCases(sql, { caseType: EXPANSION_CASE_TYPE })])
  const done = new Set(existing.map((c) => c.subjectRefs.plan))
  return { all: plans, fresh: plans.filter((p) => !done.has(String(p.plan_id))) }
}

export async function importExpansionPlans(sql: Sql, cfg: EngineConfig, actorName: string): Promise<{ imported: number; skipped: number }> {
  const [{ all, fresh }, campaigns, influencers] = await Promise.all([
    pendingExpansionPlans(sql),
    entityRows(sql, MASIL_MODEL, 'campaign'),
    entityRows(sql, MASIL_MODEL, 'influencer'),
  ])
  if (all.length === 0) throw new EngineError('원본 자료가 DB 에 없어요. 관리자에게 자료 적재(node scripts/ingest.mjs)를 요청하세요.')
  const campById = new Map(campaigns.map((c) => [String(c.campaign_id), c]))
  const inflById = new Map(influencers.map((i) => [String(i.influencer_id), i]))
  // 승인 한도(기안 총액 1억 원)는 같은 기안 묶음 전체의 요청액 합계로 본다
  const draftTotal = all.reduce((s, p) => s + Number(p.requested_budget_krw), 0)
  for (const p of fresh) {
    const camp = campById.get(String(p.campaign_id))
    const infl = camp ? inflById.get(String(camp.influencer_id)) : undefined
    const amount = Number(p.requested_budget_krw)
    await openCase(sql, cfg, {
      caseType: EXPANSION_CASE_TYPE,
      title: `${p.plan_id} ${camp?.campaign_name ?? p.campaign_id} 확대 — 요청 ${fmtWon(amount)}`,
      deadline: String(p.contract_deadline),
      subjectRefs: { plan: String(p.plan_id), campaign: String(p.campaign_id), influencer: String(camp?.influencer_id ?? 'NONE') },
      payload: {
        facts: { per_plan_amount_krw: amount, draft_total_krw: draftTotal, creates_cash_outflow: true, linked_to_group_300: null },
        plan: { ...p, influencer_name: infl?.influencer_name ?? null },
      },
      dataOrigin: '원본',
      actorName,
    })
  }
  return { imported: fresh.length, skipped: all.length - fresh.length }
}

export interface ContractNoticeInput {
  influencerId: string
  annualFixedFeeKrw: number
  notifyDeadline: string
  currentExpiry: string
  fixedFeePaymentDate: string | null
  note: string
}

export async function receiveContractNotice(sql: Sql, cfg: EngineConfig, input: ContractNoticeInput, actorName: string) {
  const influencers = await entityRows(sql, MASIL_MODEL, 'influencer')
  const infl = influencers.find((i) => i.influencer_id === input.influencerId)
  if (!infl) throw new EngineError(`인플루언서 번호 ${input.influencerId} 를 찾을 수 없어요 (예: INF-001)`)
  if (!(input.annualFixedFeeKrw > 0)) throw new EngineError('연 고정 피는 0보다 커야 해요')
  if (!isDate(input.notifyDeadline)) throw new EngineError('통보 기한을 YYYY-MM-DD 로 입력해 주세요')
  if (!isDate(input.currentExpiry)) throw new EngineError('현 계약 만료일을 YYYY-MM-DD 로 입력해 주세요')
  if (input.fixedFeePaymentDate && !isDate(input.fixedFeePaymentDate)) throw new EngineError('고정 피 지급일을 YYYY-MM-DD 로 입력해 주세요')
  const existing = (await listCases(sql, { caseType: CONTRACT_CASE_TYPE })).find(
    (c) => c.subjectRefs.influencer === input.influencerId && c.deadline === input.notifyDeadline && !['closed'].includes(c.status),
  )
  if (existing) throw new EngineError(`같은 인플루언서·통보 기한의 안건이 이미 있어요 (#${existing.id})`)
  return openCase(sql, cfg, {
    caseType: CONTRACT_CASE_TYPE,
    title: `${infl.influencer_name}(${input.influencerId}) 연간 전속계약 갱신 — 고정 피 연 ${fmtWon(input.annualFixedFeeKrw)}`,
    deadline: input.notifyDeadline,
    subjectRefs: { influencer: input.influencerId },
    payload: {
      facts: {
        annual_contract_value_krw: input.annualFixedFeeKrw,
        creates_cash_outflow: true,
        fixed_fee_payment_date: input.fixedFeePaymentDate, // 모르면 null → 확인 요청
        linked_to_group_300: null,
      },
      contract: { currentExpiry: input.currentExpiry, notifyDeadline: input.notifyDeadline, note: input.note },
    },
    dataOrigin: '사용자입력',
    actorName,
  })
}

export interface PurchaseRequestInput {
  title: string
  skuId: string
  amountKrw: number
  paymentDueDate: string | null
}

export async function requestPurchaseOrder(sql: Sql, cfg: EngineConfig, input: PurchaseRequestInput, actorName: string) {
  if (!input.title.trim()) throw new EngineError('발주 내용을 입력해 주세요')
  if (!(input.amountKrw > 0)) throw new EngineError('발주 금액은 0보다 커야 해요')
  if (input.paymentDueDate && !isDate(input.paymentDueDate)) throw new EngineError('대금 지급 예정일을 YYYY-MM-DD 로 입력해 주세요')
  return openCase(sql, cfg, {
    caseType: PO_CASE_TYPE,
    title: `${input.title.trim()} — ${fmtWon(input.amountKrw)}`,
    deadline: null,
    subjectRefs: input.skuId ? { sku: input.skuId } : {},
    payload: { facts: { creates_cash_outflow: true, payment_due_date: input.paymentDueDate, linked_to_group_300: false }, order: { amountKrw: input.amountKrw } },
    dataOrigin: '사용자입력',
    actorName,
  })
}
