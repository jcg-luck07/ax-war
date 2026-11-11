// 합성데이터(합성데이터/*.csv)를 안건으로 적재한다. 원본 데이터 폴더는 읽지도 쓰지도 않는다.
//   node --import ./scripts/_register.mjs scripts/seed-synthetic.mjs          # 적재 (이미 있는 합성 안건은 건너뜀)
//   node --import ./scripts/_register.mjs scripts/seed-synthetic.mjs --clear  # 합성 안건·접수 대기만 지움 (원본 복사본·사용자가 만든 안건은 그대로)
// 모든 합성 안건은 data_origin '합성', 제목 앞에 [합성] 이 붙고, subject_refs.syn 에 합성 식별자(SYN-…)가 남는다.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as E from '@/lib/engine/engine'
import { getEngine } from '@/lib/app/engine'
import { fmtWon } from '@/lib/app/format'
import { CONTRACT_NOTICE } from '@/lib/modules/w02/contract-notice'
import { EXPANSION_CASE_TYPE } from '@/lib/modules/w02/contract-notice'
import { receiveContractNotice } from '@/lib/modules/w02/intake'
import { submitIntake } from '@/lib/modules/intake/submissions'
import { MASIL_MODEL } from '@/lib/semantic/model'
import { entityRows } from '@/lib/semantic/run'

void CONTRACT_NOTICE
const ACTOR = '[합성] 시스템'
const DIR = new URL('../합성데이터/', import.meta.url)

function readCsv(name) {
  const [head, ...rows] = readFileSync(new URL(name, DIR), 'utf8').split(/\r?\n/).filter((l) => l.trim())
  const cols = head.split('|')
  return rows.map((r) => Object.fromEntries(r.split('|').map((v, i) => [cols[i], v])))
}
const yn = (v) => (v === 'yes' ? true : v === 'no' ? false : null)

const { sql, cfg } = await getEngine()

if (process.argv.includes('--clear')) {
  const ids = (await sql`SELECT id FROM decision_cases WHERE data_origin = '합성'`).map((r) => Number(r.id))
  if (ids.length) {
    await sql`DELETE FROM case_events WHERE case_id IN ${sql(ids)}`
    await sql`DELETE FROM tasks WHERE case_id IN ${sql(ids)}`
    await sql`DELETE FROM approvals WHERE case_id IN ${sql(ids)}`
    await sql`DELETE FROM decision_cases WHERE id IN ${sql(ids)}`
  }
  await sql`DELETE FROM drafts d WHERE NOT EXISTS (SELECT 1 FROM decision_cases c WHERE c.draft_id = d.id)` // 안건이 모두 지워져 껍데기만 남은 기안
  const s = await sql`DELETE FROM submissions WHERE submitted_by LIKE '[합성]%' RETURNING id`
  console.log(`합성 안건 ${ids.length}건, 접수 대기 ${s.length}건을 지웠어요.`)
  await sql.end()
  process.exit(0)
}

const exists = async (syn) => (await sql`SELECT 1 FROM decision_cases WHERE subject_refs->>'syn' = ${syn} LIMIT 1`).length > 0
const campaigns = new Map((await entityRows(sql, MASIL_MODEL, 'campaign')).map((c) => [String(c.campaign_id), c]))
if (campaigns.size === 0) throw new Error('원본 복사본이 DB 에 없어요. 먼저 node scripts/ingest.mjs 를 실행하세요.')
const report = []

// ── 캠페인 확대 기안 ──
for (const r of readCsv('syn_expansion_plans.csv')) {
  if (await exists(r.syn_id)) { report.push([r.syn_id, '건너뜀(이미 있음)']); continue }
  const camp = campaigns.get(r.campaign_id)
  if (!camp) throw new Error(`${r.syn_id}: 캠페인 ${r.campaign_id} 이(가) 원본에 없어요`)
  const amount = Number(r.requested_budget_krw)
  const res = await E.openCase(sql, cfg, {
    caseType: EXPANSION_CASE_TYPE,
    title: `[합성] ${r.syn_id} ${camp.campaign_name} 확대 — 요청 ${fmtWon(amount)}`,
    deadline: r.contract_deadline,
    subjectRefs: { syn: r.syn_id, plan: r.syn_id, campaign: r.campaign_id, influencer: String(camp.influencer_id) },
    payload: {
      facts: { per_plan_amount_krw: amount, draft_total_krw: Number(r.draft_total_krw), creates_cash_outflow: true, linked_to_group_300: yn(r.linked_to_group_300) },
      plan: { plan_id: r.syn_id, campaign_id: r.campaign_id, requested_budget_krw: String(amount), expected_gmv_krw: r.expected_gmv_krw, settlement_date: r.settlement_date || null, contract_deadline: r.contract_deadline },
      synthetic: { scenario: r.scenario, reason: r.reason, sourceLink: r.source_link, appliesAt: r.applies_at },
    },
    dataOrigin: '합성',
    actorName: ACTOR,
  })
  report.push([r.syn_id, res.decision.status === 'decided' ? `승인권자 ${res.decision.authorityLabel}${res.decision.also.length ? ' + ' + res.decision.also.join(',') : ''}` : '확인 필요', r.scenario])
}

// ── 전속계약 갱신 통보 ──
for (const r of readCsv('syn_contract_notices.csv')) {
  if (await exists(r.syn_id)) { report.push([r.syn_id, '건너뜀(이미 있음)']); continue }
  const res = await receiveContractNotice(sql, cfg, {
    influencerId: r.influencer_id, annualFixedFeeKrw: Number(r.annual_fixed_fee_krw), notifyDeadline: r.notify_deadline, currentExpiry: r.current_expiry,
    fixedFeePaymentDate: r.fixed_fee_payment_date || null, note: `[합성] ${r.memo}`, linkedToGroup300: yn(r.linked_to_group_300),
  }, ACTOR)
  await sql`
    UPDATE decision_cases SET data_origin = '합성', title = ${'[합성] ' + r.syn_id + ' '} || title,
      subject_refs = subject_refs || ${sql.json({ syn: r.syn_id })},
      payload = payload || ${sql.json({ synthetic: { scenario: r.scenario, reason: r.reason, sourceLink: r.source_link, appliesAt: r.applies_at } })}
    WHERE id = ${res.caseId}`
  report.push([r.syn_id, res.decision.status === 'decided' ? `승인권자 ${res.decision.authorityLabel}` : '확인 필요', r.scenario])
}

// ── 접수 대기(팀원이 보고했지만 팀장이 아직 접수하지 않음) — 첨부서류는 "[합성]" 표시가 붙은 짧은 텍스트 파일 ──
const have = new Set((await sql`SELECT input->>'memo' AS n FROM submissions WHERE submitted_by LIKE '[합성]%'`).map((x) => x.n))
for (const r of readCsv('syn_submissions.csv')) {
  const values = JSON.parse(r.values_json)
  if (have.has(values.memo)) { report.push([r.syn_id, '건너뜀(이미 있음)']); continue }
  // 합성데이터/첨부문서/<SYN-id>/ 의 예시 문서를 첨부한다. 파일 이름 앞부분으로 종류를 정한다. 폴더가 없으면 표시만 붙은 짧은 텍스트로 대신한다.
  const KIND_BY_PREFIX = [['기안서', 'draft'], ['비용및성과추계서', 'estimate'], ['계약서', 'contract'], ['판단근거자료', 'custom', '판단 근거 자료'], ['상대방_메일', 'custom', '상대방과 오간 메일']]
  const MIME = { md: 'text/markdown', csv: 'text/csv', eml: 'message/rfc822', txt: 'text/plain' }
  const dir = new URL(`첨부문서/${r.syn_id}/`, DIR)
  let files = []
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const hit = KIND_BY_PREFIX.find(([p]) => name.startsWith(p))
      if (hit) files.push({ kind: hit[1], label: hit[2], filename: name, mime: MIME[name.split('.').pop()] ?? 'application/octet-stream', content: readFileSync(new URL(name, dir)) })
    }
  } else {
    files = ['draft', 'estimate'].map((kind) => ({ kind, filename: `${r.syn_id}_${kind}.txt`, mime: 'text/plain', content: Buffer.from(`[합성 데이터] ${r.syn_id} ${kind}
시험용 가상 내용이에요.
`, 'utf8') }))
  }
  await submitIntake(sql, { category: r.category, refId: r.ref_id, values, files, by: r.submitted_by })
  report.push([r.syn_id, '접수 대기', r.scenario])
}

for (const [id, st, sc] of report) console.log(`${id.padEnd(8)} ${st.padEnd(28)} ${sc ?? ''}`)
console.log(`\n합성 ${report.length}건 처리`)
await sql.end()
