// 시맨틱 질의 → SQL 번역기 (순수 함수, DB를 모른다). 원본 CSV 복사본(source_rows)을 엔티티별 CTE 로 열어 쓴다.
//
// 핵심 아이디어
//  - 측정값마다 "기준 엔티티"가 있고, 그 행에서 many-to-one 관계를 따라 차원 엔티티까지 JOIN 한다.
//  - 기준 엔티티가 다른 측정값은 따로 집계한 뒤 차원 키로 합친다 → 집계 단위가 달라도 행이 부풀지 않는다(fan-out 방지).
//  - 식에 쓰는 값은 모두 바인딩 파라미터($n)로 넘기고, 식과 모델은 개발자가 선언한 것만 쓴다.
import type { Dimension, Entity, Measure, Metric, SemanticModel, SemanticQuery, TimeDimension } from './types'

export interface Compiled {
  text: string
  values: (string | number)[]
  /** 결과 열 이름 */
  columns: { key: string; attrs: string[]; select: string[] }
}

class SemanticError extends Error {}
export { SemanticError }

const q = (id: string) => `"${id.replace(/"/g, '')}"` // 식별자 인용 (선언된 id 만 들어옴)
const alias = (entityId: string) => q(`e_${entityId}`)

/** 엔티티 하나를 CTE 본문으로 푼다 (원본 행 → 타입이 있는 열) */
function entityCte(e: Entity, model: SemanticModel, values: (string | number)[]): string {
  if (e.kind === 'aggregate') {
    const from = model.entities[e.from]
    if (!from) throw new SemanticError(`집계 엔티티 ${e.id}: 원천 ${e.from} 가 없어요`)
    const cols = [
      ...e.groupBy.map((c) => `${q(c)}`),
      ...Object.entries(e.columns).map(([name, c]) => `(${c.sql}) AS ${q(name)}`),
    ]
    return `SELECT ${cols.join(', ')} FROM ${alias(e.from)} GROUP BY ${e.groupBy.map(q).join(', ')}`
  }
  values.push(e.source)
  const ph = `$${values.length}`
  const cols = Object.entries(e.columns).map(([name, c]) => {
    const raw = `data->>'${name.replace(/'/g, '')}'`
    switch (c.type) {
      case 'number':
        return `nullif(nullif(${raw},'NONE'),'')::numeric AS ${q(name)}`
      case 'date':
        return `nullif(nullif(${raw},'NONE'),'')::date AS ${q(name)}`
      case 'boolean':
        return `(${raw}) = 'True' AS ${q(name)}`
      default:
        return `(${raw}) AS ${q(name)}`
    }
  })
  return `SELECT ${cols.join(', ')} FROM source_rows WHERE source_file = ${ph}`
}

/** 식 안의 `엔티티.열` 을 CTE 별칭으로 바꾸고, 쓰인 엔티티를 모은다. `:이름` 은 바인딩 파라미터로. */
function resolveExpr(
  expr: string, model: SemanticModel, used: Set<string>, params: Record<string, number>, values: (string | number)[], paramSlots: Map<string, string>,
): string {
  let out = expr.replace(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g, (m, ent: string, col: string) => {
    const e = model.entities[ent]
    if (!e) return m
    const cols = e.kind === 'source' ? e.columns : { ...Object.fromEntries(e.groupBy.map((g) => [g, 1])), ...e.columns }
    if (!(col in cols)) throw new SemanticError(`식 "${expr}": ${ent} 엔티티에 ${col} 열이 없어요`)
    used.add(ent)
    return `${alias(ent)}.${q(col)}`
  })
  out = out.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, name: string) => {
    const p = model.parameters[name]
    if (!p) throw new SemanticError(`식 "${expr}": 모르는 파라미터 :${name}`)
    let slot = paramSlots.get(name)
    if (!slot) {
      values.push(params[name] ?? p.default)
      slot = `$${values.length}::numeric`
      paramSlots.set(name, slot)
    }
    return slot
  })
  return out
}

/** 기준 엔티티에서 many-to-one 관계로 닿는 엔티티까지의 JOIN 경로 (BFS). needed 에 있는 엔티티마다 경로를 모은다. */
function joinPlan(model: SemanticModel, base: string, needed: Set<string>): { from: string; to: string; on: string }[] {
  const parent = new Map<string, { from: string; rel: { to: string; on: Record<string, string> } }>()
  const seen = new Set([base])
  const queue = [base]
  while (queue.length) {
    const cur = queue.shift()!
    for (const rel of Object.values(model.entities[cur].relations ?? {})) {
      if (seen.has(rel.to)) continue
      seen.add(rel.to)
      parent.set(rel.to, { from: cur, rel })
      queue.push(rel.to)
    }
  }
  const edges = new Map<string, { from: string; to: string; on: string }>()
  for (const target of needed) {
    if (target === base) continue
    if (!seen.has(target)) throw new SemanticError(`${base} 에서 ${target} 로 이어지는 관계가 없어요`)
    let t = target
    while (t !== base) {
      const p = parent.get(t)!
      if (!edges.has(t)) {
        const on = Object.entries(p.rel.on).map(([l, r]) => `${alias(p.from)}.${q(l)} = ${alias(t)}.${q(r)}`).join(' AND ')
        edges.set(t, { from: p.from, to: t, on })
      }
      t = p.from
    }
  }
  // 부모가 먼저 오도록 정렬
  const ordered: { from: string; to: string; on: string }[] = []
  const done = new Set([base])
  let progressed = true
  while (ordered.length < edges.size && progressed) {
    progressed = false
    for (const e of edges.values()) {
      if (!done.has(e.to) && done.has(e.from)) {
        ordered.push(e)
        done.add(e.to)
        progressed = true
      }
    }
  }
  return ordered
}

/** 지표 식 안의 id 를 열 이름으로 바꾼다 (측정값은 coalesce 로 감싸 비어 있으면 0). 지표는 재귀로 펼친다. */
function expandMetric(id: string, model: SemanticModel, seen: string[] = []): string {
  if (seen.includes(id)) throw new SemanticError(`지표 순환 참조: ${[...seen, id].join(' → ')}`)
  const m = model.metrics[id]
  return m.expr.replace(/\b[a-z_][a-z0-9_]*\b/g, (tok) => {
    if (model.measures[tok]) return `coalesce(${q('m_' + tok)},0)`
    if (model.metrics[tok]) return `(${expandMetric(tok, model, [...seen, id])})`
    return tok // SQL 함수·키워드(nullif 등)
  })
}

function collectMeasures(id: string, model: SemanticModel, out: Set<string>, seen: string[] = []) {
  if (seen.includes(id)) throw new SemanticError(`지표 순환 참조: ${[...seen, id].join(' → ')}`)
  if (model.measures[id]) return void out.add(id)
  const m: Metric | undefined = model.metrics[id]
  if (!m) throw new SemanticError(`모르는 측정값/지표: ${id}`)
  for (const tok of m.expr.match(/\b[a-z_][a-z0-9_]*\b/g) ?? []) {
    if (model.measures[tok] || model.metrics[tok]) collectMeasures(tok, model, out, [...seen, id])
  }
}

export function compileQuery(model: SemanticModel, query: SemanticQuery): Compiled {
  const values: (string | number)[] = []
  const paramSlots = new Map<string, string>()
  const params = query.params ?? {}

  const needMeasures = new Set<string>()
  for (const s of query.select) collectMeasures(s, model, needMeasures)
  if (needMeasures.size === 0) throw new SemanticError('고른 측정값이 없어요')

  const dim: Dimension | undefined = query.by ? model.dimensions[query.by] : undefined
  const tdim: TimeDimension | undefined = query.by ? model.timeDimensions[query.by] : undefined
  if (query.by && !dim && !tdim) throw new SemanticError(`모르는 차원: ${query.by}`)

  // 기준 엔티티별로 측정값 묶기
  const groups = new Map<string, Measure[]>()
  for (const id of needMeasures) {
    const m = model.measures[id]
    groups.set(m.entity, [...(groups.get(m.entity) ?? []), m])
  }

  const usedEntities = new Set<string>() // CTE 로 열어야 하는 엔티티
  const selects: string[] = []
  const keyCol = 'k'
  const attrNames = dim ? dim.attrs : []

  let gi = 0
  for (const [baseId, ms] of groups) {
    const base = model.entities[baseId]
    if (!base) throw new SemanticError(`측정값의 기준 엔티티 ${baseId} 가 없어요`)
    const used = new Set<string>([baseId])
    const aggs: string[] = []
    for (const m of ms) {
      const e = m.expr ? resolveExpr(m.expr, model, used, params, values, paramSlots) : '*'
      const w = m.where ? resolveExpr(m.where, model, used, params, values, paramSlots) : null
      const core = m.agg === 'count' ? (w ? `count(*) FILTER (WHERE ${w})` : 'count(*)') : `sum(${e}) ${w ? `FILTER (WHERE ${w})` : ''}`
      aggs.push(`${core}::float8 AS ${q('m_' + m.id)}`)
    }
    let keyExpr = 'NULL::text'
    let attrExprs: string[] = []
    const groupBy: string[] = []
    if (dim) {
      used.add(dim.entity)
      keyExpr = `${alias(dim.entity)}.${q(dim.key)}::text`
      attrExprs = dim.attrs.map((a) => `${alias(dim.entity)}.${q(a)}::text AS ${q('a_' + a)}`)
      groupBy.push(keyExpr, ...dim.attrs.map((a) => `${alias(dim.entity)}.${q(a)}::text`))
    } else if (tdim) {
      const col = tdim.columns[baseId]
      if (!col) throw new SemanticError(`시간 차원 ${tdim.id} 에 ${baseId} 의 날짜 열이 지정되지 않았어요`)
      keyExpr = `to_char(${alias(baseId)}.${q(col)}, 'YYYY-MM-DD')`
      groupBy.push(keyExpr)
    }
    const plan = joinPlan(model, baseId, used)
    for (const e of plan) used.add(e.to)
    used.forEach((u) => usedEntities.add(u))
    const joins = plan.map((e) => `LEFT JOIN ${alias(e.to)} ON ${e.on}`).join(' ')
    const sel = [`${keyExpr} AS ${keyCol}`, ...attrExprs, ...aggs]
    const where = dim || tdim ? `WHERE ${keyExpr} IS NOT NULL` : ''
    selects.push(
      `g${gi} AS (SELECT ${sel.join(', ')} FROM ${alias(baseId)} ${joins} ${where} ${groupBy.length ? 'GROUP BY ' + groupBy.join(', ') : ''})`,
    )
    gi++
  }

  // 정의된 엔티티 CTE (집계 엔티티가 쓰는 원천까지 포함해 의존 순서대로)
  const cteOrder: string[] = []
  const add = (id: string) => {
    if (cteOrder.includes(id)) return
    const e = model.entities[id]
    if (!e) throw new SemanticError(`모르는 엔티티: ${id}`)
    if (e.kind === 'aggregate') add(e.from)
    cteOrder.push(id)
  }
  usedEntities.forEach(add)
  const ctes = cteOrder.map((id) => `${alias(id)} AS (${entityCte(model.entities[id], model, values)})`)

  // 그룹 합치기
  const names = selects.map((_, i) => `g${i}`)
  let from = names[0]
  const keyCoalesce = names.length > 1 ? `coalesce(${names.map((n) => `${n}.k`).join(', ')})` : `${names[0]}.k`
  for (let i = 1; i < names.length; i++) {
    // 앞선 그룹들 중 키가 있는 쪽과 맞춘다 (한쪽에만 있는 키도 살린다)
    // (Postgres 의 FULL JOIN 은 IS NOT DISTINCT FROM 을 못 쓰므로, 키가 없는 전체 한 줄 집계는 표시값으로 맞춘다)
    const prev = names.slice(0, i).map((n) => `${n}.k`).join(', ')
    from += ` FULL JOIN ${names[i]} ON coalesce(${prev}, '__all__') = coalesce(${names[i]}.k, '__all__')`
  }
  const attrSel = attrNames.map((a) => `coalesce(${names.map((n) => `${n}.${q('a_' + a)}`).join(', ')}) AS ${q('a_' + a)}`)
  const measureSel = [...needMeasures].map((id) => {
    const owner = names[[...groups.keys()].indexOf(model.measures[id].entity)]
    return `${owner}.${q('m_' + id)} AS ${q('m_' + id)}`
  })
  const inner = `SELECT ${keyCoalesce} AS k${attrSel.length ? ', ' + attrSel.join(', ') : ''}, ${measureSel.join(', ')} FROM ${from}`
  const outerSel = [
    'k',
    ...attrNames.map((a) => q('a_' + a)),
    ...query.select.map((s) => (model.measures[s] ? `${q('m_' + s)} AS ${q(s)}` : `(${expandMetric(s, model)})::float8 AS ${q(s)}`)),
  ]
  const text = `WITH ${[...ctes, ...selects].join(', ')} SELECT ${outerSel.join(', ')} FROM (${inner}) x${query.by ? ' ORDER BY k' : ''}`
  return { text, values, columns: { key: keyCol, attrs: attrNames, select: query.select } }
}

/** 엔티티의 행을 타입이 있는 열로 그대로 꺼내는 SQL */
export function compileEntityRows(model: SemanticModel, entityId: string): Compiled {
  const values: (string | number)[] = []
  const cteIds: string[] = []
  const add = (id: string) => {
    const e = model.entities[id]
    if (!e) throw new SemanticError(`모르는 엔티티: ${id}`)
    if (e.kind === 'aggregate') add(e.from)
    if (!cteIds.includes(id)) cteIds.push(id)
  }
  add(entityId)
  const ctes = cteIds.map((id) => `${alias(id)} AS (${entityCte(model.entities[id], model, values)})`)
  const e = model.entities[entityId]
  const cols = e.kind === 'source' ? Object.entries(e.columns).map(([n, c]) => [n, c.type] as const) : [...e.groupBy.map((g) => [g, 'text'] as const), ...Object.entries(e.columns).map(([n, c]) => [n, c.type] as const)]
  const sel = cols.map(([n, t]) => (t === 'date' ? `to_char(${q(n)}, 'YYYY-MM-DD') AS ${q(n)}` : t === 'number' ? `${q(n)}::float8 AS ${q(n)}` : q(n)))
  return { text: `WITH ${ctes.join(', ')} SELECT ${sel.join(', ')} FROM ${alias(entityId)}`, values, columns: { key: '', attrs: [], select: cols.map(([n]) => n) } }
}
