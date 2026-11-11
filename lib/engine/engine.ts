// 범용 의사결정 엔진 핵심 (서버 전용). 업무(W02 등)를 모른다 — 업무 모듈이 꽂아 주는 handler 만 호출한다.
//
//   안건 접수 → 평가(규칙집) → 승인 요청 / 확인 요청 → 사람의 결정 → 후속 작업 → 이력 → 재평가
//
// 약속
//  - 상태 변화는 모두 트랜잭션 안에서 하고, 매번 case_events 에 추가만 한다(지우지 않음).
//  - 권한을 넘는 결정은 거부한다. 모르는 사실이 있으면 확정하지 않고 확인 요청 작업을 만든다.
//  - 이 파일은 다른 프로젝트 파일을 값으로 import 하지 않는다(타입만). 규칙집 판정 함수 등은 config 로 받는다.
import type { Sql } from 'postgres'
import type { AuthorityDecision, FactValue, Facts } from '../rules/types'
import type { ActorKind, CaseStatus, DataOrigin, DecisionCase } from './types'

// ───────────────────────── 설정 · 업무 모듈 연결점 ─────────────────────────

export interface TaskSpec {
  /** 같은 안건 안에서 중복 생성을 막는 열쇠 */
  key: string
  taskType: string
  title: string
  assigneeRole?: string
  dueDate?: string | null
  detail?: Record<string, unknown>
  dataOrigin?: DataOrigin
}

export interface HandlerCtx {
  /** 가상기업 기준일(YYYY-MM-DD). 마감일 계산에 쓴다 */
  asOf: string
  [k: string]: unknown
}

export type Outcome = 'approved' | 'rejected' | 'on_hold'

/** 확인 요청에 대한 회신 칸. 화면이 이 정의대로 입력 칸을 그린다. */
export interface AnswerField {
  name: string
  type: 'date' | 'boolean' | 'number' | 'text'
  label: string
}

export interface CaseHandler {
  caseType: string
  /** 저장된 사실 외에, 그때그때 계산해 얻는 사실(예: 현금 재전망으로 구한 '하회 구간 안인가') */
  deriveFacts?(c: DecisionCase, ctx: HandlerCtx): Promise<Facts> | Facts
  /** 평가 직후 자동으로 생겨야 하는 작업(예: 재무에 집행 시기 조정 요청) */
  onEvaluated?(c: DecisionCase, d: AuthorityDecision, ctx: HandlerCtx): Promise<TaskSpec[]> | TaskSpec[]
  /** 사람이 결정한 직후 생겨야 하는 후속 작업 */
  onDecision?(c: DecisionCase, outcome: Outcome, ctx: HandlerCtx): Promise<TaskSpec[]> | TaskSpec[]
  /** 모르는 사실(fact)을 누구에게 어떻게 물을지 */
  describeFact?(fact: string):
    | { title: string; assigneeRole: string; question: string; answerFields?: AnswerField[] }
    | undefined
}

export interface EngineConfig {
  decide(caseType: string, facts: Facts): AuthorityDecision
  roleRank(roleId: string): number
  roleLabel(roleId: string): string
  handlers: Record<string, CaseHandler>
  ctx: HandlerCtx
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineError'
  }
}

// ───────────────────────── 읽기 모델 ─────────────────────────

export interface ApprovalRow {
  id: number
  caseId: number
  requiredRole: string
  status: string
  decidedBy: string | null
  decidedAt: string | null
  comment: string | null
  createdAt: string
}
export interface TaskRow {
  id: number
  caseId: number
  taskType: string
  title: string
  assigneeRole: string | null
  status: string
  dueDate: string | null
  detail: Record<string, unknown>
  response: Record<string, unknown> | null
  dataOrigin: string
  createdAt: string
  completedAt: string | null
}
export interface EventRow {
  id: number
  caseId: number
  eventType: string
  actorKind: string
  actorName: string | null
  detail: Record<string, unknown>
  createdAt: string
}
export interface CaseView {
  case: DecisionCase
  approvals: ApprovalRow[]
  tasks: TaskRow[]
  events: EventRow[]
}

const J = (sql: Sql, v: unknown) => sql.json(v as never)

/* eslint-disable @typescript-eslint/no-explicit-any */
const toCase = (r: any): DecisionCase => ({
  id: Number(r.id),
  caseType: r.case_type,
  title: r.title,
  status: r.status,
  deadline: r.deadline ? new Date(r.deadline).toISOString().slice(0, 10) : null,
  subjectRefs: r.subject_refs ?? {},
  payload: r.payload ?? {},
  authority: r.authority,
  dataOrigin: r.data_origin,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
})
const d10 = (v: any) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null)
const toApproval = (r: any): ApprovalRow => ({
  id: Number(r.id), caseId: Number(r.case_id), requiredRole: r.required_role, status: r.status,
  decidedBy: r.decided_by, decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
  comment: r.comment, createdAt: new Date(r.created_at).toISOString(),
})
const toTask = (r: any): TaskRow => ({
  id: Number(r.id), caseId: Number(r.case_id), taskType: r.task_type, title: r.title,
  assigneeRole: r.assignee_role, status: r.status, dueDate: d10(r.due_date), detail: r.detail ?? {},
  response: r.response ?? null, dataOrigin: r.data_origin,
  createdAt: new Date(r.created_at).toISOString(), completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
})
const toEvent = (r: any): EventRow => ({
  id: Number(r.id), caseId: Number(r.case_id), eventType: r.event_type, actorKind: r.actor_kind,
  actorName: r.actor_name, detail: r.detail ?? {}, createdAt: new Date(r.created_at).toISOString(),
})
/* eslint-enable @typescript-eslint/no-explicit-any */

async function logEvent(
  sql: Sql, caseId: number, eventType: string, actorKind: ActorKind, actorName: string | null, detail: Record<string, unknown>,
) {
  await sql`
    INSERT INTO case_events (case_id, event_type, actor_kind, actor_name, detail)
    VALUES (${caseId}, ${eventType}, ${actorKind}, ${actorName}, ${J(sql, detail)})
  `
}

async function loadCase(sql: Sql, caseId: number, lock = false): Promise<DecisionCase> {
  const rows = lock
    ? await sql`SELECT * FROM decision_cases WHERE id = ${caseId} FOR UPDATE`
    : await sql`SELECT * FROM decision_cases WHERE id = ${caseId}`
  if (rows.length === 0) throw new EngineError(`안건 #${caseId} 를 찾을 수 없어요`)
  return toCase(rows[0])
}

export async function getCaseView(sql: Sql, caseId: number): Promise<CaseView> {
  const c = await loadCase(sql, caseId)
  const [ap, tk, ev] = await Promise.all([
    sql`SELECT * FROM approvals WHERE case_id = ${caseId} ORDER BY id`,
    sql`SELECT * FROM tasks WHERE case_id = ${caseId} ORDER BY id`,
    sql`SELECT * FROM case_events WHERE case_id = ${caseId} ORDER BY id`,
  ])
  return { case: c, approvals: ap.map(toApproval), tasks: tk.map(toTask), events: ev.map(toEvent) }
}

export interface CaseFilter {
  caseType?: string
  status?: string
}
export async function listCases(sql: Sql, f: CaseFilter = {}): Promise<DecisionCase[]> {
  const rows = await sql`
    SELECT * FROM decision_cases
    WHERE (${f.caseType ?? null}::text IS NULL OR case_type = ${f.caseType ?? null})
      AND (${f.status ?? null}::text IS NULL OR status = ${f.status ?? null})
    ORDER BY deadline NULLS LAST, id
  `
  return rows.map(toCase)
}

// ───────────────────────── 마감 계산 ─────────────────────────

const DAY = 86_400_000
export function daysUntil(deadline: string | null, asOf: string): number | null {
  if (!deadline) return null
  return Math.round((Date.parse(deadline) - Date.parse(asOf)) / DAY)
}

// ───────────────────────── 안건 접수 ─────────────────────────

export interface NewCase {
  caseType: string
  title: string
  deadline?: string | null
  subjectRefs?: Record<string, string>
  /** payload.facts 에 판단용 사실을 담는다 */
  payload?: Record<string, unknown>
  dataOrigin?: DataOrigin
  actorName?: string
}

export async function createCase(sql: Sql, input: NewCase): Promise<number> {
  const rows = await sql`
    INSERT INTO decision_cases (case_type, title, deadline, subject_refs, payload, data_origin)
    VALUES (${input.caseType}, ${input.title}, ${input.deadline ?? null}, ${J(sql, input.subjectRefs ?? {})},
            ${J(sql, input.payload ?? {})}, ${input.dataOrigin ?? '원본'})
    RETURNING id
  `
  const id = Number(rows[0].id)
  await logEvent(sql, id, 'created', '시스템', input.actorName ?? null, {
    caseType: input.caseType, title: input.title, deadline: input.deadline ?? null, dataOrigin: input.dataOrigin ?? '원본',
  })
  return id
}

// ───────────────────────── 평가 ─────────────────────────

export interface EvalResult {
  caseId: number
  decision: AuthorityDecision
  statusBefore: CaseStatus
  statusAfter: CaseStatus
  authorityBefore: string | null
  authorityAfter: string | null
  /** 승인권자가 바뀌었는가 (조건 변경 시 '결론이 바뀌었나'를 보여주는 값) */
  authorityChanged: boolean
  approvalId: number | null
  newTasks: number[]
  /** 이미 확정된 안건이라 상태는 건드리지 않고 판정만 기록했을 때 true */
  finalized: boolean
}

const FINAL: CaseStatus[] = ['approved', 'rejected', 'closed']

async function createTasks(sql: Sql, caseId: number, specs: TaskSpec[], actor: { kind: ActorKind; name: string | null }) {
  const ids: number[] = []
  for (const s of specs) {
    // 같은 열쇠의 열린 작업이 있으면 만들지 않는다. detail.once 인 작업은 끝난 뒤에도(재평가해도) 다시 만들지 않는다.
    const once = s.detail?.once === true
    const dup = once
      ? await sql`SELECT 1 FROM tasks WHERE case_id = ${caseId} AND detail->>'key' = ${s.key} LIMIT 1`
      : await sql`SELECT 1 FROM tasks WHERE case_id = ${caseId} AND detail->>'key' = ${s.key} AND status = 'open' LIMIT 1`
    if (dup.length > 0) continue
    const detail = { ...(s.detail ?? {}), key: s.key }
    const r = await sql`
      INSERT INTO tasks (case_id, task_type, title, assignee_role, due_date, detail, data_origin)
      VALUES (${caseId}, ${s.taskType}, ${s.title}, ${s.assigneeRole ?? null}, ${s.dueDate ?? null},
              ${J(sql, detail)}, ${s.dataOrigin ?? '원본'})
      RETURNING id
    `
    const id = Number(r[0].id)
    ids.push(id)
    await logEvent(sql, caseId, 'task_created', actor.kind, actor.name, { taskId: id, key: s.key, title: s.title, assigneeRole: s.assigneeRole ?? null })
  }
  return ids
}

/** 안건을 (재)평가한다. 새 사실이 들어오거나 조건이 바뀔 때마다 부른다. */
export async function evaluateCase(sql: Sql, cfg: EngineConfig, caseId: number, reason = '평가'): Promise<EvalResult> {
  return (await sql.begin(async (tx) => evaluateInTx(tx as unknown as Sql, cfg, caseId, reason))) as EvalResult
}

async function evaluateInTx(sql: Sql, cfg: EngineConfig, caseId: number, reason: string): Promise<EvalResult> {
  const c = await loadCase(sql, caseId, true)
  const handler = cfg.handlers[c.caseType]
  const stored = (c.payload.facts ?? {}) as Facts
  const derived = handler?.deriveFacts ? await handler.deriveFacts(c, cfg.ctx) : {}
  const facts: Facts = { ...stored, ...derived }
  const decision = cfg.decide(c.caseType, facts)

  const statusBefore = c.status
  const authorityBefore = c.authority
  const finalized = FINAL.includes(c.status)

  let statusAfter: CaseStatus = statusBefore
  let approvalId: number | null = null
  let newTasks: number[] = []

  if (!finalized) {
    if (decision.status === 'decided' && decision.authority) {
      statusAfter = 'pending_approval'
      const pend = await sql`SELECT id, required_role FROM approvals WHERE case_id = ${caseId} AND status = 'pending'`
      const same = pend.find((p) => p.required_role === decision.authority)
      for (const p of pend) {
        if (p.required_role !== decision.authority) {
          await sql`UPDATE approvals SET status = 'superseded', comment = ${'재평가로 승인권자가 바뀌어 대체됨: ' + reason} WHERE id = ${p.id}`
          await logEvent(sql, caseId, 'approval_superseded', '시스템', null, { approvalId: Number(p.id), oldRole: p.required_role, newRole: decision.authority })
        }
      }
      if (same) approvalId = Number(same.id)
      else {
        const r = await sql`INSERT INTO approvals (case_id, required_role) VALUES (${caseId}, ${decision.authority}) RETURNING id`
        approvalId = Number(r[0].id)
        await logEvent(sql, caseId, 'approval_requested', '시스템', null, {
          approvalId, requiredRole: decision.authority, requiredLabel: cfg.roleLabel(decision.authority), also: decision.also,
        })
      }
      // 확인 요청이 더 필요 없어졌다면(답이 와서 확정) 열린 확인 요청은 정리하지 않는다 — 회신으로 이미 done
    } else if (decision.status === 'need_info') {
      statusAfter = 'need_info'
      const pend = await sql`SELECT id, required_role FROM approvals WHERE case_id = ${caseId} AND status = 'pending'`
      for (const p of pend) {
        await sql`UPDATE approvals SET status = 'superseded', comment = '확인 필요 상태로 전환되어 보류됨' WHERE id = ${p.id}`
        await logEvent(sql, caseId, 'approval_superseded', '시스템', null, {
          approvalId: Number(p.id), oldRole: p.required_role, newRole: null, reason: '모르는 사실이 있어 승인권자를 확정할 수 없음',
        })
      }
      const specs: TaskSpec[] = []
      for (const u of decision.unresolved) {
        for (const fact of u.missingFacts) {
          const info = handler?.describeFact?.(fact)
          specs.push({
            key: `info:${fact}`,
            taskType: 'info_request',
            title: info?.title ?? `확인 필요: ${fact}`,
            assigneeRole: info?.assigneeRole,
            detail: {
              fact, question: info?.question ?? `${fact} 값을 알려 주세요`, ruleId: u.ruleId, wouldRequire: u.wouldRequire,
              wouldRequireLabel: cfg.roleLabel(u.wouldRequire), answerFields: info?.answerFields ?? [{ name: fact, type: 'text', label: fact }],
            },
          })
        }
      }
      newTasks = await createTasks(sql, caseId, specs, { kind: '시스템', name: null })
    } else {
      statusAfter = 'on_hold'
    }
    if (handler?.onEvaluated) {
      const extra = await handler.onEvaluated(c, decision, cfg.ctx)
      newTasks = newTasks.concat(await createTasks(sql, caseId, extra, { kind: '시스템', name: null }))
    }
    await sql`
      UPDATE decision_cases SET status = ${statusAfter}, authority = ${decision.authority}, updated_at = now(),
        payload = ${J(sql, { ...c.payload, evaluation: { at: new Date().toISOString(), decision, facts } })}
      WHERE id = ${caseId}
    `
  }

  await logEvent(sql, caseId, 'evaluated', '시스템', null, {
    reason, finalized, status: decision.status, authority: decision.authority, authorityLabel: decision.authorityLabel,
    also: decision.also, trace: decision.trace, facts, statusBefore, statusAfter,
  })

  return {
    caseId, decision, statusBefore, statusAfter, authorityBefore, authorityAfter: decision.authority,
    authorityChanged: authorityBefore !== decision.authority, approvalId, newTasks, finalized,
  }
}

/** 접수와 첫 평가를 한 번에 */
export async function openCase(sql: Sql, cfg: EngineConfig, input: NewCase): Promise<EvalResult> {
  const id = await createCase(sql, input)
  return evaluateCase(sql, cfg, id, '접수 직후 첫 평가')
}

// ───────────────────────── 새 사실 · 조건 변경 · 회신 ─────────────────────────

export interface FactsChangeResult extends EvalResult {
  changedFacts: Record<string, { before: FactValue; after: FactValue }>
}

/** 조건이 바뀌었거나 새 정보가 들어왔다 → 사실을 고치고 다시 평가한다(재평가). */
export async function updateFacts(
  sql: Sql, cfg: EngineConfig, caseId: number,
  input: { patch: Facts; reason: string; origin: DataOrigin; by: string; kind?: ActorKind },
): Promise<FactsChangeResult> {
  return (await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const c = await loadCase(t, caseId, true)
    const facts = { ...((c.payload.facts ?? {}) as Facts) }
    const changed: Record<string, { before: FactValue; after: FactValue }> = {}
    for (const [k, v] of Object.entries(input.patch)) {
      if (facts[k] !== v) changed[k] = { before: facts[k] ?? null, after: v }
      facts[k] = v
    }
    await t`UPDATE decision_cases SET payload = ${J(t, { ...c.payload, facts })}, updated_at = now() WHERE id = ${caseId}`
    await logEvent(t, caseId, 'facts_changed', input.kind ?? '사람', input.by, { reason: input.reason, origin: input.origin, changed })
    const res = await evaluateInTx(t, cfg, caseId, `조건 변경: ${input.reason}`)
    return { ...res, changedFacts: changed }
  })) as FactsChangeResult
}

/** 확인 요청(info_request)에 대한 회신. 회신은 사실로 합쳐지고 곧바로 재평가된다. */
export async function provideInfo(
  sql: Sql, cfg: EngineConfig, taskId: number,
  input: { answers: Facts; origin: DataOrigin; by: string; note?: string },
): Promise<FactsChangeResult> {
  return (await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const rows = await t`SELECT * FROM tasks WHERE id = ${taskId} FOR UPDATE`
    if (rows.length === 0) throw new EngineError(`작업 #${taskId} 를 찾을 수 없어요`)
    const task = toTask(rows[0])
    if (task.taskType !== 'info_request') throw new EngineError('확인 요청 작업이 아니에요')
    if (task.status !== 'open') throw new EngineError('이미 처리된 작업이에요')
    await t`
      UPDATE tasks SET status = 'done', completed_at = now(), response = ${J(t, { answers: input.answers, note: input.note ?? null, by: input.by })},
        data_origin = ${input.origin} WHERE id = ${taskId}
    `
    await logEvent(t, task.caseId, 'info_received', '사람', input.by, { taskId, answers: input.answers, origin: input.origin })
    const c = await loadCase(t, task.caseId, true)
    const facts = { ...((c.payload.facts ?? {}) as Facts) }
    const changed: Record<string, { before: FactValue; after: FactValue }> = {}
    for (const [k, v] of Object.entries(input.answers)) {
      if (facts[k] !== v) changed[k] = { before: facts[k] ?? null, after: v }
      facts[k] = v
    }
    await t`UPDATE decision_cases SET payload = ${J(t, { ...c.payload, facts })}, updated_at = now() WHERE id = ${task.caseId}`
    const res = await evaluateInTx(t, cfg, task.caseId, `확인 회신 반영 (작업 #${taskId})`)
    return { ...res, changedFacts: changed }
  })) as FactsChangeResult
}

// ───────────────────────── 사람의 결정 ─────────────────────────

export interface DecideResult {
  caseId: number
  outcome: Outcome
  statusAfter: CaseStatus
  taskIds: number[]
}

/** 승인 요청에 대한 사람의 결정. 요청된 승인권자보다 낮은 권한이면 거부한다. */
export async function decide(
  sql: Sql, cfg: EngineConfig, approvalId: number,
  input: { outcome: Outcome; byRole: string; byName: string; comment?: string },
): Promise<DecideResult> {
  return (await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const rows = await t`SELECT * FROM approvals WHERE id = ${approvalId} FOR UPDATE`
    if (rows.length === 0) throw new EngineError(`승인 요청 #${approvalId} 를 찾을 수 없어요`)
    const ap = toApproval(rows[0])
    if (ap.status !== 'pending') throw new EngineError(`이미 처리된 승인 요청이에요 (${ap.status})`)
    if (cfg.roleRank(input.byRole) < cfg.roleRank(ap.requiredRole)) {
      throw new EngineError(
        `권한이 부족해요: 이 건은 ${cfg.roleLabel(ap.requiredRole)} 승인이 필요한데 ${cfg.roleLabel(input.byRole)} 입니다`,
      )
    }
    // 승인 전에 끝나야 하는 앞 단계(detail.gate = 'pre-approval')가 열려 있으면 결정할 수 없다
    const gate = await t`SELECT title FROM tasks WHERE case_id = ${ap.caseId} AND status = 'open' AND detail->>'gate' = 'pre-approval' ORDER BY id`
    if (gate.length > 0) throw new EngineError(`앞 단계가 끝나야 결정할 수 있어요: ${gate.map((g) => g.title).join(', ')}`)
    const c = await loadCase(t, ap.caseId, true)
    const status = input.outcome === 'approved' ? 'approved' : input.outcome === 'rejected' ? 'rejected' : 'on_hold'
    await t`
      UPDATE approvals SET status = ${input.outcome},
        decided_by = ${input.byName && input.byName !== cfg.roleLabel(input.byRole) ? `${input.byName} (${cfg.roleLabel(input.byRole)})` : cfg.roleLabel(input.byRole)},
        decided_at = now(), comment = ${input.comment ?? null} WHERE id = ${approvalId}
    `
    await t`UPDATE decision_cases SET status = ${status}, updated_at = now() WHERE id = ${ap.caseId}`
    await logEvent(t, ap.caseId, 'decided', '사람', input.byName, {
      approvalId, outcome: input.outcome, byRole: input.byRole, byRoleLabel: cfg.roleLabel(input.byRole),
      requiredRole: ap.requiredRole, comment: input.comment ?? null,
    })
    await logEvent(t, ap.caseId, 'status_changed', '시스템', null, { from: c.status, to: status })
    const handler = cfg.handlers[c.caseType]
    const specs = handler?.onDecision ? await handler.onDecision({ ...c, status }, input.outcome, cfg.ctx) : []
    const taskIds = await createTasks(t, ap.caseId, specs, { kind: '시스템', name: null })
    return { caseId: ap.caseId, outcome: input.outcome, statusAfter: status as CaseStatus, taskIds }
  })) as DecideResult
}

/** 부결·보류된 안건을 다시 올린다(재상신). 새 승인 요청이 만들어진다. */
export async function resubmitCase(
  sql: Sql, cfg: EngineConfig, caseId: number, input: { by: string; reason: string },
): Promise<EvalResult> {
  return (await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const c = await loadCase(t, caseId, true)
    if (c.status !== 'rejected' && c.status !== 'on_hold') {
      throw new EngineError(`부결·보류 상태에서만 재상신할 수 있어요 (현재 ${c.status})`)
    }
    await t`UPDATE decision_cases SET status = 'open', updated_at = now() WHERE id = ${caseId}`
    await logEvent(t, caseId, 'resubmitted', '사람', input.by, { reason: input.reason, from: c.status })
    return evaluateInTx(t, cfg, caseId, `재상신: ${input.reason}`)
  })) as EvalResult
}

// ───────────────────────── 작업 처리 ─────────────────────────

/** 일반 작업을 완료한다. 승인된 안건의 열린 작업이 모두 끝나면 안건을 닫는다. */
export async function completeTask(sql: Sql, taskId: number, by: string): Promise<{ caseId: number; caseClosed: boolean }> {
  return (await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const rows = await t`SELECT * FROM tasks WHERE id = ${taskId} FOR UPDATE`
    if (rows.length === 0) throw new EngineError(`작업 #${taskId} 를 찾을 수 없어요`)
    const task = toTask(rows[0])
    if (task.taskType === 'info_request') throw new EngineError('확인 요청은 회신으로만 처리할 수 있어요')
    if (task.status !== 'open') throw new EngineError('이미 처리된 작업이에요')
    const after = task.detail.after ? String(task.detail.after) : null
    if (after) {
      const prev = await t`SELECT title FROM tasks WHERE case_id = ${task.caseId} AND status = 'open' AND detail->>'key' = ${after} LIMIT 1`
      if (prev.length > 0) throw new EngineError(`앞 단계가 먼저 끝나야 해요: ${prev[0].title}`)
    }
    await t`UPDATE tasks SET status = 'done', completed_at = now() WHERE id = ${taskId}`
    await logEvent(t, task.caseId, 'task_done', '사람', by, { taskId, title: task.title })
    const c = await loadCase(t, task.caseId, true)
    const open = await t`SELECT 1 FROM tasks WHERE case_id = ${task.caseId} AND status = 'open' LIMIT 1`
    let caseClosed = false
    if (c.status === 'approved' && open.length === 0) {
      await t`UPDATE decision_cases SET status = 'closed', updated_at = now() WHERE id = ${task.caseId}`
      await logEvent(t, task.caseId, 'status_changed', '시스템', null, { from: 'approved', to: 'closed', reason: '후속 작업 모두 완료' })
      caseClosed = true
    }
    return { caseId: task.caseId, caseClosed }
  })) as { caseId: number; caseClosed: boolean }
}

export async function listOpenTasks(sql: Sql, limit = 50): Promise<(TaskRow & { caseTitle: string })[]> {
  const rows = await sql`
    SELECT t.*, c.title AS case_title FROM tasks t JOIN decision_cases c ON c.id = t.case_id
    WHERE t.status = 'open' ORDER BY t.due_date NULLS LAST, t.id LIMIT ${limit}
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({ ...toTask(r), caseTitle: r.case_title }))
}

export async function listPendingApprovals(sql: Sql): Promise<(ApprovalRow & { caseTitle: string; deadline: string | null })[]> {
  const rows = await sql`
    SELECT a.*, c.title AS case_title, c.deadline FROM approvals a JOIN decision_cases c ON c.id = a.case_id
    WHERE a.status = 'pending' ORDER BY c.deadline NULLS LAST, a.id
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({ ...toApproval(r), caseTitle: r.case_title, deadline: d10(r.deadline) }))
}

// ───────────────────────── 초기화 (시험·점검용 — 화면에서는 부르지 않는다) ─────────────────────────

/** 안건·이력·승인·작업·가정을 모두 지운다. 원본 복사본(source_rows)은 그대로 둔다. */
export async function resetEngineData(sql: Sql): Promise<void> {
  await sql`TRUNCATE decision_cases, assumptions, submissions, submission_files RESTART IDENTITY CASCADE`
}
