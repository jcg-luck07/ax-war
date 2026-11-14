// 시연용 첨부서류 — 안건 접수 화면에서 내려받아 그대로 첨부 칸에 올려 쓰는 가상(합성) 서류 묶음.
//  · 정상: 값이 다 채워진 확대 안건 (T26 확대 토모카 캠페인3)
//  · 예외: 추계서에 값이 빠진 신규 안건 (M04 값누락 추계서 신규 보미 캠페인4)
// 원본(합성데이터/)에서 복사한 파일을 저장소 data/demo 에 두고, 서버가 켜질 때 DB(demo_files)에 올려 둔다. 내려받기는 DB 에서 ZIP 으로 묶어 준다.
// 이 파일은 서버 전용 모듈을 import 하지 않는다 (시험에서 그대로 불러 쓴다).
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Sql } from 'postgres'
import { DEMO_SETS, type DemoKind } from './demo-sets'

export { DEMO_SETS, isDemoKind, type DemoKind } from './demo-sets'

/** 저장소의 data/demo 폴더 (실행 위치 기준). 없으면 null */
function demoDir(): string | null {
  const d = resolve(process.cwd(), process.env.DEMO_DATA_DIR || 'data/demo')
  return existsSync(d) ? d : null
}

/** data/demo 의 파일을 DB 에 올린다. 이미 같은 내용이면 건드리지 않는다. 올린 파일 수를 돌려준다. */
export async function loadDemoFiles(sql: Sql): Promise<number> {
  const base = demoDir()
  if (!base) return 0
  let n = 0
  for (const kind of Object.keys(DEMO_SETS) as DemoKind[]) {
    const dir = join(base, kind)
    if (!existsSync(dir)) continue
    for (const filename of (await readdir(dir)).sort()) {
      const content = await readFile(join(dir, filename))
      const sha256 = createHash('sha256').update(content).digest('hex')
      const have = await sql<{ sha256: string }[]>`SELECT sha256 FROM demo_files WHERE kind = ${kind} AND filename = ${filename}`
      if (have[0]?.sha256 === sha256) continue
      await sql`
        INSERT INTO demo_files (kind, filename, sha256, content) VALUES (${kind}, ${filename}, ${sha256}, ${content})
        ON CONFLICT (kind, filename) DO UPDATE SET sha256 = EXCLUDED.sha256, content = EXCLUDED.content, loaded_at = now()
      `
      n++
    }
  }
  return n
}

export async function getDemoFiles(sql: Sql, kind: DemoKind): Promise<{ filename: string; content: Buffer }[]> {
  const rows = await sql<{ filename: string; content: Buffer }[]>`SELECT filename, content FROM demo_files WHERE kind = ${kind} ORDER BY filename`
  return rows.map((r) => ({ filename: r.filename, content: Buffer.from(r.content) }))
}

// ───────── ZIP 묶기 (압축 없이 담기 — docx·xlsx 는 이미 압축돼 있다. 한글 파일 이름은 UTF-8 표시를 켠다) ─────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0 }
  return t
})()
export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function buildZip(files: { filename: string; content: Buffer }[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const FLAG_UTF8 = 0x0800
  for (const f of files) {
    const name = Buffer.from(f.filename, 'utf8')
    const crc = crc32(f.content)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(FLAG_UTF8, 6) // 방식 0 = 압축 없음
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(f.content.length, 18); lh.writeUInt32LE(f.content.length, 22); lh.writeUInt16LE(name.length, 26)
    parts.push(lh, name, f.content)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(FLAG_UTF8, 8)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(f.content.length, 20); ch.writeUInt32LE(f.content.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42)
    central.push(ch, name)
    offset += 30 + name.length + f.content.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}
