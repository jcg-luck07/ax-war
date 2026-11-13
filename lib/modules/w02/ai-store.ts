// AI 판단 저장 — Claude 가 한 번 판단한 내용을 안건마다 저장해 두고, 판단 자료가 그대로이면 단계(재무팀·승인권자 …)나 사람과 상관없이 그 내용을 그대로 보여 준다.
// 자료가 바뀌었는지는 판단 입력(JudgmentInput)의 해시로 매번 확인한다. 같으면 저장본 재사용, 다르면 다시 물어야 한다 (서버 전용).
import { createHash } from 'node:crypto'
import type { Sql } from 'postgres'
import type { Judgment } from './ai-judgment'
import type { JudgmentInput } from './judgment-input'

export interface SavedJudgment {
  caseId: number
  /** 이 판단을 만들 때의 입력 해시 */
  inputHash: string
  judgment: Judgment
  model: string
  inputTokens: number
  outputTokens: number
  createdAt: string
}

/** 판단 입력의 지문 — 입력 내용(숫자·순위·계약 정보 등)이 같으면 같다. 누가·어느 단계에서 보는지는 들어가지 않는다. */
export const hashJudgmentInput = (input: JudgmentInput): string => createHash('sha256').update(JSON.stringify(input)).digest('hex')

/* eslint-disable @typescript-eslint/no-explicit-any */
const toSaved = (r: any): SavedJudgment => ({
  caseId: Number(r.case_id), inputHash: r.input_hash, judgment: r.judgment as Judgment, model: r.model,
  inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), createdAt: new Date(r.created_at).toISOString(),
})

export async function getSavedJudgment(sql: Sql, caseId: number): Promise<SavedJudgment | null> {
  const [r] = await sql`SELECT * FROM ai_judgments WHERE case_id = ${caseId}`
  return r ? toSaved(r) : null
}

export async function saveJudgment(sql: Sql, s: Omit<SavedJudgment, 'createdAt'>): Promise<SavedJudgment> {
  const [r] = await sql`
    INSERT INTO ai_judgments (case_id, input_hash, judgment, model, input_tokens, output_tokens)
    VALUES (${s.caseId}, ${s.inputHash}, ${sql.json(s.judgment as never)}, ${s.model}, ${s.inputTokens}, ${s.outputTokens})
    ON CONFLICT (case_id) DO UPDATE SET input_hash = EXCLUDED.input_hash, judgment = EXCLUDED.judgment, model = EXCLUDED.model,
      input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens, created_at = now()
    RETURNING *`
  return toSaved(r)
}
