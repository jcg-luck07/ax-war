'use client'

// AI 판단 칸 — "Claude 에게 판단 요청" 버튼을 누르면 Claude API 에 실제로 물어 그 답을 보여 준다.
// (호출마다 비용이 드므로 화면을 열 때는 부르지 않는다)
import { useState, useTransition } from 'react'
import { Button } from '@heroui/react'
import { Pill } from '@/components/bits'
import { runAiJudgmentAction, type AiJudgmentActionResult } from '@/app/actions'
import type { JudgmentInput } from '@/lib/modules/w02/judgment-input'

const TONE: Record<string, 'success' | 'danger' | 'warning'> = { good: 'success', bad: 'danger', caution: 'warning' }

/** 문장 끝(. ! ? 뒤 공백)에서 나눈다 — 소수점(0.45배)은 뒤에 공백이 없어 나뉘지 않는다 */
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean)

export function AiJudgmentPanel({ input }: { input: JudgmentInput }) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<Extract<AiJudgmentActionResult, { ok: true }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ask = () => {
    setError(null)
    start(async () => {
      const r = await runAiJudgmentAction(input)
      if (r.ok) setResult(r)
      else setError(r.message)
    })
  }

  const lines = result && result.judgment.status === 'ok' ? result.judgment.lines : []
  return (
    <div className="flex flex-col gap-3 border-2 border-primary p-3" style={{ borderRadius: 2 }}>
      {/* 제목 바로 옆에 버튼 */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="t-small font-semibold">AI 판단</p>
        <Button isDisabled={pending} onPress={ask}>
          {pending ? 'Claude 가 판단하는 중… (수십 초 걸려요)' : result ? 'Claude 에게 다시 묻기' : 'Claude 에게 판단 요청'}
        </Button>
        {result && <span className="t-caption">{result.model} · 입력 {result.inputTokens.toLocaleString()} / 출력 {result.outputTokens.toLocaleString()} 토큰</span>}
      </div>
      {!result && !error && !pending && <p className="t-small text-muted">아직 판단하지 않았어요. 버튼을 누르면 이 안건의 수익성 자료를 Claude 에게 보내 판단을 받아요.</p>}
      {error && <p className="t-small text-danger" role="alert">{error}</p>}
      {lines.map((l, i) => (
        <div key={i} className="flex flex-col gap-1 border-t border-default pt-3 first:border-t-0 first:pt-0">
          <span className="self-start"><Pill color={TONE[l.tone]}>{l.label}</Pill></span>
          <div className="t-small flex flex-col gap-1">
            {sentences(l.text).map((sn, k) => <p key={k}>{sn}</p>)}
          </div>
        </div>
      ))}
    </div>
  )
}
