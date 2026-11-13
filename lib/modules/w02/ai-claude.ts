// 수익성 검증 AI 판단을 Claude API 로 실제 호출한다 (서버에서만 쓴다).
//  · 입력: judgment-input.ts 의 JudgmentInput 을 JSON 으로 그대로 보낸다.
//  · 지시: ai-prompt.ts 의 JUDGMENT_PROMPT (+ 출력 형식 안내)
//  · 출력: JSON 스키마(structured outputs)로 줄 목록을 받아 화면의 JudgmentLine 으로 바꾼다.
// 키는 환경변수 ANTHROPIC_API_KEY (.env.local) 에서 읽는다. 회사 AXRouter 를 쓰면 ANTHROPIC_BASE_URL 도 함께 넣는다.
import Anthropic from '@anthropic-ai/sdk'
import { JUDGMENT_PROMPT } from './ai-prompt'
import type { Judgment, JudgmentLine } from './ai-judgment'
import type { JudgmentInput } from './judgment-input'

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5'

const OUTPUT_GUIDE = `
[출력 방식]
지정된 JSON 형식으로만 답한다. lines 배열에 3~5개 줄을 넣고, 각 줄은 다음과 같다.
- tone: "good"(좋음) / "bad"(나쁨) / "caution"(주의할 점)
- score: good 은 0~100 정수, bad 는 0~-100 정수(음수), caution 은 null
- text: 판단 근거 설명. 위 규칙대로 문장을 짧게 끊어 쓴다.
화면에는 good 은 "좋음 n점", bad 는 "나쁨 -n점", caution 은 "주의할 점"으로 보여 준다.
`.trim()

const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tone: { type: 'string', enum: ['good', 'bad', 'caution'] },
          score: { type: ['integer', 'null'] },
          text: { type: 'string' },
        },
        required: ['tone', 'score', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
} as const

export interface ClaudeJudgmentResult {
  judgment: Judgment
  model: string
  inputTokens: number
  outputTokens: number
}

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
}

const clampInt = (n: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)))

export async function runClaudeJudgment(input: JudgmentInput): Promise<ClaudeJudgmentResult> {
  // 공헌이익을 구할 자료가 없으면 AI 에게 묻지 않는다 (판단하지 않고 보완요청 안내)
  if (input.profitability.missing.length > 0) {
    return { judgment: { status: 'missing', missing: input.profitability.missing }, model: CLAUDE_MODEL, inputTokens: 0, outputTokens: 0 }
  }
  if (!claudeConfigured()) throw new Error('ANTHROPIC_API_KEY 가 설정되지 않았어요. .env.local 에 키를 넣고 개발 서버를 다시 시작해 주세요.')

  const client = new Anthropic()
  try {
    const res = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: `${JUDGMENT_PROMPT}\n\n${OUTPUT_GUIDE}`,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    })
    if (res.stop_reason === 'refusal') throw new Error('Claude 가 이 요청에 답하지 않았어요 (안전 규칙에 따른 거절).')
    if (res.stop_reason === 'max_tokens') throw new Error('답변이 길어서 중간에 끊겼어요. 다시 시도해 주세요.')
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    let parsed: { lines?: { tone?: string; score?: number | null; text?: string }[] }
    try { parsed = JSON.parse(text) } catch { throw new Error('Claude 의 답을 읽지 못했어요. 다시 시도해 주세요.') }
    const lines: JudgmentLine[] = (parsed.lines ?? [])
      .filter((l) => l.text && (l.tone === 'good' || l.tone === 'bad' || l.tone === 'caution'))
      .slice(0, 5)
      .map((l) => {
        if (l.tone === 'good') return { tone: 'good', label: `좋음 ${clampInt(l.score, 0, 100)}점`, text: String(l.text) }
        if (l.tone === 'bad') return { tone: 'bad', label: `나쁨 -${Math.abs(clampInt(l.score, -100, 100))}점`, text: String(l.text) }
        return { tone: 'caution', label: '주의할 점', text: String(l.text) }
      })
    if (lines.length === 0) throw new Error('Claude 가 판단 줄을 돌려주지 않았어요. 다시 시도해 주세요.')
    return { judgment: { status: 'ok', lines }, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API 키가 올바르지 않아요. .env.local 의 ANTHROPIC_API_KEY 를 확인해 주세요.')
    if (e instanceof Anthropic.RateLimitError) throw new Error('요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.')
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API 오류 (${e.status}): ${e.message}`)
    throw e
  }
}
