// 기안 — 부서 사이의 결정을 묶는 단위 (서버 전용).
// 기안 하나 안에 안건이 하나 이상 들어 있다. 예: "마케팅팀 캠페인 확대 기안1" 안에 확대 안건 25개, "혜인 연간 전속계약 갱신1" 안에 "혜인 연간 전속계약 갱신" 안건 1개.
// 묶는 일은 앱 안의 분류일 뿐이라 원본 자료(CSV·문서)와 안건 내용은 바꾸지 않는다. 안건(decision_cases.draft_id)에 기안 번호만 붙인다.
import type { Sql } from 'postgres'
import { plainTitle } from '@/lib/app/case-list'

/** 원본 마케팅 기안 파일(mkt_budget_plan_ms.csv)의 확대 안건은 모두 이 기안 하나에 들어간다 */
export const ORIGINAL_PLAN_DRAFT = '마케팅팀 캠페인 확대 기안1'

async function draftByName(sql: Sql, name: string): Promise<number> {
  const found = await sql`SELECT id FROM drafts WHERE name = ${name} LIMIT 1`
  if (found.length) return Number(found[0].id)
  const [r] = await sql`INSERT INTO drafts (name) VALUES (${name}) RETURNING id`
  return Number(r.id)
}

/** 기안이 아직 없는 안건에 기안을 붙인다 (이미 붙은 안건은 그대로). 몇 번 불러도 같은 결과다. */
export async function assignDrafts(sql: Sql): Promise<void> {
  const rows = await sql`SELECT id, title, subject_refs FROM decision_cases WHERE draft_id IS NULL ORDER BY id`
  if (rows.length === 0) return
  for (const r of rows) {
    const refs = (r.subject_refs ?? {}) as Record<string, string>
    let draftId: number
    if ((refs.plan ?? '').startsWith('PLAN-')) {
      draftId = await draftByName(sql, ORIGINAL_PLAN_DRAFT)
    } else {
      // 그 밖의 안건은 안건 이름 + 번호가 기안 이름이 된다 (같은 이름이 또 있으면 2, 3 …)
      const base = plainTitle(String(r.title))
      const same = (await sql`SELECT name FROM drafts WHERE name LIKE ${base + '%'}`).map((x) => String(x.name))
      const used = same.filter((n) => /^\d+$/.test(n.slice(base.length))).map((n) => Number(n.slice(base.length)))
      draftId = await draftByName(sql, `${base}${Math.max(0, ...used) + 1}`)
    }
    await sql`UPDATE decision_cases SET draft_id = ${draftId} WHERE id = ${r.id}`
  }
}
