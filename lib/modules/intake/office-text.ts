// 첨부문서에서 글자 뽑기 — 엑셀(xlsx)·워드(docx)는 압축 묶음(zip)이라 패키지 없이 직접 열어 글자만 꺼낸다 (서버 전용).
// AI 에게 서류를 읽힐 때 쓴다. 엑셀은 한 줄(행)씩 "A: 항목 | B: 값 …"으로 풀어서, 항목 이름과 값이 같이 보이게 한다.
import { inflateRawSync } from 'node:zlib'

/** zip 파일 안의 파일들을 꺼낸다 (이름 → 내용). zip64·암호는 지원하지 않는다. */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  // 끝 부분의 "중앙 디렉터리 끝" 표시를 찾는다
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('압축 파일 형식이 아니에요')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(dataStart, dataStart + csize)
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw))
  }
  return out
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&')

const textOf = (xml: string) => decode([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''))

/** 엑셀(xlsx): 시트마다 행 단위로 풀어 쓴다. 계산 결과 값이 저장돼 있으면 그 값을, 없으면 수식을 적는다. */
export function xlsxToText(buf: Buffer, maxLines = 700): string {
  const z = readZip(buf)
  const get = (name: string) => z.get(name)?.toString('utf8') ?? ''
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
  const rels = new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const tag = m[0]
    return [tag.match(/\bId="([^"]+)"/)?.[1] ?? '', tag.match(/\bTarget="([^"]+)"/)?.[1] ?? ''] as [string, string]
  }))
  const sheets = [...get('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decode(m[0].match(/\bname="([^"]*)"/)?.[1] ?? ''),
    file: 'xl/' + (rels.get(m[0].match(/\br:id="([^"]+)"/)?.[1] ?? '') ?? '').replace(/^\/?(xl\/)?/, ''),
  }))
  const lines: string[] = []
  for (const sh of sheets) {
    const xml = get(sh.file)
    if (!xml) continue
    lines.push(`[시트: ${sh.name}]`)
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/\br="([A-Z]+\d+)"/)?.[1] ?? ''
        const body = c[2] ?? ''
        const type = c[1].match(/\bt="([^"]+)"/)?.[1]
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        let val = ''
        if (type === 's' && v !== undefined) val = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') val = textOf(body)
        else if (v !== undefined) val = decode(v)
        else { const f = body.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1]; if (f) val = `(수식, 계산 결과 없음) =${decode(f)}` }
        if (val !== '' && ref) cells.push(`${ref.replace(/\d+/g, '')}: ${val}`)
      }
      if (cells.length > 0) lines.push(`행 ${row[0].match(/\br="(\d+)"/)?.[1] ?? ''}: ${cells.join(' | ')}`)
      if (lines.length >= maxLines) return lines.join('\n') + '\n… (이하 생략)'
    }
  }
  return lines.join('\n')
}

/** 워드(docx): 문단 단위로 글자만 꺼낸다 */
export function docxToText(buf: Buffer, maxChars = 60_000): string {
  const xml = readZip(buf).get('word/document.xml')?.toString('utf8') ?? ''
  // 표: 칸 사이는 탭, 행 사이는 줄바꿈 (표 안의 문단 끝 줄바꿈은 칸 끝의 탭으로 바꿔 한 행이 한 줄로 읽히게 한다)
  const text = decode(xml.replace(/<\/w:p>(?=<\/w:tc>)/g, '').replace(/<\/w:tc>/g, '\t').replace(/<\/w:tr>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, ''))
  return text.replace(/\n{3,}/g, '\n\n').slice(0, maxChars)
}
