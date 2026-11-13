// 합성 안건을 기안서 단위로 묶는다 — 합성 안건 하나하나가 기안서 하나씩 되지 않도록, 성격이 비슷한 안건을 한 기안서에 모은다.
// 수익성 검증의 비교(같은 기안서에 들어 있는 안건끼리)도 이 묶음을 기준으로 한다.
// 한 기안서 안에서 같은 캠페인·같은 인플루언서가 두 번 나오지 않게 짰다.
export const SYN_DRAFTS = {
  '[합성] 캠페인 확대 기안1 — 하회 구간 경계': ['SYN-E01', 'SYN-E02', 'SYN-E03', 'SYN-E04', 'SYN-E05', 'SYN-E06'],
  '[합성] 캠페인 확대 기안2 — 금액·300억 연결': ['SYN-E07', 'SYN-E08', 'SYN-E09', 'SYN-E10', 'SYN-E11', 'SYN-E12'],
  '[합성] 캠페인 확대 기안3 — 일정·성과 사례': ['SYN-E13', 'SYN-E14', 'SYN-E15', 'SYN-E16', 'SYN-E17', 'SYN-E18'],
  '[합성] 전속계약 갱신 기안1 — 금액·권한 경계': ['SYN-C01', 'SYN-C02', 'SYN-C03', 'SYN-C04', 'SYN-C05'],
  '[합성] 전속계약 갱신 기안2 — 기한·확인 필요': ['SYN-C06', 'SYN-C07', 'SYN-C08', 'SYN-C09', 'SYN-C10'],
}

/** DB 의 합성 안건을 위 묶음대로 기안서에 넣고, 안건이 없어진 기안서는 지운다 (몇 번 불러도 같은 결과) */
export async function applySynDrafts(sql) {
  for (const [name, ids] of Object.entries(SYN_DRAFTS)) {
    let d = (await sql`SELECT id FROM drafts WHERE name = ${name} LIMIT 1`)[0]
    if (!d) d = (await sql`INSERT INTO drafts (name) VALUES (${name}) RETURNING id`)[0]
    await sql`UPDATE decision_cases SET draft_id = ${d.id} WHERE subject_refs->>'syn' IN ${sql(ids)}`
  }
  await sql`DELETE FROM drafts d WHERE NOT EXISTS (SELECT 1 FROM decision_cases c WHERE c.draft_id = d.id)`
}

/** 같은 일을 하는 SQL 문장 (이미 올라가 있는 배포 DB 에 SELECT·INSERT·UPDATE·DELETE 만으로 실행하려고) */
export function synDraftsSql() {
  const q = (t) => `'${t.replace(/'/g, "''")}'`
  const out = []
  for (const [name, ids] of Object.entries(SYN_DRAFTS)) {
    out.push(`INSERT INTO drafts (name) SELECT ${q(name)} WHERE NOT EXISTS (SELECT 1 FROM drafts WHERE name = ${q(name)});`)
    out.push(`UPDATE decision_cases SET draft_id = (SELECT id FROM drafts WHERE name = ${q(name)} LIMIT 1) WHERE subject_refs->>'syn' IN (${ids.map(q).join(', ')});`)
  }
  out.push('DELETE FROM drafts d WHERE NOT EXISTS (SELECT 1 FROM decision_cases c WHERE c.draft_id = d.id);')
  return out.join('\n') + '\n'
}
