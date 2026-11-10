// 안건 요약 — 규칙 판정과 지표 계산 결과를 그대로 문장으로 옮긴다. AI 를 쓰지 않는다.
// 새 숫자를 만들거나 새 대안을 지어내지 않고, 입력(BriefInput)에 담긴 값만 정리한다. 다른 파일을 import 하지 않는다.

export interface BriefInput {
  caseTitle: string
  caseType: string
  deadline: { date: string | null; daysLeft: number | null }
  /** 규칙집의 판정 결과(코드가 계산) */
  decision: {
    status: 'decided' | 'need_info' | 'no_rule'
    authorityLabel: string | null
    also: string[]
    trace: string[]
    unresolved: { title: string; missingFacts: string[] }[]
  }
  /** 근거 지표(코드가 계산, 읽기 좋게 서식만 입힌 값) */
  evidence: { label: string; value: string; note?: string }[]
  /** 업무 모듈이 문서·규칙에서 뽑은 대안 후보 */
  alternatives: string[]
  /** 지켜야 할 주의사항(표본 한계, 가정, 빠진 비용 등) */
  caveats: string[]
}

export interface Brief {
  summary: string
  reasons: string[]
  alternatives: string[]
  caveats: string[]
}

export function makeBrief(input: BriefInput): Brief {
  const d = input.decision
  const deadline =
    input.deadline.date && input.deadline.daysLeft !== null ? ` 마감은 ${input.deadline.date}(${input.deadline.daysLeft}일 남음)입니다.` : ''
  const summary =
    d.status === 'decided'
      ? `${input.caseTitle}: ${d.authorityLabel} 승인이 필요합니다.${d.also.length ? ` (${d.also.join(', ')} 필요)` : ''}${deadline}`
      : d.status === 'need_info'
        ? `${input.caseTitle}: 모르는 사실이 있어 승인권자를 아직 확정할 수 없습니다.${deadline}`
        : `${input.caseTitle}: 적용되는 규칙이 없어 사람이 직접 지정해야 합니다.`
  return {
    summary,
    reasons: [...d.trace, ...input.evidence.map((e) => `${e.label}: ${e.value}${e.note ? ` (${e.note})` : ''}`)],
    alternatives: input.alternatives,
    caveats: input.caveats,
  }
}
