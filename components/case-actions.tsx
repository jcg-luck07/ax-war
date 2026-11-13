'use client'

// 화면의 상호작용 조각(승인·회신·조건 변경·작업 완료·재보고·접수·사용자 권한). 저장은 모두 app/actions.ts 의 서버 동작이 한다.
// 누가 할 수 있는지는 서버가 로그인 사용자의 역할로 다시 확인하고, 여기서는 안내 문구와 버튼 비활성화만 한다.
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/components/ax'
import { Button, Checkbox, Input, Label, Radio, RadioGroup, TextField, toast } from '@heroui/react'
import {
  addCandidateAction, bulkReplyAction, completeTaskAction, removeCandidateAction, provideInfoAction, removeUserAction,
  resubmitAction, setUserRolesAction, updateFactAction, type ActionResult,
} from '@/app/actions'

type Scalar = string | number | boolean | null

function useRun() {
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn()
      if (r.ok) {
        toast.success(r.message)
        after?.()
      } else toast.danger(r.message)
    })
  return { pending, run }
}

// ── 후보 표시 ──
// 이 안건이 미확정(후보) 목록에 올라 있으면 안건 화면에 알려 준다. 후보에서 뺄 수도 있다.
export function CandidateBadge({ caseId, label, addedBy, canRemove }: { caseId: number; label: string; addedBy: string; canRemove: boolean }) {
  const { pending, run } = useRun()
  const router = useRouter()
  return (
    <div className="flex flex-wrap items-center gap-2 border border-primary bg-primary-soft p-2" style={{ borderRadius: 2 }}>
      <span className="t-small"><strong>이미 &quot;{label}&quot;로 들어가 있는 안건이에요</strong> <span className="t-caption">({addedBy}) · 안건 상태는 바뀌지 않았고, 안건 목록 위쪽의 미확정 안건에서 확정해요. 다른 처리를 하려면 먼저 후보에서 빼세요.</span></span>
      <Link href="/cases" className="t-small underline">미확정 안건 보기</Link>
      {canRemove && <Button size="sm" isDisabled={pending} onPress={() => run(() => removeCandidateAction({ caseIds: [caseId] }), () => router.refresh())}>후보에서 빼기</Button>}
    </div>
  )
}

// ── 승인 패널 ──
// 승인권자는 세 가지 중 하나를 후보로 넣는다 (바로 확정하지 않는다 — 안건 목록 위쪽의 미확정 안건에서 확정).
//   승인   — 계약 담당이 이어서 절차를 진행한다.
//   부결   — 이 안건을 진행하지 않는다 (캠페인: 집행하지 않음 → 계약 담당이 후속 처리 후 종결 / 인플루언서: 계약을 연장하지 않음 → 계약 담당 후속조치 → 승인권자 재승인 → 통지서 발송 후 종결).
//   재검토 — 처음 안건을 올린 부서로 돌려보내 보완한 뒤 재무팀부터 처음부터 다시 절차를 진행한다. 남은 계약 기한이 3주 이내면 먼저 경고한다.
// kind 'nonrenewal'(부결 뒤 계약 미갱신 통지서 승인)에서는 승인·재검토만 고를 수 있다.
export function DecisionPanel({
  caseId, requiredLabel, allowed, myRoles, warning = null, reviewWarning = null, kind = 'main', isContract = false,
}: {
  caseId: number; requiredLabel: string; allowed: boolean; myRoles: string; warning?: string | null; reviewWarning?: string | null; kind?: string; isContract?: boolean
}) {
  const { pending, run } = useRun()
  const confirm = useConfirm()
  const [comment, setComment] = useState('')
  const router = useRouter()
  // 바로 확정하지 않고 후보로 넣는다 (안건 상태는 바뀌지 않는다). 확인창은 전환(run) 밖에서 기다린다.
  const go = async (kind: 'approve' | 'reject' | 'hold') => {
    // 연관 안건에 부결이 있는데 승인 후보로 넣으려면 한 번 더 묻는다
    if (kind === 'approve' && warning && !(await confirm({ title: '연관 안건에 부결이 있어요', description: warning, details: '그래도 승인 후보로 넣으시겠습니까?', confirmLabel: '후보로 넣기', cancelLabel: '취소', variant: 'warning' }))) return
    // 남은 계약 기한이 3주 이내인데 재검토 후보로 넣으면 기한을 넘길 수 있다
    if (kind === 'hold' && reviewWarning && !(await confirm({ title: '남은 계약 기한이 얼마 없어요', description: reviewWarning, details: '그래도 재검토 후보로 넣으시겠습니까?', confirmLabel: '후보로 넣기', cancelLabel: '취소', variant: 'warning' }))) return
    run(() => addCandidateAction({ caseId, kind, params: { comment } }), () => router.refresh())
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="t-small">
        이 건은 <strong>{requiredLabel}</strong> 의 결정이 필요해요.{' '}
        {allowed ? <>내 역할({myRoles})로 결정할 수 있어요.</> : <>내 역할({myRoles || '없음'})로는 결정할 수 없어요. 권한이 있는 사람에게 알려 주세요.</>}
      </p>
      {allowed && (
        <>
          <TextField value={comment} onChange={setComment} aria-label="결정 사유">
            <Label>결정 사유 (선택)</Label>
            <Input placeholder="예: 실질 공헌이익을 확인한 뒤 조건 변경을 통보한다" />
          </TextField>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button isDisabled={pending} onPress={() => go('approve')}>승인 후보로 넣기</Button>
              <span className="t-caption">확정하면 계약 담당이 이어서 절차를 진행해요.</span>
            </div>
            {kind === 'main' && (
              <div className="flex flex-wrap items-center gap-2">
                <Button isDisabled={pending} variant="outline" data-color="danger" onPress={() => go('reject')}>부결 후보로 넣기</Button>
                <span className="t-caption">{isContract ? '확정하면 계약을 연장하지 않아요. 계약 담당이 후속조치를 한 뒤 다시 승인을 받아요.' : '확정하면 이 캠페인을 진행하지 않아요. 계약 담당이 후속 처리 후 종결해요.'}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button isDisabled={pending} variant="outline" onPress={() => go('hold')}>재검토 후보로 넣기</Button>
              <span className="t-caption">{kind === 'main' ? '확정하면 처음 올린 마케팅으로 돌려보내 보완한 뒤, 재무팀부터 처음부터 다시 절차를 진행해요.' : '확정하면 계약 담당에게 돌려보내 보완한 뒤 다시 보고하게 해요.'}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── 확인 요청 회신 ──
export interface AnswerFieldView {
  name: string
  type: 'date' | 'boolean' | 'number' | 'text'
  label: string
}

function AnswerInputs({ fields, vals, setVals }: { fields: AnswerFieldView[]; vals: Record<string, string>; setVals: (f: (s: Record<string, string>) => Record<string, string>) => void }) {
  return (
    <>
      {fields.map((f) =>
        f.type === 'boolean' ? (
          <RadioGroup key={f.name} name={f.name} value={vals[f.name] ?? ''} onChange={(v) => setVals((s) => ({ ...s, [f.name]: v }))} orientation="horizontal" aria-label={f.label}>
            <Label>{f.label}</Label>
            {[['true', '예'], ['false', '아니오']].map(([v, l]) => (
              <Radio key={v} value={v}>
                <Radio.Control>
                  <Radio.Indicator />
                </Radio.Control>
                <Radio.Content>
                  <Label>{l}</Label>
                </Radio.Content>
              </Radio>
            ))}
          </RadioGroup>
        ) : (
          <TextField key={f.name} value={vals[f.name] ?? ''} onChange={(v) => setVals((s) => ({ ...s, [f.name]: v }))} aria-label={f.label}>
            <Label>{f.label}</Label>
            <Input placeholder={f.type === 'date' ? 'YYYY-MM-DD (예: 2026-08-24)' : ''} />
          </TextField>
        ),
      )}
    </>
  )
}

function parseAnswers(fields: AnswerFieldView[], vals: Record<string, string>): Record<string, Scalar> | null {
  const answers: Record<string, Scalar> = {}
  for (const f of fields) {
    const v = vals[f.name]
    if (v === undefined || v === '') {
      toast.danger(`'${f.label}' 값을 입력해 주세요.`)
      return null
    }
    answers[f.name] = f.type === 'boolean' ? v === 'true' : f.type === 'number' ? Number(v) : v
  }
  return answers
}

export function InfoReplyForm({ taskId, fields, allowed, assignee }: { taskId: number; fields: AnswerFieldView[]; allowed: boolean; assignee: string }) {
  const { pending, run } = useRun()
  const [vals, setVals] = useState<Record<string, string>>({})
  if (!allowed) return <p className="t-caption">{assignee} 담당자가 회신해야 해요. 내 역할로는 회신할 수 없어요.</p>
  return (
    <div className="flex flex-col gap-3">
      <AnswerInputs fields={fields} vals={vals} setVals={setVals} />
      <div>
        <Button size="sm" isDisabled={pending} onPress={() => { const a = parseAnswers(fields, vals); if (a) run(() => provideInfoAction({ taskId, answers: a })) }}>
          회신 입력
        </Button>
      </div>
    </div>
  )
}

/** 같은 질문을 하는 확인 요청 여러 건에 한 번에 회신 (예: 300억 사업 연결 여부) */
export function BulkReplyForm({ fact, fields, count }: { fact: string; fields: AnswerFieldView[]; count: number }) {
  const { pending, run } = useRun()
  const [vals, setVals] = useState<Record<string, string>>({})
  return (
    <div className="flex flex-col gap-3">
      <AnswerInputs fields={fields} vals={vals} setVals={setVals} />
      <div>
        <Button size="sm" variant="secondary" isDisabled={pending} onPress={() => { const a = parseAnswers(fields, vals); if (a) run(() => bulkReplyAction({ fact, answers: a })) }}>
          같은 질문 {count}건에 한 번에 회신
        </Button>
      </div>
    </div>
  )
}

// ── 조건 변경 ──
export function FactChangeForm({
  caseId, fact, label, placeholder, unitMultiplier = 1, hint, allowed,
}: { caseId: number; fact: string; label: string; placeholder: string; unitMultiplier?: number; hint?: string; allowed: boolean }) {
  const { pending, run } = useRun()
  const [v, setV] = useState('')
  const [reason, setReason] = useState('')
  if (!allowed) return null
  const submit = () => {
    if (!v) return toast.danger('바꿀 값을 입력해 주세요.')
    const value: Scalar = fact.endsWith('_krw') ? Math.round(Number(v.replace(/,/g, '')) * unitMultiplier) : v
    if (typeof value === 'number' && !Number.isFinite(value)) return toast.danger('숫자로 입력해 주세요.')
    run(() => updateFactAction({ caseId, fact, value, reason: reason || `${label} 변경` }), () => { setV(''); setReason('') })
  }
  return (
    <div className="flex flex-col gap-3">
      {hint && <p className="t-caption">{hint}</p>}
      <TextField value={v} onChange={setV} aria-label={label}>
        <Label>{label}</Label>
        <Input placeholder={placeholder} />
      </TextField>
      <TextField value={reason} onChange={setReason} aria-label="변경 사유">
        <Label>변경 사유</Label>
        <Input placeholder="예: 상대방이 고정 피 인하를 제안" />
      </TextField>
      <div>
        <Button size="sm" variant="secondary" isDisabled={pending} onPress={submit}>조건 변경 반영</Button>
      </div>
    </div>
  )
}

export function TaskDoneButton({ taskId, allowed }: { taskId: number; allowed: boolean }) {
  const { pending, run } = useRun()
  return (
    <Button size="sm" variant="outline" isDisabled={pending || !allowed} onPress={() => run(() => completeTaskAction({ taskId }))}>
      완료 처리
    </Button>
  )
}

export function ResubmitButton({ caseId, allowed }: { caseId: number; allowed: boolean }) {
  const { pending, run } = useRun()
  return (
    <Button variant="secondary" isDisabled={pending || !allowed} onPress={() => run(() => resubmitAction({ caseId, reason: '조건을 보완해 재보고' }))}>
      다시 보고하기 (재무팀부터 다시 진행)
    </Button>
  )
}

export function UserRoleForm({ roles, initial }: { roles: { id: string; label: string }[]; initial?: { email: string; name: string; roles: string[] } }) {
  const { pending, run } = useRun()
  const [email, setEmail] = useState(initial?.email ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [picked, setPicked] = useState<string[]>(initial?.roles ?? [])
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...new Set([...p, id])] : p.filter((x) => x !== id)))
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField value={email} onChange={setEmail} aria-label="이메일" isReadOnly={Boolean(initial)}>
          <Label>이메일 (axhub 로그인 이메일)</Label>
          <Input placeholder="name@company.com" />
        </TextField>
        <TextField value={name} onChange={setName} aria-label="이름">
          <Label>이름</Label>
          <Input placeholder="홍길동" />
        </TextField>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {roles.map((r) => (
          <Checkbox key={r.id} isSelected={picked.includes(r.id)} onChange={(on) => toggle(r.id, on)}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>{r.label}</Label>
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" isDisabled={pending} onPress={() => run(() => setUserRolesAction({ email, name, roles: picked }), initial ? undefined : () => { setEmail(''); setName(''); setPicked([]) })}>
          저장
        </Button>
        {initial && (
          <Button size="sm" variant="outline" data-color="danger" isDisabled={pending} onPress={() => run(() => removeUserAction({ email: initial.email }))}>
            목록에서 빼기
          </Button>
        )}
      </div>
    </div>
  )
}
