// AI 판단의 결과 모양 — Claude API 의 답(ai-claude.ts)을 화면(AiJudgmentPanel)에 보여 줄 때 쓴다.
export interface JudgmentLine {
  tone: 'good' | 'bad' | 'caution'
  /** "좋음 82점" / "나쁨 -41점" / "주의할 점" */
  label: string
  text: string
}

export type Judgment =
  | { status: 'ok'; lines: JudgmentLine[] }
  | { status: 'missing'; missing: string[] }
