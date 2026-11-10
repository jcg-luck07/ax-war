'use client'

// 안건 화면의 상호작용 조각(승인·회신·조건 변경·작업 완료·재상신). 저장은 모두 app/actions.ts 의 서버 동작이 한다.
import { useState, useTransition } from 'react'
import { Button, Input, Label, Radio, RadioGroup, TextField, toast } from '@heroui/react'
import type { Outcome } from '@/lib/engine/engine'
import {
  bulkAnswerAction, completeTaskAction, decideAction, provideInfoAction, resetAction, resubmitAction, samplePurchaseOrdersAction,
  seedAction, updateFactAction, type ActionResult,
} from '@/app/actions'

type Scalar = string | number | boolean | null

function useRun() {
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn()
      if (r.ok) toast.success(r.message)
      else toast.danger(r.message)
    })
  return { pending, run }
}

// ── 승인 패널: "지금 누구로 결정하나"를 고르고 승인/부결/보류 ──
export function DecisionPanel({ approvalId, requiredLabel, roles }: { approvalId: number; requiredLabel: string; roles: { id: string; label: string }[] }) {
  const { pending, run } = useRun()
  const [role, setRole] = useState(roles[roles.length - 1]?.id ?? '')
  const [comment, setComment] = useState('')
  const go = (outcome: Outcome) => run(() => decideAction({ approvalId, outcome, byRole: role, byName: '', comment }))
  return (
    <div className="flex flex-col gap-4">
      <p className="t-small">
        이 건은 <strong>{requiredLabel}</strong> 의 결정이 필요해요. 시연에서는 아래에서 결정하는 역할을 골라요. 권한이 낮은 역할을 고르면 시스템이 거부해요.
      </p>
      <RadioGroup name="role" value={role} onChange={setRole} orientation="horizontal" aria-label="결정하는 역할">
        {roles.map((r) => (
          <Radio key={r.id} value={r.id}>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <Radio.Content>
              <Label>{r.label}</Label>
            </Radio.Content>
          </Radio>
        ))}
      </RadioGroup>
      <TextField value={comment} onChange={setComment} aria-label="결정 사유">
        <Label>결정 사유 (선택)</Label>
        <Input placeholder="예: 실질 공헌이익 확인 후 조건 변경 통보" />
      </TextField>
      <div className="flex flex-wrap gap-2">
        <Button isDisabled={pending} onPress={() => go('approved')}>
          승인
        </Button>
        <Button isDisabled={pending} variant="outline" data-color="danger" onPress={() => go('rejected')}>
          부결
        </Button>
        <Button isDisabled={pending} variant="ghost" onPress={() => go('on_hold')}>
          보류
        </Button>
      </div>
    </div>
  )
}

// ── 확인 요청 회신 (모의 회신) ──
export interface AnswerFieldView {
  name: string
  type: 'date' | 'boolean' | 'number' | 'text'
  label: string
}

export function InfoReplyForm({ taskId, fields, byDefault }: { taskId: number; fields: AnswerFieldView[]; byDefault: string }) {
  const { pending, run } = useRun()
  const [vals, setVals] = useState<Record<string, string>>({})
  const submit = () => {
    const answers: Record<string, Scalar> = {}
    for (const f of fields) {
      const v = vals[f.name]
      if (v === undefined || v === '') {
        toast.danger(`'${f.label}' 값을 입력해 주세요.`)
        return
      }
      answers[f.name] = f.type === 'boolean' ? v === 'true' : f.type === 'number' ? Number(v) : v
    }
    run(() => provideInfoAction({ taskId, answers, by: byDefault }))
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="t-caption">아래 값은 담당 부서의 모의 회신으로 입력돼요 (가상 입력으로 기록됨).</p>
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
      <div>
        <Button size="sm" isDisabled={pending} onPress={submit}>
          회신 반영
        </Button>
      </div>
    </div>
  )
}

// ── 조건 변경 (새 입력이 들어옴) ──
export function FactChangeForm({
  caseId, fact, label, placeholder, unitMultiplier = 1, hint,
}: { caseId: number; fact: string; label: string; placeholder: string; unitMultiplier?: number; hint?: string }) {
  const { pending, run } = useRun()
  const [v, setV] = useState('')
  const [reason, setReason] = useState('')
  const submit = () => {
    if (!v) return toast.danger('바꿀 값을 입력해 주세요.')
    const value: Scalar = fact.endsWith('_krw') ? Math.round(Number(v) * unitMultiplier) : v
    if (typeof value === 'number' && !Number.isFinite(value)) return toast.danger('숫자로 입력해 주세요.')
    run(() => updateFactAction({ caseId, fact, value, reason: reason || `${label} 변경`, by: '담당자(모의)' }))
  }
  return (
    <div className="flex flex-col gap-3">
      {hint && <p className="t-caption">{hint}</p>}
      <TextField value={v} onChange={setV} aria-label={label}>
        <Label>{label}</Label>
        <Input placeholder={placeholder} />
      </TextField>
      <TextField value={reason} onChange={setReason} aria-label="변경 사유">
        <Label>변경 사유 (선택)</Label>
        <Input placeholder="예: 혜인 측이 고정 피 인하를 제안" />
      </TextField>
      <div>
        <Button size="sm" variant="secondary" isDisabled={pending} onPress={submit}>
          조건 변경 반영
        </Button>
      </div>
    </div>
  )
}

export function TaskDoneButton({ taskId }: { taskId: number }) {
  const { pending, run } = useRun()
  return (
    <Button size="sm" variant="outline" isDisabled={pending} onPress={() => run(() => completeTaskAction({ taskId, by: '담당자' }))}>
      완료 처리
    </Button>
  )
}

export function ResubmitButton({ caseId }: { caseId: number }) {
  const { pending, run } = useRun()
  return (
    <Button variant="secondary" isDisabled={pending} onPress={() => run(() => resubmitAction({ caseId, reason: '조건을 보완해 재상신' }))}>
      다시 올리기 (재상신)
    </Button>
  )
}

// ── 시연 도구 ──
export function DemoControls() {
  const { pending, run } = useRun()
  return (
    <div className="flex flex-wrap gap-2">
      <Button isDisabled={pending} onPress={() => run(() => seedAction())}>
        W02 안건 불러오기
      </Button>
      <Button isDisabled={pending} variant="outline" data-color="danger" onPress={() => run(() => resetAction())}>
        모두 초기화
      </Button>
      <Button isDisabled={pending} variant="secondary" onPress={() => run(() => samplePurchaseOrdersAction())}>
        두 번째 업무 예시(재고 발주) 만들기
      </Button>
    </div>
  )
}

export function BulkAnswerButtons() {
  const { pending, run } = useRun()
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" isDisabled={pending} onPress={() => run(() => bulkAnswerAction({ fact: 'linked_to_group_300', value: false }))}>
        재무 모의 회신: 300억 사업과 무관
      </Button>
      <Button size="sm" variant="secondary" isDisabled={pending} onPress={() => run(() => bulkAnswerAction({ fact: 'linked_to_group_300', value: true }))}>
        재무 모의 회신: 300억 사업과 연결됨
      </Button>
    </div>
  )
}
