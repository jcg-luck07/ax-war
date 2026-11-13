// 미확정(후보) 안건 — 회부·승인·부결·재검토 같은 처리를 바로 확정하지 않고 "후보"로 먼저 모아 두는 장치 (서버 전용).
//  · 후보로 넣어도 안건의 진행 상태는 바뀌지 않고, 업무 흐름에 단계가 더해지지도 않는다. 안건 목록에서 옮겨 가는 것이 아니라 미확정 목록에 "더해질" 뿐이다.
//  · 한 안건에는 후보가 하나만 있다 (다른 후보로 넣으면 바뀐다).
//  · 하나의 기안서에 속한 여러 안건을 후보로 모아 두었다가, 미확정 목록에서 한꺼번에 비교하며 확정하거나 다른 후보로 바꾼다.
//  · 확정할 때 처리 권한과 현재 상태를 안건마다 다시 확인한다 (그 사이에 상태가 바뀌었을 수 있다).
import type { Sql } from 'postgres'
import { EngineError, decide, getCaseView, type EngineConfig } from '@/lib/engine/engine'
import { canHandle, decidingRole, type AppUser } from '@/lib/app/auth'
import { AS_OF, roleLabel } from '@/lib/app/engine'
import { financeRefer, contractRefer, requestRework, REWORK_TARGETS } from './handoff'
import { beyondGroupFundPeriod } from './group-fund'
import { outflowDate } from './handlers'

export const CANDIDATE_KINDS = ['proceed', 'rework', 'approve', 'reject', 'hold'] as const
export type CandidateKind = (typeof CANDIDATE_KINDS)[number]

/** 후보 이름 (버튼·분류 이름에 쓴다) */
export const KIND_LABEL: Record<CandidateKind, string> = { proceed: '회부', rework: '보완요청', approve: '승인', reject: '부결', hold: '재검토' }

export interface CandidateParams {
  /** 재무팀 회부: 그룹 300억 배분 검토 대상인가 */
  linked?: boolean
  /** 보완요청: 보완을 요청할 팀(assignee 값)과 내용 */
  toRole?: string
  note?: string
  /** 승인·부결·재검토 사유 */
  comment?: string
  /** 회부·보완요청이 향하는 곳의 화면 이름 (분류 이름에 쓴다. 후보로 넣을 때 정해진다) */
  target?: string
}

export interface Candidate {
  caseId: number
  kind: CandidateKind
  params: CandidateParams
  addedBy: string
  createdAt: string
}

/** 분류 키 — 같은 종류·같은 목적지의 후보끼리 묶는다 (예: "proceed:계약 담당", "approve") */
export const groupKey = (c: Pick<Candidate, 'kind' | 'params'>): string => (c.kind === 'proceed' || c.kind === 'rework' ? `${c.kind}:${c.params.target ?? ''}` : c.kind)
/** 분류 이름 (예: "회부 후보 — 계약 담당", "승인 후보") */
export const groupLabel = (key: string): string => {
  const [kind, target] = key.split(':') as [CandidateKind, string | undefined]
  return `${KIND_LABEL[kind] ?? kind} 후보${target ? ` — ${target}` : ''}`
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toCandidate = (r: any): Candidate => ({ caseId: Number(r.case_id), kind: r.kind, params: (r.params ?? {}) as CandidateParams, addedBy: r.added_by, createdAt: new Date(r.created_at).toISOString() })

export async function listCandidates(sql: Sql): Promise<Candidate[]> {
  const rows = await sql`SELECT * FROM case_candidates ORDER BY created_at, case_id`
  return rows.map(toCandidate)
}

export async function getCandidate(sql: Sql, caseId: number): Promise<Candidate | null> {
  const [r] = await sql`SELECT * FROM case_candidates WHERE case_id = ${caseId}`
  return r ? toCandidate(r) : null
}

async function put(sql: Sql, caseId: number, kind: CandidateKind, params: CandidateParams, by: string) {
  await sql`
    INSERT INTO case_candidates (case_id, kind, params, added_by) VALUES (${caseId}, ${kind}, ${sql.json(params as never)}, ${by})
    ON CONFLICT (case_id) DO UPDATE SET kind = EXCLUDED.kind, params = EXCLUDED.params, added_by = EXCLUDED.added_by, created_at = now()`
}

export async function removeCandidates(sql: Sql, caseIds: number[]): Promise<number> {
  if (caseIds.length === 0) return 0
  const r = await sql`DELETE FROM case_candidates WHERE case_id IN ${sql(caseIds)}`
  return r.count
}

// ───────── 지금 이 안건에서 할 수 있는 처리인지 확인 (후보로 넣을 때·확정할 때 같은 기준)
export interface Check {
  /** 처리 단계: 재무팀·계약 담당 회부 단계이거나 승인 결정 단계 */
  step: 'finance' | 'contract' | 'approval'
  approvalId?: number
  byRole?: string
  /** 회부·보완요청이 향하는 곳의 화면 이름 */
  target: string
}

export async function checkCandidate(sql: Sql, user: AppUser, caseId: number, kind: CandidateKind, params: CandidateParams): Promise<Check> {
  if (!CANDIDATE_KINDS.includes(kind)) throw new EngineError('알 수 없는 처리예요')
  const view = await getCaseView(sql, caseId)
  const open = view.tasks.filter((t) => t.status === 'open')
  const gateOpen = open.some((t) => t.detail.gate === 'pre-approval')
  const pending = view.approvals.find((a) => a.status === 'pending')

  if (kind === 'approve' || kind === 'reject' || kind === 'hold') {
    if (!pending) throw new EngineError('지금은 승인 결정 단계가 아니에요')
    if (gateOpen) throw new EngineError('앞 단계(재무팀·계약 담당)가 아직 끝나지 않아 결정할 수 없어요')
    const role = decidingRole(user, pending.requiredRole)
    if (!role) throw new EngineError(`이 건은 ${roleLabel(pending.requiredRole)} 승인이 필요해요. 내 역할로는 처리할 수 없어요`)
    if (kind === 'reject' && pending.kind === 'nonrenewal') throw new EngineError('계약 미갱신 통지서는 부결할 수 없어요 (승인 또는 재검토만 가능해요)')
    return { step: 'approval', approvalId: pending.id, byRole: role, target: '' }
  }

  // 회부·보완요청: 재무팀 단계(성과·비용표 취합)가 먼저 열려 있으면 그 단계, 아니면 계약 담당 단계
  const keyOf = (t: (typeof open)[number]) => String(t.detail.key ?? '')
  const fin = open.find((t) => keyOf(t) === 'collect-performance')
  const con = open.find((t) => keyOf(t) === 'confirm-terms' && !(t.detail.after && open.some((x) => keyOf(x) === String(t.detail.after))))
  const step = fin ? 'finance' : con ? 'contract' : null
  if (!step) throw new EngineError('지금은 회부할 수 있는 단계가 아니에요')
  if (!canHandle(user, step === 'finance' ? '재무' : '계약 담당')) throw new EngineError(`이 단계는 ${step === 'finance' ? '재무팀' : '계약 담당'}이 처리해요. 내 역할로는 처리할 수 없어요`)
  if (kind === 'proceed') {
    if (step === 'finance' && typeof params.linked !== 'boolean') throw new EngineError('그룹 300억 배분 대상 여부를 먼저 정해 주세요')
    return { step, target: step === 'finance' ? '계약 담당' : pending ? roleLabel(pending.requiredRole) : '승인권자' }
  }
  const targets = REWORK_TARGETS[step === 'finance' ? 'collect-performance' : 'confirm-terms']
  const t = targets.find((x) => x.role === params.toRole)
  if (!t) throw new EngineError('보완을 요청할 수 있는 팀이 아니에요 (이전에 거쳐 온 팀만 고를 수 있어요)')
  return { step, target: t.label }
}

/** 후보로 넣는다 (이미 후보면 바뀐다). 안건의 진행 상태는 바뀌지 않는다. */
export async function addCandidate(sql: Sql, user: AppUser, input: { caseId: number; kind: CandidateKind; params: CandidateParams }): Promise<{ target: string }> {
  const chk = await checkCandidate(sql, user, input.caseId, input.kind, input.params)
  const params: CandidateParams = { ...input.params, comment: input.params.comment?.slice(0, 200), note: input.params.note?.slice(0, 200), target: chk.target || undefined }
  await put(sql, input.caseId, input.kind, params, user.name)
  return { target: chk.target }
}

/** 후보를 확정한다 — 실제로 처리하고(회부·승인·부결·재검토·보완요청) 후보에서 뺀다. 처리 권한과 현재 상태를 다시 확인한다. */
export async function confirmCandidate(sql: Sql, cfg: EngineConfig, user: AppUser, c: Candidate): Promise<string> {
  const chk = await checkCandidate(sql, user, c.caseId, c.kind, c.params)
  let msg: string
  if (c.kind === 'approve' || c.kind === 'reject' || c.kind === 'hold') {
    const outcome = c.kind === 'approve' ? 'approved' : c.kind === 'reject' ? 'rejected' : 'on_hold'
    await decide(sql, cfg, chk.approvalId!, { outcome, byRole: chk.byRole!, byName: user.name, comment: c.params.comment || undefined })
    msg = `${KIND_LABEL[c.kind]}했어요`
  } else if (c.kind === 'proceed') {
    if (chk.step === 'finance') {
      // 집행 예정일이 300억 집행 기준기간(향후 6개월)을 넘으면 검토 대상이 될 수 없다
      if (c.params.linked && beyondGroupFundPeriod(outflowDate((await getCaseView(sql, c.caseId)).case), AS_OF)) {
        throw new EngineError('집행 예정일이 300억 집행 기준기간(향후 6개월)을 넘어서 검토 대상으로 처리할 수 없어요')
      }
      await financeRefer(sql, cfg, c.caseId, { linked: Boolean(c.params.linked), by: user.name })
    } else {
      await contractRefer(sql, c.caseId, user.name)
    }
    msg = `${chk.target}(으)로 회부했어요`
  } else {
    await requestRework(sql, c.caseId, { fromKey: chk.step === 'finance' ? 'collect-performance' : 'confirm-terms', toRole: c.params.toRole!, note: c.params.note ?? '', by: user.name })
    msg = `${chk.target}에 보완을 요청했어요`
  }
  await removeCandidates(sql, [c.caseId])
  return msg
}

/** 여러 안건을 다른 후보로 바꾼다 (미확정 목록에서 체크한 안건들). 안건마다 결과를 돌려준다. */
export async function changeCandidates(sql: Sql, user: AppUser, caseIds: number[], kind: CandidateKind, params: CandidateParams) {
  const out: { caseId: number; ok: boolean; message: string }[] = []
  for (const caseId of caseIds) {
    try {
      const r = await addCandidate(sql, user, { caseId, kind, params })
      out.push({ caseId, ok: true, message: r.target ? `${KIND_LABEL[kind]} 후보(${r.target})로 바꿨어요` : `${KIND_LABEL[kind]} 후보로 바꿨어요` })
    } catch (e) {
      out.push({ caseId, ok: false, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

/** 여러 안건의 후보를 한꺼번에 확정한다. 안건마다 따로 처리해서, 일부가 실패해도 나머지는 처리된다. */
export async function confirmCandidates(sql: Sql, cfg: EngineConfig, user: AppUser, caseIds: number[]) {
  const out: { caseId: number; ok: boolean; message: string }[] = []
  for (const caseId of caseIds) {
    const c = await getCandidate(sql, caseId)
    if (!c) { out.push({ caseId, ok: false, message: '후보가 아니에요 (이미 처리했거나 후보에서 빠졌어요)' }); continue }
    try {
      out.push({ caseId, ok: true, message: await confirmCandidate(sql, cfg, user, c) })
    } catch (e) {
      out.push({ caseId, ok: false, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}
