// 원본 CSV 를 로컬 DB 로 복사하는 명령줄 도구.
//   node scripts/ingest.mjs            # 기본 목록(Masil 전체)
//   node scripts/ingest.mjs 02_masil/marketing/mkt_orders_ms.csv   # 파일 지정
// DATABASE_URL 은 .env.local 에서 읽는다. 원본 파일은 읽기만 하고 고치지 않는다.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { loadAll } from '../lib/ingest/core.ts'
import { DEFAULT_FILES, SOURCE_DIR_DEFAULT } from '../lib/ingest/manifest.ts'
import { applyCoreSchema } from '../lib/engine/schema.ts'

const root = resolve(import.meta.dirname, '..')

// .env.local 에서 DATABASE_URL 만 읽는다 (새 패키지 없이).
let url = process.env.DATABASE_URL
if (!url && existsSync(resolve(root, '.env.local'))) {
  const m = readFileSync(resolve(root, '.env.local'), 'utf8').match(/^DATABASE_URL=(.+)$/m)
  url = m?.[1]?.trim()
}
if (!url) {
  console.error('DATABASE_URL 이 없어요. .env.local 의 DATABASE_URL 줄 주석을 풀고 `npm run db:up` 으로 DB 를 먼저 켜 주세요.')
  process.exit(1)
}

const baseDir = resolve(root, process.env.SOURCE_DATA_DIR || SOURCE_DIR_DEFAULT)
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES

const sql = postgres(url, { max: 1, onnotice: () => {} })
try {
  await applyCoreSchema(sql) // 테이블이 없으면 만든다 (있으면 그대로)
  const { ok, failed } = await loadAll(sql, baseDir, files)
  for (const r of ok) console.log(`✔ ${r.file}  ${r.rows}행  ${r.sha256.slice(0, 12)}`)
  for (const f of failed) console.error(`✘ ${f.file}  ${f.error}`)
  console.log(`\n완료: 성공 ${ok.length}개 · 실패 ${failed.length}개 · 총 ${ok.reduce((a, b) => a + b.rows, 0)}행`)
  process.exitCode = failed.length ? 1 : 0
} finally {
  await sql.end()
}
