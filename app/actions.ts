'use server'

// 화면의 버튼·폼이 부르는 서버 동작. 로그인한 사용자의 역할로 할 수 있는 일만 처리하고, 결과를 한 줄 메시지로 돌려준다.
// 배포본은 인터넷에 공개되어 있으므로 로그인하지 않은 사람은 아무것도 바꿀 수 없다 (lib/app/auth.ts).
import { revalidatePath } from 'next/cache'
import {
  EngineError, completeTask, decide, provideInfo, resubmitCase, updateFacts, type Outcome,
} from '@/lib/engine/engine'
import { getEngine, roleLabel } from '@/lib/app/engine'
import { canHandle, canWork, currentUser, decidingRole, roleLabels, type AppUser } from '@/lib/app/auth'
import { importExpansionPlans, receiveContractNotice, requestPurchaseOrder } from '@/lib/modules/w02/intake'
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
    const label = input.outcome === 'approved' ? '승인' : input.outcome === 'rejected' ? '부결' : '보류'
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

export async function resubmitAction(input: { caseId: number; reason: string }) {
  return guarded(async (user, sql) => {
    needRole(user)
    const { cfg } = await getEngine()
    await resubmitCase(sql, cfg, input.caseId, { by: user.name, reason: input.reason || '재상신' })
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
    needRole(user)
    const { cfg } = await getEngine()
    const r = await importExpansionPlans(sql, cfg, user.name)
    return r.imported === 0 ? '새로 접수할 기안이 없어요.' : `확대 기안 ${r.imported}건을 접수했어요 (이미 접수된 ${r.skipped}건은 건너뜀).`
  })
}

export async function receiveContractAction(input: {
  influencerId: string; annualFixedFeeEok: number; notifyDeadline: string; currentExpiry: string; fixedFeePaymentDate: string; note: string
}) {
  return guarded(async (user, sql) => {
    needRole(user)
    const { cfg } = await getEngine()
    const r = await receiveContractNotice(sql, cfg, {
      influencerId: input.influencerId.trim().toUpperCase(),
      annualFixedFeeKrw: Math.round(input.annualFixedFeeEok * 100_000_000),
      notifyDeadline: input.notifyDeadline.trim(),
      currentExpiry: input.currentExpiry.trim(),
      fixedFeePaymentDate: input.fixedFeePaymentDate.trim() || null,
      note: input.note,
    }, user.name)
    return `전속계약 갱신 안건 #${r.caseId} 를 접수했어요. ${r.decision.status === 'decided' ? `승인권자: ${r.decision.authorityLabel}` : '확인이 필요한 사실이 있어요'}`
  })
}

export async function requestPurchaseAction(input: { title: string; skuId: string; amountMan: number; paymentDueDate: string }) {
  return guarded(async (user, sql) => {
    needRole(user)
    const { cfg } = await getEngine()
    const r = await requestPurchaseOrder(sql, cfg, {
      title: input.title, skuId: input.skuId.trim(), amountKrw: Math.round(input.amountMan * 10_000), paymentDueDate: input.paymentDueDate.trim() || null,
    }, user.name)
    return `발주 승인 요청 #${r.caseId} 를 접수했어요. ${r.decision.status === 'decided' ? `승인권자: ${r.decision.authorityLabel}` : '지급일 확인이 필요해요'}`
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
