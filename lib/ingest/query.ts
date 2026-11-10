// DB 에 복사해 둔 원본 행을 꺼내는 함수 (서버 전용).
// 값은 원본 그대로 문자열이다. 숫자·날짜 변환은 쓰는 쪽(지표·규칙 모듈)에서 한다.
import { db, ensureSchema } from '@/lib/db'
import type { CsvRow } from '@/lib/ingest/core'

/** 파일 하나의 모든 행을 원본 행 순서대로. file 은 manifest 의 상대 경로. */
export async function getSourceRows(file: string): Promise<CsvRow[]> {
  await ensureSchema()
  const rows = await db()<{ data: CsvRow }[]>`
    SELECT data FROM source_rows WHERE source_file = ${file} ORDER BY row_no
  `
  return rows.map((r) => r.data)
}

/** 파일이 아직 DB 에 복사되지 않았는지 확인할 때. */
export async function isSourceLoaded(file: string): Promise<boolean> {
  await ensureSchema()
  const r = await db()<{ n: number }[]>`SELECT count(*)::int AS n FROM source_files WHERE source_file = ${file}`
  return r[0].n > 0
}

/** 숫자 칸 읽기. 'NONE' 이나 빈 값은 null — 0 으로 바꾸지 않는다(0 과 구분). */
export function toNum(v: string | undefined): number | null {
  if (v === undefined || v === '' || v === 'NONE') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
