import Link from 'next/link'
import { Card } from '@heroui/react'
import { Warning } from '@phosphor-icons/react/ssr'
import { ProfitabilityCard } from '@/components/ProfitabilityCard'
import { judge } from '@/lib/modules/w02/ai-judgment'
import { buildJudgmentInput } from '@/lib/modules/w02/judgment-input'
import { buildProfitability, buildShareCompare } from '@/lib/modules/w02/profitability'
import { MASIL_MODEL } from '@/lib/semantic/model'
import { entityRows } from '@/lib/semantic/run'
import { Pill } from '@/components/bits'
import { DecisionPanel, InfoReplyForm, ResubmitButton, TaskDoneButton } from '@/components/case-actions'
import { ContractReferPanel, FinanceReferItems, NonrenewalRequestPanel, RecordReplyPanel, type CheckItem } from '@/components/handoff-panels'
import { REWORK_TARGETS, listCaseFiles } from '@/lib/modules/w02/handoff'
import { NumberedList } from '@/components/NumberedList'
import { RevisionPanel } from '@/components/revision-panel'
import { amountKeyOf, type RevisionRecord } from '@/lib/modules/w02/revision'
import { FlowExplorer } from '@/components/FlowExplorer'
import { LANES_OF_ROLE } from '@/lib/process/detail'
import { canHandle, currentUser, decidingRole, roleLabels } from '@/lib/app/auth'
import { flowForCaseType, flowWithoutGroupReport } from '@/lib/process/definitions'
import { deriveFlowState } from '@/lib/process/state'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import {
  EVENT_LABEL, FACT_LABEL, TASK_TYPE, ddayText, fmtDateTime, fmtFact, fmtWon,
} from '@/lib/app/format'
import { tryPerformance } from '@/lib/app/queries'
import { EngineError, daysUntil, getCaseView, type EventRow, type CaseView } from '@/lib/engine/engine'
import { contractPackage } from '@/lib/modules/w02/evidence'
import { ATTACHMENT_KINDS, CUSTOM_KIND, listFiles } from '@/lib/modules/intake/submissions'
import { outflowDate, w02Notes, type W02Ctx } from '@/lib/modules/w02/handlers'
import { beyondGroupFundPeriod, groupFundPeriodEnd } from '@/lib/modules/w02/group-fund'
import { EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'
import { feeText, loadCaseRows, type FeeInfo } from '@/lib/app/case-list'
import { relatedWarning } from '@/lib/app/related-warning'
import { authorityShort, authorityText } from '@/lib/app/approver'
import { CASE_TYPE_CATEGORY } from '@/lib/app/labels'
import type { AuthorityDecision } from '@/lib/rules/types'

function eventSummary(e: EventRow): string {
  const d = e.detail as Record<string, unknown>
  switch (e.eventType) {
    case 'created':
      return `${d.title ?? ''}`
    case 'evaluated': {
      const trace = (d.trace as string[] | undefined) ?? []
      return trace.length ? trace[trace.length - 1] : ''
    }
    case 'approval_requested':
      return `${d.requiredLabel ?? ''} 승인 요청${(d.also as string[] | undefined)?.length ? ` · ${(d.also as string[]).join(', ')}` : ''}`
    case 'approval_superseded':
      return `${d.oldRole ? roleLabel(String(d.oldRole)) : ''} 승인 요청이 대체됐어요${d.newRole ? ` → ${roleLabel(String(d.newRole))}` : ' (확인 필요)'}`
    case 'decided':
      return `${d.byRoleLabel} 가 ${d.outcome === 'approved' ? '승인' : d.outcome === 'rejected' ? '부결' : '재검토'}${d.comment ? ` — ${d.comment}` : ''}`
    case 'status_changed':
      return `${d.from} → ${d.to}`
    case 'task_created':
      return `${d.title} (담당 ${d.assigneeRole ?? '미정'})`
    case 'task_done':
      return `${d.title}`
    case 'facts_changed': {
      const ch = (d.changed ?? {}) as Record<string, { before: unknown; after: unknown }>
      const parts = Object.entries(ch).map(([k, v]) => `${FACT_LABEL[k] ?? k}: ${fmtFact(k, v.before)} → ${fmtFact(k, v.after)}`)
      return `${d.reason} · ${parts.join(', ')}`
    }
    case 'info_received': {
      const a = (d.answers ?? {}) as Record<string, unknown>
      return Object.entries(a).map(([k, v]) => `${FACT_LABEL[k] ?? k}: ${fmtFact(k, v)}`).join(', ') + ` (${d.origin})`
    }
    case 'revision_reported': {
      const r = d as unknown as { no: number; fromAmount: number; toAmount: number; pct: number; route: string; reason: string }
      return `${r.no}차 · ${fmtWon(r.fromAmount)} → ${fmtWon(r.toAmount)} (${(r.pct * 100).toFixed(1)}%) · ${r.route}${r.reason ? ` · ${r.reason}` : ''}`
    }
    case 'resubmitted':
      return `${d.reason}`
    default:
      return ''
  }
}

/** 안건 하나의 업무 흐름표·같이 봐야 할 점·다음 행동·요약·작업·이력. 안건 목록 화면의 아래쪽에서 쓴다. */
/** 연관 안건 표의 줄 높이(px) — 표와 왼쪽 부결 표시 칸의 줄을 맞춘다 */
const ROW_H = 34

export async function CaseDetail({ caseId }: { caseId: number }) {
  const { sql, cfg, cash } = await getEngine()
  let view: CaseView
  try {
    view = await getCaseView(sql, caseId)
  } catch (e) {
    if (e instanceof EngineError) return <p className="t-small">이 안건을 찾을 수 없어요.</p>
    throw e
  }
  const c = view.case
  const perf = await tryPerformance()
  const notes = w02Notes(c, cfg.ctx as W02Ctx)

  const payload = c.payload as { evaluation?: { decision?: AuthorityDecision; facts?: Record<string, unknown> } }
  const decision = payload.evaluation?.decision
  const pending = view.approvals.find((a) => a.status === 'pending')
  const openInfo = view.tasks.filter((t) => t.taskType === 'info_request' && t.status === 'open')

  // 로그인한 사람이 이 안건에서 무엇을 할 수 있는지 (서버가 동작할 때 한 번 더 확인한다)
  const user = await currentUser(sql)
  const myRoles = roleLabels(user.roles).join(', ')
  const canDecideNow = pending ? decidingRole(user, pending.requiredRole) !== null : false

  // 업무 흐름(BPMN 방식): 선언 + 이 안건의 실제 상태
  const authRole = pending ? pending.requiredRole : decision?.status === 'decided' ? c.authority : null // 모르는 사실이 있으면 잠정값이 있어도 미확정
  // 그룹 보고 단계는 Masil 대표가 승인하는 안건(캠페인·인플루언서 계약 모두)에만 그린다 — 그 밖에는 기록 보관 바로 다음이 계약 체결
  const baseFlow = flowForCaseType(c.caseType)
  const flow = baseFlow && authRole !== 'masil_ceo' ? flowWithoutGroupReport(baseFlow) : baseFlow // Masil 대표가 승인하는 건만 그룹 보고가 있다
  const flowState = flow ? deriveFlowState(flow, view) : null
  // 승인권자가 아직 정해지지 않았으면 흐름표에 "승인권자 미확정"으로 둔다
  const approverLabel = authorityShort(authRole)
  const approverName = authRole ? roleLabel(authRole) : '승인권자'
  const laneLabels = { approver: approverLabel }
  // 내가 맡은 레인: 내 역할의 부서 + (내가 결정할 수 있으면) 승인권자
  const myLanes = [...new Set([...user.roles.flatMap((r) => LANES_OF_ROLE[r] ?? []), ...(canDecideNow ? ['approver'] : [])])]
  // 다음 행동: 지금 이 안건을 처리할 수 있는 부서의 사람에게만 보인다. 나머지는 지금 어느 부서가 처리 중인지만 본다.
  const openTasks = view.tasks.filter((t) => t.status === 'open')
  const gateOpen = openTasks.some((t) => t.detail.gate === 'pre-approval')
  const waiting = (flowState?.current ?? []).map((n) => ({
    laneId: n.lane,
    lane: n.lane === 'approver' ? approverLabel : flow?.lanes.find((l) => l.id === n.lane)?.label ?? n.lane,
    step: n.label,
  }))
  // "지금 ○○에서 처리하고 있어요"는 다른 부서 사람에게만 보인다 (처리하는 부서 사람은 아래에서 직접 처리한다)
  // 보완 요청으로 다른 팀에 돌아간 일도 그 팀이 처리 중인 것으로 보여 준다
  const LANE_OF_ROLE: Record<string, { id: string; label: string }> = { 재무: { id: 'finance', label: '재무팀' }, 마케팅: { id: 'marketing', label: '마케팅팀' }, '계약 담당': { id: 'contract', label: '계약 담당' } }
  for (const t of openTasks.filter((x) => String(x.detail.key ?? '').startsWith('rework:'))) {
    const l = LANE_OF_ROLE[t.assigneeRole ?? '']
    if (l) waiting.push({ laneId: l.id, lane: l.label, step: '보완 요청 처리' })
  }
  const othersWorking = waiting.filter((w) => !myLanes.includes(w.laneId))
  const myDecision = Boolean(pending) && !gateOpen && canDecideNow
  const remainingDays = daysUntil(c.deadline, AS_OF)
  const reviewWarning = remainingDays !== null && remainingDays <= 21
    ? `남은 계약 기한이 ${remainingDays >= 0 ? `${remainingDays}일(3주 이내)` : '이미 지났'}어요 (${c.deadline}). 재검토로 돌려보내면 보완하는 동안 기한이 지나 ${c.caseType === EXPANSION_CASE_TYPE ? '자동 확정(철회 불가)' : '동일 조건 자동 갱신(체결로 간주)'}될 수 있어요.`
    : null
  // 300억 배분 검토 대상 여부 확인은 재무팀 회부 패널에서 한 번에 처리한다
  const collectOpen = openTasks.some((t) => String(t.detail.key) === 'collect-performance')
  const myInfo = openInfo.filter((t) => canHandle(user, t.assigneeRole) && !(collectOpen && t.detail.fact === 'linked_to_group_300'))
  const myTasks = openTasks.filter(
    (t) => t.taskType !== 'info_request' && canHandle(user, t.assigneeRole) && !(t.detail.after && openTasks.some((x) => String(x.detail.key) === String(t.detail.after))),
  )
  const financeTask = myTasks.find((t) => String(t.detail.key ?? '') === 'collect-performance')
  const canResubmit = c.status === 'on_hold' && canHandle(user, '마케팅') // 부결은 진행하지 않는 결정이라 재보고하지 않는다 (재검토만 보완 후 다시 올린다)
  const hasMyAction = Boolean(financeTask) || myDecision || myInfo.length > 0 || myTasks.length > 0 || canResubmit

  // 같이 봐야 할 점: 같은 인플루언서의 연관 캠페인·전속계약 중 이 안건의 계약 체결 기한 기준 앞뒤 1년 이내인 것 (캠페인·계약 안건 모두)
  const addYears = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() + n); return x.toISOString().slice(0, 10) }
  const baseDate = c.deadline ?? AS_OF
  const [winFrom, winTo] = [addYears(baseDate, -1), addYears(baseDate, 1)]
  const hasInfluencer = Boolean(c.subjectRefs.influencer) && c.subjectRefs.influencer !== 'NONE'
  const allRows = hasInfluencer ? await loadCaseRows(sql) : []
  const sameInfluencer = hasInfluencer
    ? allRows
        .filter((r) => r.influencerId === c.subjectRefs.influencer && r.id !== c.id && r.deadline !== null && r.deadline >= winFrom && r.deadline <= winTo)
        .sort((x, y) => (x.deadline ?? '9999').localeCompare(y.deadline ?? '9999'))
    : []
  const relatedCampaigns = sameInfluencer.filter((r) => r.category === 'campaign')
  const relatedContracts = sameInfluencer.filter((r) => r.category === 'influencer')
  const influencerName = perf?.byInfluencer.find((x) => x.influencerId === c.subjectRefs.influencer)?.influencerName ?? c.subjectRefs.influencer
  // 회부·승인 때 띄울 경고: 연관 안건에 부결이 있는가
  const warning = relatedWarning({ category: CASE_TYPE_CATEGORY[c.caseType] ?? null, influencerId: String(c.subjectRefs.influencer ?? ''), id: c.id }, allRows, String(influencerName))

  // 수익성 검증: 이 안건의 대상(인플루언서/캠페인)을 비교 대상과 나란히 놓고, AI 판단(시험용)을 붙인다
  const subCalc = (c.payload as { submission?: { calc?: { inputs?: { gmv: number; refund: number; marketingSpend: number }; result: { netRevenue: number; contributionProfit: number } } } }).submission?.calc
  const [campRows, infRows] = await Promise.all([
    entityRows(sql, MASIL_MODEL, 'campaign').catch(() => []),
    entityRows(sql, MASIL_MODEL, 'influencer').catch(() => []),
  ])
  const profData = buildProfitability({
    kind: c.caseType === EXPANSION_CASE_TYPE ? 'campaign' : 'influencer',
    influencerId: String(c.subjectRefs.influencer ?? ''),
    campaignId: c.subjectRefs.campaign ? String(c.subjectRefs.campaign) : undefined,
    perf,
    campaigns: campRows.map((r) => ({ id: String(r.campaign_id), name: String(r.campaign_name), influencerId: String(r.influencer_id), productLine: String(r.product_line) })),
    influencers: infRows.map((r) => ({ id: String(r.influencer_id), name: String(r.influencer_name), feeType: r.fee_type ? String(r.fee_type) : null })),
    estimate: subCalc?.inputs
      ? { cp: subCalc.result.contributionProfit, netRevenue: subCalc.result.netRevenue, gmv: subCalc.inputs.gmv, spend: subCalc.inputs.marketingSpend, refund: subCalc.inputs.refund }
      : null,
  })
  // 요청 비중(이번 기안의 인플루언서별 요청액) vs 지난 1년 집행 비중 — 캠페인 집행 안건에서만
  const shares = c.caseType === EXPANSION_CASE_TYPE
    ? buildShareCompare({
        requests: (hasInfluencer ? allRows : await loadCaseRows(sql)).filter((r) => r.category === 'campaign' && r.influencerId && r.amount).map((r) => ({ influencerId: r.influencerId, amount: r.amount ?? 0 })),
        perf,
        subjectInfluencerId: String(c.subjectRefs.influencer ?? ''),
      })
    : null
  // 업무 발생 단계: 팀원이 올린 기록(접수 대기 테이블)이 있으면 보여 준다
  const subRef = (c.payload as { submission?: { id?: number } }).submission?.id
  // 팀원이 제출할 때 붙인 서류, 계약 담당이 올린 계약서
  const subFiles = subRef ? await listFiles(sql, subRef) : []
  const caseFiles = await listCaseFiles(sql, c.id)
  const subFileLabel = (f: (typeof subFiles)[number]) => (f.kind === CUSTOM_KIND ? `${f.label ?? '기타'}` : ATTACHMENT_KINDS.find((k) => k.id === f.kind)?.label ?? f.kind)
  const linksOf = (list: typeof subFiles, emptyText: string) =>
    list.length === 0 ? (
      <p className="t-caption">{emptyText}</p>
    ) : (
      <div className="flex flex-col">
        {list.map((f) => (
          <a key={f.id} className="border-b border-default py-1 t-small underline" href={`/api/submission-files/${f.id}`}>
            {subFileLabel(f)} — {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
          </a>
        ))}
      </div>
    )
  const subFileLinks = linksOf(subFiles, subRef ? '제출 때 붙인 첨부가 없어요.' : '원본 기안 파일에서 가져온 안건이라 첨부 파일이 없어요.')
  // 근거 자료로 볼 수 있는 기존 계약서, 그리고 계약 담당에게는 공헌이익(비용 및 성과 추계서)을 보여 주지 않는다
  const oldContracts = subFiles.filter((f) => f.kind === 'contract')
  const contractSideFiles = linksOf(subFiles.filter((f) => f.kind !== 'estimate'), subRef ? '제출 때 붙인 첨부가 없어요.' : '원본 기안 파일에서 가져온 안건이라 첨부 파일이 없어요.')
  const currentLinked300 = ((c.payload as { evaluation?: { facts?: Record<string, unknown> } }).evaluation?.facts ?? {}).linked_to_group_300
  // 300억 배분 집행 기준기간(6개월): 집행 예정일이 이를 넘으면 '대상 아님'이 자동 선택된다 (넘지 않으면 안내 없음)
  const outDate = outflowDate(c)
  const beyondPeriod = beyondGroupFundPeriod(outDate, AS_OF) ? { date: outDate as string, end: groupFundPeriodEnd(AS_OF) } : null
  const lines = (list: string[]) => <>{list.map((l, i) => <p key={i} className="t-small">{l}</p>)}</>
  const contractLines = contractPackage(view, AS_OF).lines
  const feeInfo = (c.payload as { contract?: FeeInfo }).contract
  const contractAmount = Number(((c.payload as { evaluation?: { facts?: Record<string, unknown> } }).evaluation?.facts ?? {}).annual_contract_value_krw ?? 0)
  const feeKnown = c.caseType !== EXPANSION_CASE_TYPE && Boolean(feeInfo?.feeType) // 제출 때 계약 방식·금액을 입력한 전속계약
  // 인플루언서의 보수 구조(원본 마스터): 고정 / 성과 / 고정+성과
  const FEE_WORD: Record<string, string> = { 고정: '고정 피', 성과: '성과 피', '고정+성과': '혼합 피(고정 피 + 성과 피)' }
  const masterFee = profData.subjectFeeType
  const hasPerfFee = feeKnown ? feeInfo?.feeType !== '고정 피' : Boolean(masterFee?.includes('성과'))
  // 빠진 자료 — 꼭 필요한 것만 짧게 알려 준다
  const missingTerms = hasInfluencer && hasPerfFee && !(Number(feeInfo?.performanceRate ?? 0) > 0) ? '성과 피 비율을 아직 몰라요 (마케팅에 확인 필요)' : null
  const missingOldContract = oldContracts.length === 0 ? '기존 계약서 없음 (선택 항목)' : null
  const financeMissing = [missingTerms, missingOldContract].filter((x): x is string => Boolean(x))
  const contractMissing = financeMissing
  const infContractRow = relatedContracts[0]
  // 재무팀: 계약 방식과 고정 피 금액·성과 피 금액·성과 피 비율 (그 밖의 기한·조항 설명은 뺀다)
  const rateKnown = Number(feeInfo?.performanceRate ?? 0) > 0
  const isContractCase = c.caseType !== EXPANSION_CASE_TYPE
  const typeWord = isContractCase ? (feeInfo?.feeType ?? (contractAmount > 0 ? '고정 피' : '')) : (masterFee ? FEE_WORD[masterFee] ?? masterFee : '')
  const needFixedLine = typeWord.includes('고정')
  const needPerfLine = typeWord.includes('성과')
  // 캠페인 안건은 같은 인플루언서의 전속계약 안건에서 금액을 가져온다
  const feeSrc = isContractCase ? { fixed: feeInfo?.feeType ? feeInfo?.fixedFeeKrw ?? null : contractAmount || null, perf: feeInfo?.performanceFeeKrw ?? null } : { fixed: infContractRow?.amount ?? null, perf: null as number | null }
  const termsBody = lines([
    typeWord ? `${isContractCase ? '계약 방식' : '인플루언서 계약 방식'}: ${typeWord}` : '',
    needFixedLine ? `고정 피: ${feeSrc.fixed ? `연 ${fmtWon(feeSrc.fixed)}${isContractCase ? '' : ' (전속계약 안건 기준)'}` : '금액을 아직 몰라요'}` : '',
    needPerfLine ? `성과 피 금액: ${feeSrc.perf ? `연 예상 ${fmtWon(feeSrc.perf)}` : '아직 몰라요'}` : '',
    needPerfLine ? `성과 피 비율: ${rateKnown ? `귀속 GMV의 ${feeInfo?.performanceRate}%` : '아직 몰라요'}` : '',
  ].filter(Boolean))
  // 계약 담당: 계약 방식·금액, 통보(확정) 기한, 만료일, 위약금만
  const penaltyLine = contractLines.join(' ').match(/갱신 후 중도 해지 시[^—,]*위약금/)?.[0]
  const contractTerms = lines([
    ...(c.caseType !== EXPANSION_CASE_TYPE ? [`계약 방식·금액: ${feeText(feeInfo, contractAmount, ((c.payload as { revisions?: unknown[] }).revisions?.length ?? 0) > 0)}`] : []),
    `${c.caseType === EXPANSION_CASE_TYPE ? '계약 확정기한' : '통보 기한'}: ${c.deadline ?? '없음'}${c.deadline ? ` (${ddayText(daysUntil(c.deadline, AS_OF))})` : ''}`,
    ...(c.caseType !== EXPANSION_CASE_TYPE && (c.payload as { contract?: { currentExpiry?: string | null } }).contract?.currentExpiry ? [`현 계약 만료일: ${(c.payload as { contract?: { currentExpiry?: string | null } }).contract?.currentExpiry}`] : []),
    ...(penaltyLine ? [penaltyLine] : []),
  ])
  // 수정 보고: 승인 또는 부결 뒤 금액만 바뀐 경우 — 원 금액·원 첨부는 그대로 두고 바뀐 금액과 추가 첨부를 더한다
  const revPayload = c.payload as { revisions?: RevisionRecord[]; originalAmount?: number; authorityLock?: string }
  const revisions = revPayload.revisions ?? []
  const amountKey = amountKeyOf(c.caseType)
  const currentAmount = Number(((c.payload as { facts?: Record<string, unknown> }).facts ?? {})[amountKey] ?? 0)
  const originalAmount = revPayload.originalAmount ?? currentAmount
  const firstDecided = view.approvals.filter((a) => a.kind === 'main' && (a.status === 'approved' || a.status === 'rejected'))[0]
  const originalApprover = revPayload.authorityLock ?? firstDecided?.requiredRole ?? null
  const canRevise = ['approved', 'rejected', 'closed'].includes(c.status) && Boolean(firstDecided) && currentAmount > 0 && canHandle(user, '마케팅')
  const amountLabel = c.caseType === EXPANSION_CASE_TYPE ? '요청 금액' : '계약 금액'
  const revLine = (r: RevisionRecord) => `${r.no}차 수정 보고 — ${amountLabel} ${fmtWon(r.fromAmount)} → ${fmtWon(r.toAmount)} (${(r.pct * 100).toFixed(1)}% ${r.toAmount > r.fromAmount ? '증가' : '감소'}, ${r.route === 'direct' ? '승인권자에게 바로 보고' : '재무팀 절차부터 다시'})${r.reason ? ` · 사유: ${r.reason}` : ''}`
  const revisionNote = revisions.length > 0 ? lines([`원 ${amountLabel} ${fmtWon(originalAmount)} → 현재 ${fmtWon(currentAmount)}`, ...revisions.map(revLine)]) : null
  const caseFileLabel = (k: string, rev?: number | null) => (k === 'contract' ? '계약서 (계약 담당)' : k === 'notice' ? '통보 회신 증빙 (계약 담당)' : k === 'revision' ? `수정 보고 첨부 (${rev ?? ''}차)` : k)
  const originalFileLinks: { href: string; label: string; size: number }[] = [
    ...subFiles.map((f) => ({ href: `/api/submission-files/${f.id}`, label: `${subFileLabel(f)} — ${f.filename}`, size: f.size })),
    ...caseFiles.map((f) => ({ href: `/api/case-files/${f.id}`, label: `${caseFileLabel(f.kind, f.revision)} — ${f.filename}`, size: f.size })),
  ]
  // 승인권자의 판단 근거: 공헌이익 + 첨부 파일(제출 때 있던 것 + 계약 담당이 올린 것)
  const allFileLinks = (
    <div className="flex flex-col">
      {subFiles.map((f) => (
        <a key={`s${f.id}`} className="border-b border-default py-1 t-small underline" href={`/api/submission-files/${f.id}`}>
          {subFileLabel(f)} — {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
        </a>
      ))}
      {caseFiles.map((f) => (
        <a key={`c${f.id}`} className="border-b border-default py-1 t-small underline" href={`/api/case-files/${f.id}`}>
          {caseFileLabel(f.kind, f.revision)} — {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
        </a>
      ))}
      {subFiles.length === 0 && caseFiles.length === 0 && <p className="t-caption">{subRef ? '첨부된 파일이 없어요.' : '원본 기안 파일에서 가져온 안건이라 첨부 파일이 없어요.'}</p>}
    </div>
  )
  // 수익성 검증 대상 인플루언서·캠페인에 대한 AI 판단 (시험용 — 규칙으로 흉내). 계약 방식·고정 피 정보를 한계로 함께 판단한다
  // 화면에 쓴 계산값을 한 덩어리(judgmentInput)로 모아 AI 판단에 넘긴다 — AI API 를 연결해도 이 입력을 그대로 보내면 된다
  const judgmentInput = buildJudgmentInput({
    profitability: profData,
    perf,
    subject: { influencerId: String(c.subjectRefs.influencer ?? ''), campaignId: c.subjectRefs.campaign ? String(c.subjectRefs.campaign) : undefined },
    allocation: shares,
    fees: {
      feeType: feeKnown ? feeInfo?.feeType ?? null : masterFee,
      fixedFeeKrw: c.caseType !== EXPANSION_CASE_TYPE ? (feeKnown ? feeInfo?.fixedFeeKrw ?? null : contractAmount || null) : (masterFee?.includes('고정') ? infContractRow?.amount ?? null : null),
      performanceFeeKrw: feeKnown ? feeInfo?.performanceFeeKrw ?? null : null,
      performanceRate: feeInfo?.performanceRate ?? null,
      hasPerfFee,
    },
  })
  const judgment = judge(judgmentInput)
  const decisionEvidence = (
    <div className="flex flex-col gap-3 border border-default p-2">
      <p className="t-small font-semibold">판단 근거</p>
      {revisionNote && <div className="flex flex-col gap-1"><p className="t-small font-semibold">수정 보고 (이 금액을 기준으로 판단해요)</p>{revisionNote}</div>}
      <div className="flex flex-col gap-1">
        <p className="t-small font-semibold">수익성 검증</p>
        <ProfitabilityCard data={profData} judgment={judgment} stepLabel={approverName} isApprover shares={shares} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="t-small font-semibold">첨부 파일</p>
        {allFileLinks}
      </div>
    </div>
  )
  // 계약 담당이 마지막 단계(통보·회신 기록 보관 / 집행 중단 처리 / 불연장 통지서 발송)에서 참고할 정보:
  // 이전에 올라온 첨부 파일(공헌이익 자료인 추계서는 제외)과, 통보에 필요한 결정 내용·기한·상대방·계약 조건·같은 인플루언서의 전속계약
  const lastDecided = [...view.approvals].reverse().find((a) => a.kind === 'main' && (a.status === 'approved' || a.status === 'rejected' || a.status === 'on_hold'))
  const decisionWord = lastDecided?.status === 'approved' ? '승인' : lastDecided?.status === 'rejected' ? '부결' : lastDecided?.status === 'on_hold' ? '재검토' : null
  const priorFiles = (
    <div className="flex flex-col">
      {subFiles.filter((f) => f.kind !== 'estimate').map((f) => (
        <a key={`s${f.id}`} className="border-b border-default py-1 t-small underline" href={`/api/submission-files/${f.id}`}>
          {subFileLabel(f)} — {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
        </a>
      ))}
      {caseFiles.filter((f) => f.kind !== 'notice').map((f) => (
        <a key={`c${f.id}`} className="border-b border-default py-1 t-small underline" href={`/api/case-files/${f.id}`}>
          {caseFileLabel(f.kind, f.revision)} — {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
        </a>
      ))}
      {subFiles.filter((f) => f.kind !== 'estimate').length === 0 && caseFiles.filter((f) => f.kind !== 'notice').length === 0 && (
        <p className="t-caption">{subRef ? '이전에 올라온 첨부 파일이 없어요.' : '원본 기안 파일에서 가져온 안건이라 이전 첨부 파일이 없어요.'}</p>
      )}
    </div>
  )
  const daysLeft = daysUntil(c.deadline, AS_OF)
  const closingInfo = (
    <NumberedList
      items={[
        {
          key: 'decision',
          title: '결정 내용',
          body: lastDecided ? (
            <>
              <p className="t-small"><strong>{decisionWord}</strong> — {lastDecided.decidedBy ?? roleLabel(lastDecided.requiredRole)}{lastDecided.decidedAt ? ` · ${fmtDateTime(lastDecided.decidedAt)}` : ''}</p>
              {lastDecided.comment && <p className="t-small">결정 사유: {lastDecided.comment}</p>}
            </>
          ) : <p className="t-caption">결정 기록이 없어요.</p>,
        },
        {
          key: 'dates',
          title: '일정·기한',
          body: lines([
            `${c.caseType === EXPANSION_CASE_TYPE ? '계약 확정기한' : '통보 기한(계약 체결 기한)'}: ${c.deadline ?? '없음'}${c.deadline ? ` (${ddayText(daysLeft)})` : ''} — ${c.caseType === EXPANSION_CASE_TYPE ? '넘기면 자동 확정되어 철회할 수 없어요' : '넘기면 동일 조건으로 1년 자동 갱신(체결로 간주)돼요'}`,
            ...(outDate ? [`지급 예정일: ${outDate}`] : []),
            ...(c.caseType !== EXPANSION_CASE_TYPE && (c.payload as { contract?: { currentExpiry?: string | null } }).contract?.currentExpiry ? [`현 계약 만료일: ${(c.payload as { contract?: { currentExpiry?: string | null } }).contract?.currentExpiry}`] : []),
          ]),
        },
        {
          key: 'party',
          title: '상대방·계약 조건',
          body: lines([
            hasInfluencer ? `상대방: ${influencerName} (${c.subjectRefs.influencer}) — 소속 에이전시 정보는 원본에 없어요` : '상대방: 연결된 인플루언서가 없어요',
            ...(c.caseType !== EXPANSION_CASE_TYPE ? [`계약 방식·금액: ${feeText(feeInfo, contractAmount, revisions.length > 0)}`] : currentAmount > 0 ? [`요청 금액: ${fmtWon(currentAmount)}`] : []),
            ...contractLines.filter((l) => /위약금|계약 형태|보수/.test(l)),
          ]),
        },
        ...(c.caseType === EXPANSION_CASE_TYPE || relatedContracts.length > 0
          ? [{
              key: 'contracts',
              title: '같은 인플루언서의 전속계약 (별개 결정이므로 통보 기한을 함께 확인)',
              body: relatedContracts.length === 0 ? <p className="t-caption">연결된 전속계약 안건이 없어요.</p> : (
                <>
                  {relatedContracts.map((r) => (
                    <p key={r.id} className="t-small">
                      {r.code || '—'} {r.title} — {r.feeText ?? ''} · 기한 {r.deadline ?? '없음'}{r.deadline ? ` (${ddayText(daysUntil(r.deadline, AS_OF))})` : ''} · <strong>{r.decisionLabel}</strong> ({r.state})
                    </p>
                  ))}
                </>
              ),
            }]
          : []),
        ...(revisions.length > 0 ? [{ key: 'revisions', title: '수정 보고 내역', body: revisionNote }] : []),
        { key: 'files', title: '이전에 올라온 첨부 파일', body: priorFiles },
      ]}
    />
  )
  const revisionItem: CheckItem[] = revisionNote ? [{ key: 'revision', title: '수정 보고 내용 (이 금액을 기준으로 판단해요)', body: revisionNote }] : []
  const financeItems: CheckItem[] = [
    ...revisionItem,
    { key: 'files', title: '첨부 파일', body: subFileLinks },
    ...(termsBody.props.children.length > 0 ? [{ key: 'terms', title: '계약 방식', body: termsBody }] : []),
    { key: 'profit', title: '수익성 검증', body: <ProfitabilityCard data={profData} judgment={judgment} stepLabel="재무팀" shares={shares} /> },
  ]
  const contractItems: CheckItem[] = [
    ...revisionItem,
    { key: 'terms', title: '계약 조건 · 기한', body: contractTerms },
    { key: 'files', title: '제출 때 붙은 서류', body: contractSideFiles },
  ]

  return (
    <>
      <div className="flex flex-col gap-3">
        {flow && flowState && (
          <Card>
            <Card.Header>
              <Card.Title>업무 흐름</Card.Title>
              <Card.Description>{flow.description}</Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-4">
              <FlowExplorer def={flow} state={flowState} laneLabels={laneLabels} myLanes={myLanes} uid={`case${c.id}`} />
            </Card.Content>
          </Card>
        )}

        {/* 같이 봐야 할 점 — 서로 다른 내용은 번호로 나누고 들여쓴다 */}
        <Card>
          <Card.Header><Card.Title>같이 봐야 할 점</Card.Title></Card.Header>
          <Card.Content>
            <NumberedList
              items={[
                {
                  key: 'approver',
                  title: '승인권자',
                  body:
                    decision?.status === 'decided' && c.authority ? (
                      <>
                        <p className="t-small"><strong>{authorityText(c.authority, decision.also)}</strong></p>
                        {/* 근거는 적용된 규칙의 이름만 한 줄로 */}
                        {(decision.matched.some((m) => m.authority === c.authority) ? decision.matched.filter((m) => m.authority === c.authority) : decision.matched).map((m) => (
                          <p key={m.ruleId} className="t-caption">{m.title}</p>
                        ))}
                      </>
                    ) : (
                      <>
                        <p className="t-small">
                          <strong className="text-danger">승인권자 확정 필요</strong> — {decision?.status === 'no_rule' ? '적용되는 규칙이 없어 사람이 직접 지정해야 해요.' : '모르는 사실이 있어 아직 정할 수 없어요.'}
                        </p>
                        {(decision?.unresolved ?? []).map((u) => (
                          <p key={u.ruleId} className="t-caption">{u.title} — 확인할 것: {u.missingFacts.map((f) => FACT_LABEL[f] ?? f).join(', ')} (확인되면 {roleLabel(u.wouldRequire)} 승인)</p>
                        ))}
                        {!decision && <p className="t-caption">아직 평가 전이에요.</p>}
                      </>
                    ),
                },
                ...(notes.length > 0
                  ? [{ key: 'notes', title: '일정·기한', body: <>{notes.map((n) => <p key={n} className="t-small">{n}</p>)}</> }]
                  : []),
                ...(
                  [
                    { key: 'rel-campaign', label: '연관 캠페인', rows: relatedCampaigns },
                    { key: 'rel-contract', label: '인플루언서 계약', rows: relatedContracts },
                  ] as const
                ).map((g) => ({
                  key: g.key,
                  title: <>{g.label} — {influencerName} <span className="t-caption">(계약 체결 기한 {winFrom} ~ {winTo}, {g.rows.length}건)</span></>,
                  body: (
                    <div>
                      {!hasInfluencer && <p className="border border-default px-3 py-2 t-caption" style={{ borderRadius: 2 }}>연결된 인플루언서가 없어요.</p>}
                      {hasInfluencer && g.rows.length === 0 && <p className="border border-default px-3 py-2 t-caption" style={{ borderRadius: 2 }}>없음</p>}
                      {hasInfluencer && g.rows.length > 0 && (
                        // 위쪽 기안·안건 목록과 같은 모양: 네모난 테두리, 세로줄로 나뉜 칸, 고정된 제목 줄, 길면 안쪽 스크롤
                        // 부결 표시(빨간 느낌표)는 표 밖 왼쪽 여백에 두어 글자를 가리지 않게 한다
                        <div className="max-h-60 overflow-auto">
                         <div className="flex items-start">
                          <div className="sticky left-0 z-20 shrink-0 bg-content" style={{ width: 22, paddingTop: ROW_H + 1 }} aria-hidden={false}>
                            {g.rows.map((r) => (
                              <div key={r.id} className="flex items-center justify-center text-danger" style={{ height: ROW_H }}>
                                {r.outcome === 'rejected' && <Warning size={16} weight="fill" aria-label="부결된 안건" />}
                              </div>
                            ))}
                          </div>
                          <div className="border border-default" style={{ borderRadius: 2, marginTop: 0 }}>
                          <table className="border-collapse t-small" style={{ tableLayout: 'fixed', width: 1180 }}>
                            <colgroup>
                              {[100, 250, 190, 180, 270, 190].map((w, i) => <col key={i} style={{ width: w }} />)}
                            </colgroup>
                            <thead className="sticky top-0 z-10 bg-surface">
                              <tr>
                                {['분류코드', '안건', '금액·계약 방식', '계약 체결 기한', '상태', '승인권자'].map((h) => (
                                  <th key={h} className="border-b border-r border-default px-3 text-left font-semibold whitespace-nowrap" style={{ height: ROW_H }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {g.rows.map((r) => {
                                const cells = [
                                  r.code || '—',
                                  r.title,
                                  r.feeText ?? (r.amount === null ? '—' : fmtWon(r.amount)),
                                  r.deadline ? `${r.deadline} (${ddayText(daysUntil(r.deadline, AS_OF))})` : '—',
                                  `${r.decisionLabel} (${r.state})`,
                                  r.authorityText ?? '확정 필요',
                                ]
                                return (
                                  <tr key={r.id} style={{ height: ROW_H }} className={`border-b border-default align-top hover:bg-surface ${r.outcome === 'rejected' ? 'text-danger' : ''}`}>
                                    {cells.map((txt, i) => (
                                      <td key={i} className={`border-r border-default p-0 ${i === 1 ? 'font-semibold' : ''}`}>
                                        <Link href={`/cases?id=${r.id}`} scroll={false} className="flex items-center gap-1 px-3" style={{ height: ROW_H - 1 }} title={txt}>
                                          <span className="min-w-0 truncate whitespace-nowrap">{txt}</span>
                                        </Link>
                                      </td>
                                    ))}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                          </div>
                         </div>
                        </div>
                      )}
                    </div>
                  ),
                })),
              ]}
            />
          </Card.Content>
        </Card>

        {/* 다음 행동 — 지금 처리할 수 있는 부서의 사람에게만 버튼이 보인다 */}
        <Card>
          <Card.Header>
            <Card.Title>다음 행동</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            {waiting.length === 0 && !hasMyAction && (
              <p className="t-small">{c.status === 'closed' || c.status === 'approved' ? '이 안건의 처리가 끝났어요.' : '지금 처리 중인 단계가 없어요.'}</p>
            )}
            {financeTask && (
              <FinanceReferItems
                caseId={c.id}
                items={financeItems}
                current={typeof currentLinked300 === 'boolean' ? currentLinked300 : null}
                beyondPeriod={beyondPeriod}
                warning={warning}
                missing={financeMissing}
                teams={REWORK_TARGETS['collect-performance'].map((t) => ({ role: t.role, label: t.label }))}
                nextLabel="계약 담당"
                start={1}
              />
            )}
            <NumberedList
              start={financeTask ? 3 : 1}
              items={[
                ...othersWorking.map((w, i) => ({
                  key: `wait${i}`,
                  title: <>지금 <strong>{w.lane}</strong>에서 <strong>{w.step}</strong>을(를) 처리하고 있어요.</>,
                })),
                ...(myDecision && pending
                  ? [{ key: 'decide', title: pending.kind === 'nonrenewal' ? '계약 미갱신 통지서 승인' : '승인 결정', body: <div className="flex flex-col gap-3">{decisionEvidence}<DecisionPanel approvalId={pending.id} requiredLabel={roleLabel(pending.requiredRole)} allowed myRoles={myRoles} warning={pending.kind === 'nonrenewal' ? null : warning} reviewWarning={reviewWarning} kind={pending.kind} isContract={c.caseType !== EXPANSION_CASE_TYPE} /></div> }]
                  : []),
                ...myInfo.map((t) => ({
                  key: `info${t.id}`,
                  title: <span className="flex items-center gap-2"><Pill color="warning">확인 요청</Pill>{t.title}</span>,
                  body: (
                    <div className="flex flex-col gap-2 border border-default p-2">
                      <p className="t-small">{String(t.detail.question ?? '')}</p>
                      {t.detail.whatIf != null && (
                        <p className="t-caption">
                          참고: 조정이 되면 승인권자가 {String((t.detail.whatIf as { authorityLabel?: string }).authorityLabel ?? '미정')}(으)로 내려갈 수 있어요 (다른 확인이 끝난 경우).
                        </p>
                      )}
                      <InfoReplyForm taskId={t.id} fields={(t.detail.answerFields as { name: string; type: 'date' | 'boolean' | 'number' | 'text'; label: string }[]) ?? []} allowed assignee={t.assigneeRole ?? '담당 부서'} />
                    </div>
                  ),
                })),
                ...myTasks.filter((t) => String(t.detail.key ?? '') !== 'collect-performance').map((t) => {
                  if (String(t.detail.key ?? '') === 'confirm-terms') {
                    return { key: `task${t.id}`, title: '계약 조건·기한 확인 — 항목마다 확인하고 체크하세요', body: <ContractReferPanel caseId={c.id} items={contractItems} files={caseFiles.filter((f) => f.kind === 'contract')} warning={warning} missing={contractMissing} teams={REWORK_TARGETS['confirm-terms']} nextLabel={approverName} /> }
                  }
                  if (String(t.detail.key ?? '') === 'record-reply') {
                    return { key: `task${t.id}`, title: t.title, body: <RecordReplyPanel caseId={c.id} taskId={t.id} files={caseFiles.filter((f) => f.kind === 'notice')} info={closingInfo} /> }
                  }
                  // 부결 뒤 상대방 통보 단계에도 통보 수령 증빙을 붙일 수 있다 (캠페인: 집행 중단 처리 / 계약: 불연장 통지서 발송)
                  if (String(t.detail.key ?? '') === 'stop-campaign' || String(t.detail.key ?? '') === 'send-nonrenewal') {
                    const stop = String(t.detail.key) === 'stop-campaign'
                    return {
                      key: `task${t.id}`,
                      title: t.title,
                      body: (
                        <RecordReplyPanel
                          caseId={c.id}
                          taskId={t.id}
                          files={caseFiles.filter((f) => f.kind === 'notice')}
                          info={closingInfo}
                          description={stop ? '상대방에 진행하지 않는다고 회신하고, 상대방이 받았다는 회신(통보 수령 증빙)을 붙인 뒤 전속계약 통보 기한도 확인하세요.' : '불연장 통지서를 발송하고, 상대방이 받았다는 회신(통보 수령 증빙)을 붙이세요.'}
                          doneLabel={stop ? '집행 중단 처리 완료' : '통지서 발송 완료'}
                        />
                      ),
                    }
                  }
                  if (String(t.detail.key ?? '') === 'request-nonrenewal') {
                    return { key: `task${t.id}`, title: t.title, body: <NonrenewalRequestPanel caseId={c.id} approverLabel={approverName} warning={t.detail.warning ? String(t.detail.warning) : null} /> }
                  }
                  return {
                    key: `task${t.id}`,
                    title: t.title,
                    body: (
                      <div className="flex flex-wrap items-center justify-between gap-2 border border-default p-2">
                        <span className="t-caption">{TASK_TYPE[t.taskType] ?? t.taskType}{t.dueDate ? ` · 기한 ${t.dueDate}` : ''}</span>
                        <TaskDoneButton taskId={t.id} allowed />
                      </div>
                    ),
                  }
                }),
                ...(canResubmit
                  ? [{
                      key: 'resubmit',
                      title: '재검토 요청된 안건이에요.',
                      body: (
                        <>
                          <p className="t-small">승인권자가 재검토로 돌려보냈어요. 보완한 뒤 다시 보고하면 재무팀부터 처음부터 다시 절차를 진행해요.</p>
                          <div><ResubmitButton caseId={c.id} allowed /></div>
                        </>
                      ),
                    }]
                  : []),
              ]}
            />
          </Card.Content>
        </Card>

        {/* 수정 보고: 승인 또는 부결 뒤 금액만 바뀌었을 때 — 원 자료는 그대로 두고 바뀐 금액과 추가 첨부를 더한다. 이전 수정 보고 내역도 여기서 본다. */}
        {(canRevise || revisions.length > 0) && (
          <Card>
            <Card.Header>
              <Card.Title>수정 보고</Card.Title>
              <Card.Description>승인 또는 부결 뒤 사정이 바뀌어 금액만 달라질 때 다시 보고해요. 원래 금액과 첨부는 그대로 두고, 바뀐 금액과 추가 첨부를 더해요. 이후 판단은 바뀐 금액을 기준으로 해요.</Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-4">
              {revisions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="t-small font-semibold">수정 보고 내역</p>
                  {revisionNote}
                  {caseFiles.filter((f) => f.kind === 'revision').map((f) => (
                    <a key={f.id} className="border-b border-default py-1 t-small underline" href={`/api/case-files/${f.id}`}>
                      {f.revision}차 추가 첨부 — {f.filename} <span className="t-caption">({Math.max(1, Math.round(f.size / 1024))}KB)</span>
                    </a>
                  ))}
                </div>
              )}
              {canRevise && originalApprover && (
                <RevisionPanel
                  caseId={c.id}
                  amountLabel={amountLabel}
                  originalAmount={originalAmount}
                  currentAmount={currentAmount}
                  approverLabel={roleLabel(originalApprover)}
                  originalFiles={originalFileLinks}
                />
              )}
            </Card.Content>
          </Card>
        )}

        {/* 이력: 길어질 수 있어 안쪽으로 스크롤 */}
        <Card>
          <Card.Header>
            <Card.Title>이력</Card.Title>
            <Card.Description>누가 언제 무엇을 했는지 추가만 되고 지워지지 않아요.</Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto border border-default p-2">
              {[...view.events].reverse().map((e) => (
                <div key={e.id} className="flex flex-col gap-0.5 border-b border-default pb-2">
                  <span className="t-small">
                    <strong>{EVENT_LABEL[e.eventType] ?? e.eventType}</strong> <span className="t-caption">· {e.actorKind}{e.actorName ? ` ${e.actorName}` : ''} · {fmtDateTime(e.createdAt)}</span>
                  </span>
                  <span className="t-caption">{eventSummary(e)}</span>
                </div>
              ))}
            </div>
          </Card.Content>
        </Card>
      </div>
    </>
  )
}
