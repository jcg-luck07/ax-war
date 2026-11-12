'use server'

// 화면의 버튼·폼이 부르는 서버 동작. 로그인한 사용자의 역할로 할 수 있는 일만 처리하고, 결과를 한 줄 메시지로 돌려준다.
// 배포본은 인터넷에 공개되어 있으므로 로그인하지 않은 사람은 아무것도 바꿀 수 없다 (lib/app/auth.ts).
import { revalidatePath } from 'next/cache'
import {
  EngineError, completeTask, decide, getCaseView, provideInfo, resubmitCase, updateFacts, type Outcome,
} from '@/lib/engine/engine'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import { DEV_ACCOUNTS, DEV_COOKIE, canAcceptCategory, canSubmitCategory, canHandle, canWork, currentUser, decidingRole, roleLabels, type AppUser } from '@/lib/app/auth'
import { acceptSubmission, categoryById, returnSubmission } from '@/lib/modules/intake/submissions'
import { importExpansionPlans } from '@/lib/modules/w02/intake'
import { contractRefer, financeRefer, requestNonrenewalApproval, requestRework } from '@/lib/modules/w02/handoff'
import { beyondGroupFundPeriod } from '@/lib/modules/w02/group-fund'
import { outflowDate } from '@/lib/modules/w02/handlers'
import { answerAllOpenInfo } from '@/lib/modules/w02/draft'
import { EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'
import { ROLES } from '@/lib/rules/authority.rules'
import type { Sql } from 'postgres'

export interface ActionResult {
  ok: boolean
  message: string
}

type Scalar = string | number | boolean | null

async function guarded(fn: (user: AppUser, sql: Sql) => Promise<string>, opts: { admin?: boolean } = {}): Promise<ActionResult> {
  try {
    const { sql } = await getEngine()
    const user = await currentUser(sql)
    if (!user.authenticated) return { ok: false, message: '로그인이 필요해요. axhub 로그인 후 다시 시도해 주세요.' }
    if (opts.admin && !user.isAdmin) return { ok: false, message: '관리자만 할 수 있어요.' }
    const message = await fn(user, sql)
    revalidatePath('/', 'layout')
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: e instanceof EngineError ? e.message : `처리하지 못했어요: ${e instanceof Error ? e.message : String(e)}` }
  }
}

const needRole = (user: AppUser) => {
  if (!canWork(user)) throw new EngineError('역할이 없어요. 관리자에게 역할 부여를 요청하세요.')
}

// ───────── 결정 · 회신 · 작업 ─────────

export async function decideAction(input: { approvalId: number; outcome: Outcome; comment: string }) {
  return guarded(async (user, sql) => {
    const { cfg } = await getEngine()
    const [ap] = await sql`SELECT required_role FROM approvals WHERE id = ${input.approvalId}`
    if (!ap) throw new EngineError('승인 요청을 찾을 수 없어요')
    const role = decidingRole(user, ap.required_role as string)
    if (!role) {
      throw new EngineError(
        `이 건은 ${roleLabel(ap.required_role as string)} 승인이 필요해요. 내 역할(${roleLabels(user.roles).join(', ') || '없음'})로는 결정할 수 없어요.`,
      )
    }
    const r = await decide(sql, cfg, input.approvalId, { outcome: input.outcome, byRole: role, byName: user.name, comment: input.comment || undefined })
    const label = input.outcome === 'approved' ? '승인' : input.outcome === 'rejected' ? '부결' : '재검토'
    return `${label}했어요. 후속 작업 ${r.taskIds.length}개가 생겼어요.`
  })
}

export async function provideInfoAction(input: { taskId: number; answers: Record<string, Scalar> }) {
  return guarded(async (user, sql) => {
    const { cfg } = await getEngine()
    const [t] = await sql`SELECT assignee_role FROM tasks WHERE id = ${input.taskId}`
    if (!t) throw new EngineError('확인 요청을 찾을 수 없어요')
    if (!canHandle(user, t.assignee_role as string | null)) throw new EngineError(`이 확인 요청은 ${t.assignee_role ?? '담당 부서'} 담당이에요.`)
    const r = await provideInfo(sql, cfg, input.taskId, { answers: input.answers, origin: '사용자입력', by: `${user.name} (${t.assignee_role ?? '담당'})` })
    const tail = r.decision.status === 'decided' ? `승인권자: ${r.decision.authorityLabel}` : r.decision.status === 'need_info' ? '아직 확인이 더 필요해요' : '적용 규칙이 없어요'
    return `회신을 반영해 다시 평가했어요. ${tail}`
  })
}

export async function updateFactAction(input: { caseId: number; fact: string; value: Scalar; reason: string }) {
  return guarded(async (user, sql) => {
    needRole(user)
    const { cfg } = await getEngine()
    const r = await updateFacts(sql, cfg, input.caseId, { patch: { [input.fact]: input.value }, reason: input.reason, origin: '사용자입력', by: user.name })
    return r.finalized
      ? '이미 확정된 안건이라 판정만 기록했어요.'
      : r.authorityChanged
        ? `조건 변경을 반영했어요. 승인권자가 ${r.decision.authorityLabel ?? '미정(확인 필요)'}(으)로 바뀌었어요.`
        : `조건 변경을 반영했어요. 결론(승인권자 ${r.decision.authorityLabel ?? '미정'})은 그대로예요.`
  })
}

export async function completeTaskAction(input: { taskId: number }) {
  return guarded(async (user, sql) => {
    const [t] = await sql`SELECT assignee_role FROM tasks WHERE id = ${input.taskId}`
    if (!t) throw new EngineError('작업을 찾을 수 없어요')
    if (!canHandle(user, t.assignee_role as string | null)) throw new EngineError(`이 작업은 ${t.assignee_role ?? '담당 부서'} 담당이에요.`)
    const r = await completeTask(sql, input.taskId, user.name)
    return r.caseClosed ? '작업을 완료했어요. 모든 작업이 끝나 안건이 닫혔어요.' : '작업을 완료했어요.'
  })
}

/** 재무팀 회부: 300억 배분 검토 대상 판정 + 성과·비용표 취합 완료 → 계약 담당에게 */
export async function financeReferAction(input: { caseId: number; linked: boolean }) {
  return guarded(async (user, sql) => {
    if (!canHandle(user, '재무')) throw new EngineError('재무팀만 회부할 수 있어요.')
    const { cfg } = await getEngine()
    // 집행 예정일이 300억 집행 기준기간(향후 6개월)을 넘으면 검토 대상이 될 수 없다
    if (input.linked && beyondGroupFundPeriod(outflowDate((await getCaseView(sql, input.caseId)).case), AS_OF)) {
      throw new EngineError('집행 예정일이 300억 집행 기준기간(향후 6개월)을 넘어서 검토 대상으로 처리할 수 없어요.')
    }
    const r = await financeRefer(sql, cfg, input.caseId, { linked: input.linked, by: user.name })
    return `계약 담당에게 회부했어요. 300억 배분 ${input.linked ? '검토 대상으로 처리' : '검토 대상 아님'} · 승인권자: ${r.authorityLabel ?? '확인 필요'}`
  })
}

/** 계약 담당 회부: 계약서 첨부 + 계약 조건·기한 확인 완료 → 승인권자에게 */
export async function contractReferAction(input: { caseId: number }) {
  return guarded(async (user, sql) => {
    if (!canHandle(user, '계약 담당')) throw new EngineError('계약 담당만 회부할 수 있어요.')
    await contractRefer(sql, input.caseId, user.name)
    return '승인권자에게 회부했어요.'
  })
}

/** 보완 요청: 이전에 거쳐 온 팀에게 되돌린다 (재무팀은 성과·비용표 취합 단계에서, 계약 담당은 계약 확인 단계에서) */
export async function reworkRequestAction(input: { caseId: number; fromKey: 'collect-performance' | 'confirm-terms'; toRole: string; note: string }) {
  return guarded(async (user, sql) => {
    if (!canHandle(user, input.fromKey === 'collect-performance' ? '재무' : '계약 담당')) throw new EngineError('이 단계를 맡은 부서만 보완을 요청할 수 있어요.')
    await requestRework(sql, input.caseId, { ...input, by: user.name })
    return '보완을 요청했어요. 그 팀이 끝내면 다시 이 단계로 돌아와요.'
  })
}

/** 부결된 계약 안건: 계약 담당이 후속조치로 계약 미갱신 통지서 결재를 보고 (승인권자의 재승인 필요) */
export async function nonrenewalRequestAction(input: { caseId: number }) {
  return guarded(async (user, sql) => {
    if (!canHandle(user, '계약 담당')) throw new EngineError('계약 담당만 보고할 수 있어요.')
    const { cfg } = await getEngine()
    const r = await requestNonrenewalApproval(sql, cfg, input.caseId, user.name)
    return `계약 미갱신 통지서를 ${r.requiredLabel}에게 결재 보고했어요.`
  })
}

export async function resubmitAction(input: { caseId: number; reason: string }) {
  return guarded(async (user, sql) => {
    needRole(user)
    const { cfg } = await getEngine()
    await resubmitCase(sql, cfg, input.caseId, { by: user.name, reason: input.reason || '재보고' })
    return '다시 올렸어요. 새 승인 요청이 만들어졌어요.'
  })
}

/** 같은 질문(예: 300억 사업 연결 여부)을 하는 열린 확인 요청 전부에 한 번에 회신한다. 내가 처리할 수 있는 것만 반영된다. */
export async function bulkReplyAction(input: { fact: string; answers: Record<string, Scalar> }) {
  return guarded(async (user, sql) => {
    const { cfg } = await getEngine()
    const res = await answerAllOpenInfo(sql, cfg, input.fact, input.answers, {
      origin: '사용자입력', by: user.name, caseType: EXPANSION_CASE_TYPE, canHandle: (a) => canHandle(user, a),
    })
    if (res.length === 0) throw new EngineError('내가 회신할 수 있는 열린 확인 요청이 없어요.')
    return `같은 질문 ${res.length}건에 회신을 반영하고 다시 평가했어요.`
  })
}

// ───────── 안건 접수 ─────────

export async function importPlansAction() {
  return guarded(async (user, sql) => {
    if (!canAcceptCategory(user, 'marketing_team')) throw new EngineError('마케팅 팀장 이상만 일괄 접수할 수 있어요.')
    const { cfg } = await getEngine()
    const r = await importExpansionPlans(sql, cfg, user.name)
    return r.imported === 0 ? '새로 접수할 기안이 없어요.' : `확대 기안 ${r.imported}건을 접수했어요 (이미 접수된 ${r.skipped}건은 건너뜀).`
  })
}

// 안건 제출(보고)은 파일 첨부가 있어 app/api/submissions 로 받는다. 접수·반려는 팀장(접수 권한자)이 한다.

export async function acceptSubmissionAction(input: { id: number; checked: string[]; draftId?: number | null }) {
  return guarded(async (user, sql) => {
    const [row] = await sql`SELECT category FROM submissions WHERE id = ${input.id}`
    const cat = row ? categoryById(row.category as string) : undefined
    if (!cat) throw new EngineError('접수 대기 안건을 찾을 수 없어요')
    if (!canAcceptCategory(user, cat.acceptRole)) throw new EngineError(`${roleLabel(cat.acceptRole)} 이상만 접수할 수 있어요.`)
    const { cfg } = await getEngine()
    const r = await acceptSubmission(sql, cfg, input.id, user.name, input.checked, input.draftId ?? null)
    return `기안으로 접수하고 재무팀에 회부했어요 (안건 #${r.caseId}). ${r.needInfo ? '확인이 필요한 사실이 있어요.' : `승인권자: ${r.authorityLabel}`}`
  })
}

export async function returnSubmissionAction(input: { id: number; note: string }) {
  return guarded(async (user, sql) => {
    const [row] = await sql`SELECT category FROM submissions WHERE id = ${input.id}`
    const cat = row ? categoryById(row.category as string) : undefined
    if (!cat) throw new EngineError('접수 대기 안건을 찾을 수 없어요')
    if (!canAcceptCategory(user, cat.acceptRole)) throw new EngineError(`${roleLabel(cat.acceptRole)} 이상만 반려할 수 있어요.`)
    await returnSubmission(sql, input.id, user.name, input.note)
    return '반려했어요. 올린 사람이 다시 올릴 수 있어요.'
  })
}

// ───────── 사용자·권한 (관리자) ─────────

export async function setUserRolesAction(input: { email: string; name: string; roles: string[] }) {
  return guarded(async (_user, sql) => {
    const email = input.email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new EngineError('이메일 형식이 아니에요')
    if (!input.name.trim()) throw new EngineError('이름을 입력해 주세요')
    const roles = input.roles.filter((r) => ROLES.some((x) => x.id === r))
    await sql`
      INSERT INTO user_roles (email, display_name, roles) VALUES (${email}, ${input.name.trim()}, ${roles})
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, roles = EXCLUDED.roles, updated_at = now()
    `
    return `${input.name.trim()}(${email}) 의 역할을 저장했어요: ${roleLabels(roles).join(', ') || '없음'}`
  }, { admin: true })
}

export async function removeUserAction(input: { email: string }) {
  return guarded(async (_user, sql) => {
    await sql`DELETE FROM user_roles WHERE email = ${input.email}`
    return '사용자를 목록에서 뺐어요.'
  }, { admin: true })
}

// ───────── 로컬 시험용 계정 전환 (배포본에서는 동작하지 않는다) ─────────

export async function switchDevAccountAction(id: string) {
  if (process.env.NODE_ENV === 'production') return { ok: false, message: '배포본에서는 계정을 바꿀 수 없어요.' }
  if (!DEV_ACCOUNTS.some((a) => a.id === id)) return { ok: false, message: '알 수 없는 계정이에요.' }
  const { cookies } = await import('next/headers')
  ;(await cookies()).set(DEV_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax' })
  revalidatePath('/', 'layout')
  return { ok: true, message: '계정을 바꿨어요.' }
}
