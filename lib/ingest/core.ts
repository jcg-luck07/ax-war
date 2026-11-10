// 원본 CSV → DB 복사 (서버 전용, 읽기 전용으로만 파일을 연다).
//
// 규칙 (A05 데이터 이용 기준):
//  - CSV 는 UTF-8, 첫 행 헤더, 구분자는 파이프(|). 쉼표 CSV 로 추정하지 않는다.
//  - 원본 파일은 절대 수정하지 않는다. 여기서는 readFile 만 쓴다.
//  - 행마다 (원본 파일 경로, 행 번호)를 그대로 남겨 원본까지 추적할 수 있게 한다.
//  - 값은 문자열 그대로 담는다. 'NONE'(해당 없음)을 0 이나 빈 값으로 바꾸지 않는다.
//
// 이 파일은 다른 프로젝트 파일을 import 하지 않는다 — `node scripts/ingest.mjs` 로 직접 실행할 수 있게.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sql } from 'postgres'

export type CsvRow = Record<string, string>

export interface ParsedCsv {
  columns: string[]
  rows: CsvRow[]
}

/** 파이프 구분 CSV 해석. 열 수가 어긋난 행이 하나라도 있으면 오류로 멈춘다(조용히 넘기지 않음). */
export function parseCsv(text: string, label = 'csv'): ParsedCsv {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // BOM 제거
  const lines = clean.split(/\r?\n/)
  while (lines.length && lines[lines.length - 1] === '') lines.pop() // 끝의 빈 줄

  if (lines.length === 0) throw new Error(`${label}: 비어 있는 파일이에요`)
  const columns = lines[0].split('|')
  if (columns.length < 2) throw new Error(`${label}: 파이프(|) 구분자가 아니에요 — 헤더: ${lines[0].slice(0, 80)}`)

  const rows: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('|')
    if (cells.length !== columns.length) {
      throw new Error(`${label}: ${i + 1}번째 줄의 열 수가 헤더와 달라요 (헤더 ${columns.length}개, 이 줄 ${cells.length}개)`)
    }
    const row: CsvRow = {}
    columns.forEach((c, k) => (row[c] = cells[k]))
    rows.push(row)
  }
  return { columns, rows }
}

export interface LoadResult {
  file: string
  rows: number
  sha256: string
}

const CHUNK = 1000

/**
 * 파일 하나를 DB 에 복사한다. 같은 파일을 다시 읽으면 그 파일의 기존 행을 지우고 새로 채운다
 * (원본에서 사라진 행이 DB 에 남지 않도록). 트랜잭션이라 중간에 실패하면 이전 상태가 유지된다.
 */
export async function loadSourceFile(sql: Sql, baseDir: string, relPath: string): Promise<LoadResult> {
  const buf = await readFile(join(baseDir, relPath)) // 읽기 전용
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const { columns, rows } = parseCsv(buf.toString('utf8'), relPath)

  await sql.begin(async (tx) => {
    await tx`DELETE FROM source_rows WHERE source_file = ${relPath}`
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK).map((data, k) => ({
        source_file: relPath,
        row_no: i + k + 1,
        data: tx.json(data),
      }))
      await tx`INSERT INTO source_rows ${tx(batch, 'source_file', 'row_no', 'data')}`
    }
    await tx`
      INSERT INTO source_files (source_file, sha256, row_count, columns)
      VALUES (${relPath}, ${sha256}, ${rows.length}, ${tx.json(columns)})
      ON CONFLICT (source_file)
      DO UPDATE SET sha256 = EXCLUDED.sha256, row_count = EXCLUDED.row_count,
                    columns = EXCLUDED.columns, loaded_at = now()
    `
  })
  return { file: relPath, rows: rows.length, sha256 }
}

/** 목록의 파일을 차례로 읽는다. 하나가 실패해도 나머지는 계속하고 결과에 오류를 담는다. */
export async function loadAll(
  sql: Sql,
  baseDir: string,
  files: readonly string[],
): Promise<{ ok: LoadResult[]; failed: { file: string; error: string }[] }> {
  const ok: LoadResult[] = []
  const failed: { file: string; error: string }[] = []
  for (const f of files) {
    try {
      ok.push(await loadSourceFile(sql, baseDir, f))
    } catch (e) {
      failed.push({ file: f, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { ok, failed }
}
