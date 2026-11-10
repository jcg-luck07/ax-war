'use server'

// 화면의 버튼·폼이 부르는 서버 동작. 엔진 함수를 호출하고 결과를 한 줄 메시지로 돌려준다.
// 배포된 앱은 인터넷에 공개되어 있으므로, 배포본(NODE_ENV=production)에서는 로그인한 사람만 상태를 바꿀 수 있다.
import { revalidatePath } from 'next/cache'
import { EngineError, completeTask, decide, provideInfo, resetEngineData, resubmitCase, updateFacts, openCase, type Outcome } from '@/lib/engine/engine'
import { getEngine, roleLabel } from '@/lib/app/engine'
import { isAxhubConfigured, me } from '@/lib/axhub-server'
import { seedW02 } from '@/lib/modules/w02/seed'
import { answerAllOpenInfo } from '@/lib/modules/w02/draft'
import { PO_CASE_TYPE } from '@/lib/modules/w01/handlers'
import { EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'

export interface ActionResult {
  ok: boolean
  message: string
}

type Scalar = string | number | boolean | null

async function guarded(fn: () => Promise<string>): Promise<ActionResult> {
  try {
    // 로컬 개발(next dev)에서는 로그인 없이 쓰고, 배포본(production)에서는 로그인한 사람만 상태를 바꾼다.
    if (process.env.NODE_ENV === 'production' && isAxhubConfigured()) {
      const v = await me()
      if (!v.authenticated) return { ok: false, message: '상태를 바꾸려면 axhub 로그인이 필요해요.' }
    }
    const message = await fn()
    revalidatePath('/', 'layout')
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: e instanceof EngineError ? e.message : `처리하지 못했어요: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function decideAction(input: { approvalId: number; outcome: Outcome; byRole: string; byName: string; comment: string }) {
  return guarded(async () => {
    const { sql, cfg } = await getEngine()
    const r = await decide(sql, cfg, input.approvalId, {
      outcome: input.outcome, byRole: input.byRole, byName: input.byName || roleLabel(input.byRole), comment: input.comment || undefined,
    })
    const label = input.outcome === 'approved' ? '승인' : input.outcome === 'rejected' ? '부결' : '보류'
    return `${label}했어요. 후속 작업 ${r.taskIds.length}개가 생겼어요.`
  })
}

export async function provideInfoAction(input: { taskId: number; answers: Record<string, Scalar>; by: string }) {
  return guarded(async () => {
    const { sql, cfg } = await getEngine()
    const r = await provideInfo(sql, cfg, input.taskId, { answers: input.answers, origin: '가상입력', by: input.by || '담당자(모의)' })
    const tail =
      r.decision.status === 'decided'
        ? `승인권자: ${r.decision.authorityLabel}`
        : r.decision.status === 'need_info'
          ? '아직 확인이 더 필요해요'
          : '적용 규칙이 없어요'
    return `회신을 반영해 다시 평가했어요. ${tail}`
  })
}

export async function updateFactAction(input: { caseId: number; fact: string; value: Scalar; reason: string; by: string }) {
  return guarded(async () => {
    const { sql, cfg } = await getEngine()
    const r = await updateFacts(sql, cfg, input.caseId, { patch: { [input.fact]: input.value }, reason: input.reason, origin: '가상입력', by: input.by || '담당자(모의)' })
    return r.finalized
      ? '이미 확정된 안건이라 판정만 기록했어요.'
      : r.authorityChanged
        ? `조건 변경을 반영했어요. 승인권자가 ${r.decision.authorityLabel ?? '미정(확인 필요)'}(으)로 바뀌었어요.`
        : `조건 변경을 반영했어요. 결론(승인권자 ${r.decision.authorityLabel ?? '미정'})은 그대로예요.`
  })
}

export async function completeTaskAction(input: { taskId: number; by: string }) {
  return guarded(async () => {
    const { sql } = await getEngine()
    const r = await completeTask(sql, input.taskId, input.by || '담당자')
    return r.caseClosed ? '작업을 완료했어요. 모든 작업이 끝나 안건이 닫혔어요.' : '작업을 완료했어요.'
  })
}

export async function resubmitAction(input: { caseId: number; reason: string }) {
  return guarded(async () => {
    const { sql, cfg } = await getEngine()
    await resubmitCase(sql, cfg, input.caseId, { by: '마케팅', reason: input.reason || '재상신' })
    return '다시 올렸어요. 새 승인 요청이 만들어졌어요.'
  })
}

// ───────── 시연 도구 ─────────

export async function resetAction() {
  return guarded(async () => {
    const { sql } = await getEngine()
    await resetEngineData(sql)
    return '안건·이력·승인·작업을 모두 지웠어요. 원본 데이터 복사본은 그대로예요.'
  })
}

export async function seedAction() {
  return guarded(async () => {
    const { sql, cfg } = await getEngine()
    const existing = await sql`SELECT count(*)::int AS n FROM decision_cases`
    if (existing[0].n > 0) return '이미 안건이 있어요. 처음부터 다시 하려면 먼저 초기화하세요.'
    const r = await seedW02(sql, cfg)
    return `안건 ${1 + r.plans.length}개를 만들었어요 (전속계약 1 + 확대 기안 ${r.plans.length}).`
  })
}

export async function bulkAnswerAction(input: { fact: string; value: Scalar }) {
  return guarded(async () => {
    const { sql, cfg } = await getEngine()
    const res = await answerAllOpenInfo(sql, cfg, input.fact, { [input.fact]: input.value }, { origin: '가상입력', by: '재무팀(모의)', caseType: EXPANSION_CASE_TYPE })
    return res.length ? `열려 있던 확인 요청 ${res.length}건에 같은 회신을 반영했어요.` : '열려 있는 해당 확인 요청이 없어요.'
  })
}

/** 두 번째 업무(재고 발주 승인) 예시 안건 2건: 지급일이 하회 구간 안/밖인 경우. 가상 입력이다. */
export async function samplePurchaseOrdersAction() {
  return guarded(async () => {
    const { sql, cfg } = await getEngine()
    const mk = (title: string, date: string) =>
      openCase(sql, cfg, {
        caseType: PO_CASE_TYPE, title, deadline: null, dataOrigin: '가상입력', actorName: '시연 도구',
        payload: { facts: { creates_cash_outflow: true, payment_due_date: date, linked_to_group_300: false } },
      })
    const a = await mk('[예시·가상] 더마 세럼 추가 발주 — 대금 지급 2026-07-28', '2026-07-28')
    const b = await mk('[예시·가상] 더마 세럼 추가 발주 — 대금 지급 2026-09-15', '2026-09-15')
    return `예시 발주 2건을 만들었어요: ${a.decision.authorityLabel} / ${b.decision.authorityLabel} 승인으로 갈립니다.`
  })
}
