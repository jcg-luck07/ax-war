'use client'

// AI 판단 칸 — Claude 가 한 번 한 판단은 안건마다 저장돼서, 판단 자료가 그대로이면 어느 단계·누가 열어도 같은 내용이 바로 보인다 (API 를 다시 부르지 않는다).
// 판단 자료가 바뀌었으면 이전 판단은 "최신이 아님"으로 표시하고, 버튼을 눌러 새 자료로 다시 물어야 한다. (호출마다 비용이 드므로 화면을 열 때 자동으로 부르지 않는다)
import { useState, useTransition } from 'react'
import { Button } from '@heroui/react'
import { Pill } from '@/components/bits'
import { runAiJudgmentAction } from '@/app/actions'
import type { Judgment } from '@/lib/modules/w02/ai-judgment'
import type { JudgmentInput } from '@/lib/modules/w02/judgment-input'

const TONE: Record<string, 'success' | 'danger' | 'warning'> = { good: 'success', bad: 'danger', caution: 'warning' }

/** 문장 끝(. ! ? 뒤 공백)에서 나눈다 — 소수점(0.45배)은 뒤에 공백이 없어 나뉘지 않는다 */
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean)

interface Shown {
  judgment: Judgment
  model: string
  inputTokens: number
  outputTokens: number
  createdAt: string
  inputHash: string
}

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

export function AiJudgmentPanel({ caseId, input, currentHash, saved }: { caseId: number; input: JudgmentInput; currentHash: string; saved: Shown | null }) {
  const [pending, start] = useTransition()
  // 처음에는 서버에 저장된 판단을 보여 준다 (이 칸은 안건이 바뀌면 부모가 key 로 새로 만든다)
  const [result, setResult] = useState<Shown | null>(saved)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const stale = result !== null && result.inputHash !== currentHash

  const ask = (force: boolean) => {
    setError(null); setNote(null)
    start(async () => {
      const r = await runAiJudgmentAction(caseId, input, force)
      if (r.ok) {
        setResult(r)
        if (r.reused) setNote('판단 자료가 그대로라서 저장된 판단을 보여 드려요.')
      } else setError(r.message)
    })
  }

  const lines = result && result.judgment.status === 'ok' ? result.judgment.lines : []
  return (
    <div className="flex flex-col gap-3 border-2 border-primary p-3" style={{ borderRadius: 2 }}>
      {/* 제목 바로 옆에 버튼 */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="t-small font-semibold">AI 판단</p>
        <Button isDisabled={pending} variant={result && !stale ? 'outline' : undefined} onPress={() => ask(Boolean(result) && !stale)}>
          {pending ? 'Claude 가 판단하는 중… (수십 초 걸려요)' : stale ? '새 자료로 다시 판단 요청' : result ? 'Claude 에게 다시 묻기' : 'Claude 에게 판단 요청'}
        </Button>
        {result && (
          <span className="t-caption">
            {stale ? '이전 판단' : '저장된 판단 · 판단 자료 변화 없음'} · {when(result.createdAt)} · {result.model} · 입력 {result.inputTokens.toLocaleString()} / 출력 {result.outputTokens.toLocaleString()} 토큰
          </span>
        )}
      </div>
      {stale && (
        <p className="t-small border border-warning p-2 text-warning" style={{ borderRadius: 2 }} role="status">
          이 판단을 한 뒤 판단 자료(금액·순위·계약 정보 등)가 바뀌었어요. 아래는 <strong>이전 자료로 한 판단</strong>이라 지금과 맞지 않을 수 있어요. 새 자료로 다시 판단을 요청해 주세요.
        </p>
      )}
      {!result && !error && !pending && <p className="t-small text-muted">아직 판단하지 않았어요. 버튼을 누르면 이 안건의 수익성 자료를 Claude 에게 보내 판단을 받아요. 한 번 받은 판단은 저장돼서, 자료가 바뀌기 전까지는 누가 열어도 같은 내용이 보여요.</p>}
      {note && <p className="t-caption" role="status">{note}</p>}
      {error && <p className="t-small text-danger" role="alert">{error}</p>}
      {lines.map((l, i) => (
        <div key={i} className={`flex flex-col gap-1 border-t border-default pt-3 first:border-t-0 first:pt-0 ${stale ? 'opacity-60' : ''}`}>
          <span className="self-start"><Pill color={TONE[l.tone]}>{l.label}</Pill></span>
          <div className="t-small flex flex-col gap-1">
            {sentences(l.text).map((sn, k) => <p key={k}>{sn}</p>)}
          </div>
        </div>
      ))}
    </div>
  )
}
