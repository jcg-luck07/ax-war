'use client'

// 화면의 상호작용 조각(승인·회신·조건 변경·작업 완료·재상신·접수·사용자 권한). 저장은 모두 app/actions.ts 의 서버 동작이 한다.
// 누가 할 수 있는지는 서버가 로그인 사용자의 역할로 다시 확인하고, 여기서는 안내 문구와 버튼 비활성화만 한다.
import { useState, useTransition } from 'react'
import { Button, Checkbox, Input, Label, Radio, RadioGroup, TextField, toast } from '@heroui/react'
import type { Outcome } from '@/lib/engine/engine'
import {
  bulkReplyAction, completeTaskAction, decideAction, importPlansAction, provideInfoAction, receiveContractAction, removeUserAction,
  requestPurchaseAction, resubmitAction, setUserRolesAction, updateFactAction, type ActionResult,
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

// ── 승인 패널 ──
export function DecisionPanel({ approvalId, requiredLabel, allowed, myRoles }: { approvalId: number; requiredLabel: string; allowed: boolean; myRoles: string }) {
  const { pending, run } = useRun()
  const [comment, setComment] = useState('')
  const go = (outcome: Outcome) => run(() => decideAction({ approvalId, outcome, comment }))
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
          <div className="flex flex-wrap gap-2">
            <Button isDisabled={pending} onPress={() => go('approved')}>승인</Button>
            <Button isDisabled={pending} variant="outline" data-color="danger" onPress={() => go('rejected')}>부결</Button>
            <Button isDisabled={pending} variant="ghost" onPress={() => go('on_hold')}>보류</Button>
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
    const value: Scalar = fact.endsWith('_krw') ? Math.round(Number(v) * unitMultiplier) : v
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
    <Button variant="secondary" isDisabled={pending || !allowed} onPress={() => run(() => resubmitAction({ caseId, reason: '조건을 보완해 재상신' }))}>
      다시 올리기 (재상신)
    </Button>
  )
}

// ── 안건 접수 ──
export function ImportPlansButton({ fresh }: { fresh: number }) {
  const { pending, run } = useRun()
  return (
    <Button isDisabled={pending || fresh === 0} onPress={() => run(() => importPlansAction())}>
      {fresh === 0 ? '새로 접수할 기안이 없어요' : `새 기안 ${fresh}건 접수`}
    </Button>
  )
}

export interface ContractDefaults {
  influencerId: string
  annualFixedFeeEok: string
  notifyDeadline: string
  currentExpiry: string
}

export function ContractNoticeForm({ defaults }: { defaults: ContractDefaults }) {
  const { pending, run } = useRun()
  const [f, setF] = useState({ ...defaults, fixedFeePaymentDate: '', note: '' })
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const field = (k: keyof typeof f, label: string, placeholder = '') => (
    <TextField value={f[k]} onChange={set(k)} aria-label={label}>
      <Label>{label}</Label>
      <Input placeholder={placeholder} />
    </TextField>
  )
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {field('influencerId', '인플루언서 번호', '예: INF-001')}
      {field('annualFixedFeeEok', '연 고정 피 (억 원)', '예: 28')}
      {field('notifyDeadline', '해지·조건변경 통보 기한', 'YYYY-MM-DD')}
      {field('currentExpiry', '현 계약 만료일', 'YYYY-MM-DD')}
      {field('fixedFeePaymentDate', '고정 피 지급일 (모르면 비워 두세요)', 'YYYY-MM-DD')}
      {field('note', '메모 (선택)')}
      <div className="sm:col-span-2">
        <Button isDisabled={pending} onPress={() => run(() => receiveContractAction({ ...f, annualFixedFeeEok: Number(f.annualFixedFeeEok) }))}>
          전속계약 갱신 안건 접수
        </Button>
      </div>
    </div>
  )
}

export function PurchaseRequestForm() {
  const { pending, run } = useRun()
  const [f, setF] = useState({ title: '', skuId: '', amountMan: '', paymentDueDate: '' })
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const field = (k: keyof typeof f, label: string, placeholder = '') => (
    <TextField value={f[k]} onChange={set(k)} aria-label={label}>
      <Label>{label}</Label>
      <Input placeholder={placeholder} />
    </TextField>
  )
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {field('title', '발주 내용', '예: 더마 세럼 추가 발주')}
      {field('skuId', 'SKU (선택)', '예: SKU-1001')}
      {field('amountMan', '발주 금액 (만 원)', '예: 5000')}
      {field('paymentDueDate', '대금 지급 예정일 (모르면 비워 두세요)', 'YYYY-MM-DD')}
      <div className="sm:col-span-2">
        <Button isDisabled={pending} onPress={() => run(() => requestPurchaseAction({ ...f, amountMan: Number(f.amountMan) }), () => setF({ title: '', skuId: '', amountMan: '', paymentDueDate: '' }))}>
          발주 승인 요청 접수
        </Button>
      </div>
    </div>
  )
}

// ── 사용자·권한 (관리자) ──
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
