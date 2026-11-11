// 안건 하나의 "요약에 쓸 근거"를 만든다. 숫자는 모두 코드가 계산한 값이고, 여기서는 읽기 좋게 서식만 입힌다.
// 대안은 문서·규칙에서 나온 후보만 담는다(새로 지어내지 않는다).
import { daysUntil, type CaseView } from '@/lib/engine/engine'
import type { BriefInput } from '@/lib/app/brief'
import { fmtPct, fmtRoas, fmtWon } from '@/lib/app/format'
import type { PerformanceResult } from '@/lib/metrics/performance'
import type { CashResult } from '@/lib/modules/cash/simulate'
import { CONTRACT_CASE_TYPE, CONTRACT_NOTICE, EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'
import type { AuthorityDecision } from '@/lib/rules/types'

const fmtDateStr = (s: string) => s // 날짜는 YYYY-MM-DD 그대로 보여 준다

export interface EvidenceCtx {
  asOf: string
  perf: PerformanceResult | null
  cash: CashResult | null
}

export function buildBriefInput(view: CaseView, ctx: EvidenceCtx): BriefInput {
  const c = view.case
  const payload = c.payload as {
    evaluation?: { decision?: AuthorityDecision; facts?: Record<string, unknown> }
    plan?: { requested_budget_krw?: string; settlement_date?: string; expected_gmv_krw?: string }
  }
  const d = payload.evaluation?.decision
  const facts = (payload.evaluation?.facts ?? {}) as Record<string, unknown>
  const evidence: BriefInput['evidence'] = []
  const alternatives: string[] = []
  const caveats: string[] = []

  // ── 인플루언서 성과 (표본) ──
  const infId = c.subjectRefs.influencer
  const p = ctx.perf?.byInfluencer.find((x) => x.influencerId === infId)
  if (ctx.perf && p) {
    const n = ctx.perf.byInfluencer.length
    evidence.push({ label: 'GMV 순위', value: `${n}명 중 ${p.rankByGmv}위` })
    evidence.push({ label: '광고비 집행 비중', value: fmtPct(p.spendShare), note: `${n}명 중 ${p.rankBySpend}위` })
    evidence.push({
      label: '실질 공헌이익 순위',
      value: `${n}명 중 ${p.rankByContribution}위`,
      note: `표본 기준 ${fmtWon(p.contributionProfit)}, 실질 ROAS ${fmtRoas(p.realRoas)}`,
    })
    const a = ctx.perf.alignment
    if (a.spearman !== null) {
      evidence.push({ label: '배분-성과 정렬도', value: `${a.spearman.toFixed(2)} (${a.direction})`, note: '광고비 순위와 공헌이익 순위의 상관, 10명 표본' })
    }
    caveats.push('마케팅 성과는 대표 표본 자료라 순위·비중·방향만 말하고, 연간 금액이나 계약 금액과 곱해 손익으로 환산하지 않는다.')
    caveats.push(`공헌이익은 원가·배송비를 주문 1건에 ${ctx.perf.assumptions.unitsPerOrder}회 적용한다는 가정으로 계산했고, 긴급배송 추가비용·CS 문의 비용은 자료가 없어 빠져 있다(실제보다 낙관적일 수 있음).`)
    if (ctx.perf.alignment.direction === '반대 방향' && ctx.perf.alignment.spearman !== null && ctx.perf.alignment.spearman > -0.5) {
      caveats.push('정렬도는 기준선을 겨우 넘은 약한 값이라 "정반대"로 단정하지 않는다.')
    }
  }

  // ── 안건 유형별 근거·대안 ──
  if (c.caseType === CONTRACT_CASE_TYPE) {
    const fee = Number(facts.annual_contract_value_krw ?? 0)
    const dl = c.deadline ?? '기한 미입력'
    evidence.push({ label: '연 고정 피', value: fmtWon(fee), note: '성과와 무관하게 발생' })
    evidence.push({ label: '통보 기한', value: dl, note: '넘기면 동일 조건 1년 자동 갱신(체결로 간주)' })
    alternatives.push(`기한(${dl}) 전에 조건 변경(고정 피 인하 등)을 통보한다`)
    alternatives.push(`기한(${dl}) 전에 해지를 통보한다 (갱신 후 해지는 잔여 고정 피 일부를 위약금으로 내는 조건일 수 있음)`)
    alternatives.push('조건 그대로 갱신을 승인한다')
    caveats.push('성과 피(GMV 연동) 정산 조건과 고정 피 지급 일정은 계약 원문이 없으면 확인되지 않는다.')
  } else if (c.caseType === EXPANSION_CASE_TYPE) {
    const amount = Number(payload.plan?.requested_budget_krw ?? facts.per_plan_amount_krw ?? 0)
    evidence.push({ label: '요청액', value: fmtWon(amount) })
    evidence.push({ label: '기안 요청 총액', value: fmtWon(Number(facts.draft_total_krw ?? 0)), note: '25건 합계, 승인 한도 판단 기준' })
    const sd = (facts.settlement_date as string | undefined) ?? payload.plan?.settlement_date
    if (sd) evidence.push({ label: '집행 예정일', value: fmtDateStr(sd) })
    if (facts.in_cash_breach_window === true && ctx.cash?.windows.length) {
      const w = ctx.cash.windows[0]
      evidence.push({ label: '현금 하회 예상 구간', value: `${fmtDateStr(w.start)} ~ ${fmtDateStr(w.end)}`, note: '집행 예정일이 이 구간 안' })
      alternatives.push('재무와 협의해 집행 예정일을 하회 구간이 끝난 뒤로 조정한다 (조정되면 승인권자가 낮아질 수 있음)')
    }
    alternatives.push('부결하고 전속계약은 별도로 결정한다 (기안을 부결해도 전속계약은 갱신될 수 있음)')
    caveats.push('이 기안은 현금 재전망의 유출 산식에 포함되지 않아 부결해도 전망상 최저 잔액이 바뀌지 않는다. 마케팅은 자금 문제의 해법이 아니다.')
  }

  if (ctx.cash && c.caseType !== CONTRACT_CASE_TYPE) {
    caveats.push('현금 재전망은 이미 확정된 회수·지급 스케줄만 합산한 값으로, 신규 매출 회수는 반영하지 않았고 재무팀 공식 전망과 차이가 있다.')
  }

  return {
    caseTitle: c.title,
    caseType: c.caseType,
    deadline: { date: c.deadline, daysLeft: daysUntil(c.deadline, ctx.asOf) },
    decision: d
      ? {
          status: d.status,
          authorityLabel: d.authorityLabel,
          also: d.also,
          trace: d.trace,
          unresolved: d.unresolved.map((u) => ({ title: u.title, missingFacts: u.missingFacts })),
        }
      : { status: 'no_rule', authorityLabel: null, also: [], trace: [], unresolved: [] },
    evidence,
    alternatives,
    caveats,
  }
}

// ───────── 업무 흐름 단계별 자료 (노드를 눌렀을 때 보여 줄 근거) ─────────
// 숫자는 모두 시맨틱 레이어·원본 파일에서 온 값이고, 어느 파일에서 왔는지 같이 적는다.

export interface StepPackage {
  /** 이 단계에서 모은(또는 모아야 할) 자료. "항목: 값 — 출처" 한 줄씩 */
  lines: string[]
  /** 원본에 없어 확인되지 않은 것 */
  missing: string[]
}

/** 재무: 성과·비용표 취합 단계 */
export function financePackage(view: CaseView, ctx: EvidenceCtx): StepPackage {
  const c = view.case
  const payload = c.payload as { plan?: Record<string, string | null>; facts?: Record<string, unknown>; order?: { amountKrw?: number } }
  const lines: string[] = []
  const missing: string[] = []
  const plan = payload.plan
  if (plan?.plan_id) {
    lines.push(`기안 ${plan.plan_id}: 요청 예산 ${fmtWon(Number(plan.requested_budget_krw))}, 예상 GMV ${fmtWon(Number(plan.expected_gmv_krw))} — 02_masil/marketing/mkt_budget_plan_ms.csv`)
    if (plan.settlement_date) lines.push(`집행(지급) 예정일: ${plan.settlement_date} · 계약 확정기한: ${plan.contract_deadline ?? '없음'} — 같은 파일`)
  }
  if (payload.order?.amountKrw) lines.push(`발주 금액: ${fmtWon(payload.order.amountKrw)} — 접수 입력`)
  const perf = ctx.perf
  const camp = perf?.byCampaign.find((x) => x.campaignId === c.subjectRefs.campaign)
  const inf = perf?.byInfluencer.find((x) => x.influencerId === c.subjectRefs.influencer)
  if (perf && camp) {
    lines.push(`캠페인 ${camp.campaignName}(${camp.campaignId}) 실적: GMV ${fmtWon(camp.gmv)}, 환불 ${fmtWon(camp.refund)}, 광고비 ${fmtWon(camp.adSpend)}`)
    lines.push(`  → 순매출 ${fmtWon(camp.netRevenue)}, 실질 공헌이익 ${fmtWon(camp.contributionProfit)}, 실질 ROAS ${fmtRoas(camp.realRoas)} — 주문·반품·광고비·원가표(mkt_orders/returns/ad_spend/cost_master)를 시맨틱 레이어로 계산`)
  }
  if (perf && inf) {
    const n = perf.byInfluencer.length
    lines.push(`인플루언서 ${inf.influencerName}(${inf.influencerId}): GMV ${n}명 중 ${inf.rankByGmv}위, 광고비 비중 ${fmtPct(inf.spendShare)} (${inf.rankBySpend}위), 실질 공헌이익 ${fmtWon(inf.contributionProfit)} (${inf.rankByContribution}위)`)
  }
  if (perf) {
    lines.push(`가정: 원가·배송비는 주문 1건에 ${perf.assumptions.unitsPerOrder}회 적용, 환불 시 원가 ${perf.assumptions.recoverCostOnRefund ? '회수' : '미회수'}. 긴급배송 추가비용·CS 문의 비용은 자료가 없어 빠짐`)
  } else {
    missing.push('원본 자료가 DB 에 없어 캠페인·인플루언서 성과를 계산하지 못했어요')
  }
  const f = (c.payload as { evaluation?: { facts?: Record<string, unknown> } }).evaluation?.facts ?? {}
  if (ctx.cash) {
    const w = ctx.cash.windows
    lines.push(w.length ? `현금 재전망 하회 구간: ${w.map((x) => `${x.start}~${x.end}`).join(', ')} (최소현금 30억 기준) — 02_masil/financials 자금·채권·채무 파일로 재계산` : '현금 재전망: 하회 구간 없음')
    if (f.in_cash_breach_window === true) lines.push('이 안건의 돈 나가는 날이 하회 구간 안에 있어요 → CEO/이사회 승인 필요')
  }
  if (c.caseType === CONTRACT_CASE_TYPE) {
    const fee = Number(f.annual_contract_value_krw ?? 0)
    if (fee) lines.push(`전속계약 연 고정 피: ${fmtWon(fee)} — 접수 입력 (성과 피는 계약 원문이 없어 포함 안 됨)`)
    missing.push('고정 피 지급 일정(현금 유출일)이 문서에 없음')
  }
  if (c.caseType === EXPANSION_CASE_TYPE) missing.push('그룹 300억 배분 사업 연결 여부 — 회의록에서 정리되지 않음 (재무가 회신)')
  return { lines, missing }
}

/** 계약 담당: 계약조건·기한 확인 단계 */
export function contractPackage(view: CaseView, asOf: string): StepPackage {
  const c = view.case
  const payload = c.payload as { contract?: { currentExpiry?: string; notifyDeadline?: string; note?: string }; plan?: Record<string, string | null> }
  const lines: string[] = []
  const missing: string[] = []
  const inf = c.subjectRefs.influencer
  if (c.caseType === CONTRACT_CASE_TYPE) {
    const k = payload.contract
    const isNewContract = !k?.currentExpiry
    lines.push(isNewContract
      ? `계약 체결 기한: ${k?.notifyDeadline ?? c.deadline ?? '미입력'} (${ddayLabel(c.deadline, asOf)}) — 신규 인플루언서라 현 계약·자동 갱신이 없고, 이 기한까지 계약을 맺어야 해요`
      : `통보 기한: ${k?.notifyDeadline ?? c.deadline ?? '미입력'} (${ddayLabel(c.deadline, asOf)}) — 넘기면 동일 조건 1년 자동 갱신, 체결로 간주`)
    if (k?.currentExpiry) lines.push(`현 계약 만료일: ${k.currentExpiry}`)
    lines.push('승인권한: 연 10억 원 초과 전속계약은 CEO/이사회, 미통보 자동 갱신도 체결로 봄 — 00_common/approval_authority_policy.md')
  } else if (c.caseType === EXPANSION_CASE_TYPE) {
    const dl = payload.plan?.contract_deadline ?? c.deadline
    lines.push(`계약 확정기한: ${dl ?? '없음'} (${ddayLabel(dl ?? null, asOf)}) — 넘기면 자동 확정되어 철회 불가, 하회 구간보다 앞서면 기한 전에 상신 (covenant_terms_ms.md)`)
    lines.push('캠페인 확대 기안과 연간 전속계약은 별개 결정 — 기안을 부결해도 전속계약 자동 갱신은 막지 못함 (W02 안내)')
  }
  if (inf === CONTRACT_NOTICE.influencerId) {
    lines.push(`${CONTRACT_NOTICE.influencerName}(${inf}) 전속계약: 고정 피 연 ${fmtWon(CONTRACT_NOTICE.annualFixedFeeKrw)}, 만료일 ${CONTRACT_NOTICE.currentExpiry}, 통보 기한 ${CONTRACT_NOTICE.notifyDeadline}, 갱신 후 중도 해지 시 잔여 고정 피의 50% 위약금 — ${CONTRACT_NOTICE.sourceFile}`)
  } else if (inf && inf !== 'NONE') {
    lines.push(`${inf} 의 계약 문서는 제공되지 않았어요`)
  }
  missing.push('성과 피(GMV 연동) 정산 조건 원문 없음', '실제 통보 수령 증빙 없음')
  return { lines, missing }
}

const ddayLabel = (d: string | null, asOf: string) => {
  if (!d) return '기한 없음'
  const n = daysUntil(d, asOf)
  return n === null ? '기한 없음' : n > 0 ? `${n}일 남음` : n === 0 ? '오늘' : `${-n}일 지남`
}
