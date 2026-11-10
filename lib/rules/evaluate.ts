// 승인권한 판정 엔진 (업무를 모른다 — 규칙 데이터와 사실만 받는다).
//
// 판정 순서
//  1) 안건 유형에 해당하는 규칙만 고른다.
//  2) 각 규칙의 조건을 참/거짓/모름으로 평가한다 (모르는 사실을 거짓으로 취급하지 않는다).
//  3) 참인 규칙 중 가장 높은 권한(rank)을 승인권자로 한다. 공통(common) 규칙은 평시 전결 규정을 "올리기만" 한다.
//  4) 모름인 규칙 중, 참이 되면 지금보다 높은 권한이 필요해지는 것이 있으면 → need_info (확정하지 않고 확인 요청).
//     지금 권한이 이미 그 규칙의 권한 이상이면 모르는 값은 결과를 바꾸지 못하므로 묻지 않는다.
import type {
  AuthorityDecision,
  Condition,
  Facts,
  MatchedRule,
  Role,
  Rule,
  Tri,
  UnresolvedRule,
} from './types'

function isKnown(v: unknown): v is string | number | boolean {
  return v !== null && v !== undefined
}

function compare(actual: string | number | boolean, op: Condition['op'], expected: string | number | boolean): boolean {
  switch (op) {
    case 'eq':
      return actual === expected
    case 'neq':
      return actual !== expected
    case 'gt':
      return Number(actual) > Number(expected)
    case 'gte':
      return Number(actual) >= Number(expected)
    case 'lt':
      return Number(actual) < Number(expected)
    case 'lte':
      return Number(actual) <= Number(expected)
  }
}

function evalCondition(c: Condition, facts: Facts): Tri {
  const v = facts[c.fact]
  if (!isKnown(v)) return 'unknown'
  return compare(v, c.op, c.value)
}

/** all: 거짓이 하나라도 있으면 거짓 / 모두 참이면 참 / 그 외 모름. any 는 반대. */
export function evalRule(rule: Rule, facts: Facts): { result: Tri; missing: string[] } {
  const missing: string[] = []
  const results: Tri[] = []

  const allList = rule.all ?? []
  const anyList = rule.any ?? []
  const allRes = allList.map((c) => evalCondition(c, facts))
  const anyRes = anyList.map((c) => evalCondition(c, facts))
  allList.forEach((c, i) => allRes[i] === 'unknown' && missing.push(c.fact))
  anyList.forEach((c, i) => anyRes[i] === 'unknown' && missing.push(c.fact))

  let allTri: Tri = true
  if (allRes.includes(false)) allTri = false
  else if (allRes.includes('unknown')) allTri = 'unknown'

  let anyTri: Tri = true
  if (anyList.length > 0) {
    if (anyRes.includes(true)) anyTri = true
    else if (anyRes.includes('unknown')) anyTri = 'unknown'
    else anyTri = false
  }

  results.push(allTri, anyTri)
  let result: Tri = true
  if (results.includes(false)) result = false
  else if (results.includes('unknown')) result = 'unknown'
  // 거짓이 확정이면 모르는 값은 결과에 영향이 없으므로 묻지 않는다
  return { result, missing: result === 'unknown' ? [...new Set(missing)] : [] }
}

export function decideAuthority(
  caseType: string,
  facts: Facts,
  rules: readonly Rule[],
  roles: readonly Role[],
): AuthorityDecision {
  const roleOf = (id: string): Role => {
    const r = roles.find((x) => x.id === id)
    if (!r) throw new Error(`알 수 없는 승인권자 id: ${id}`)
    return r
  }

  const applicable = rules.filter((r) => r.appliesTo.includes('*') || r.appliesTo.includes(caseType))

  // 공통 규칙은 권한을 "올리기만" 해서 기본 권한을 정하지 못한다.
  // 이 안건 유형을 직접 다루는 업무 규칙이 하나도 없으면 임의로 정하지 않고 규칙 없음으로 멈춘다.
  if (!applicable.some((r) => r.layer === 'business')) {
    return {
      status: 'no_rule',
      authority: null,
      authorityLabel: null,
      also: [],
      matched: [],
      unresolved: [],
      trace: [`"${caseType}" 를 직접 다루는 업무 규칙이 없어요. 규칙집에 추가하거나 사람이 직접 지정해야 해요.`],
    }
  }
  const matched: MatchedRule[] = []
  const unknownRules: UnresolvedRule[] = []
  const trace: string[] = []
  const also = new Set<string>()

  for (const rule of applicable) {
    const { result, missing } = evalRule(rule, facts)
    if (result === true) {
      matched.push({
        ruleId: rule.id,
        title: rule.title,
        authority: rule.outcome.authority,
        layer: rule.layer,
        origin: rule.origin,
        source: rule.source,
      })
      rule.outcome.also?.forEach((a) => also.add(a))
      trace.push(`규칙 적용: ${rule.title} → ${roleOf(rule.outcome.authority).label} (근거: ${rule.source.file})`)
    } else if (result === 'unknown') {
      unknownRules.push({
        ruleId: rule.id,
        title: rule.title,
        missingFacts: missing,
        wouldRequire: rule.outcome.authority,
      })
    }
  }

  // 가장 높은 권한. 같은 rank 면 먼저 등록된 규칙을 따른다.
  let best: MatchedRule | null = null
  for (const m of matched) {
    if (!best || roleOf(m.authority).rank > roleOf(best.authority).rank) best = m
  }
  const currentRank = best ? roleOf(best.authority).rank : 0

  // 모르는 사실이 결과를 바꿀 수 있는 경우만 미해결로 남긴다.
  const unresolved = unknownRules.filter((u) => roleOf(u.wouldRequire).rank > currentRank)
  for (const u of unresolved) {
    trace.push(
      `확인 필요: "${u.title}" 규칙을 판단하려면 [${u.missingFacts.join(', ')}] 값이 필요해요 ` +
        `(참이면 ${roleOf(u.wouldRequire).label} 승인이 필요해져요)`,
    )
  }

  if (unresolved.length > 0) {
    return {
      status: 'need_info',
      authority: best ? best.authority : null,
      authorityLabel: best ? roleOf(best.authority).label : null,
      also: [...also],
      matched,
      unresolved,
      trace: [...trace, '→ 모르는 사실을 확인하기 전에는 승인권자를 확정하지 않아요.'],
    }
  }
  if (!best) {
    return {
      status: 'no_rule',
      authority: null,
      authorityLabel: null,
      also: [],
      matched,
      unresolved: [],
      trace: [...trace, `→ "${caseType}" 에 적용되는 규칙이 없어요. 규칙집에 추가하거나 사람이 직접 지정해야 해요.`],
    }
  }
  return {
    status: 'decided',
    authority: best.authority,
    authorityLabel: roleOf(best.authority).label,
    also: [...also],
    matched,
    unresolved: [],
    trace: [...trace, `→ 승인권자: ${roleOf(best.authority).label}`],
  }
}
