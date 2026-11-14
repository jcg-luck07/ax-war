// 첨부문서 읽기(AI 빈칸 채우기) 시험.  node --import ./scripts/_register.mjs scripts/test-extract.mjs
// AI API 는 부르지 않는다 — 문서에서 글자를 뽑는 부분, 서류를 Claude 에게 보낼 내용으로 바꾸는 부분, 돌아온 값을 칸 형식에 맞게 걸러 내는 부분을 시험한다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { crc32 } from 'node:zlib'
import { docxToText, readZip, xlsxToText } from '@/lib/modules/intake/office-text'
import { fileToBlocks, sanitize } from '@/lib/modules/intake/extract'

let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('✔', name) }

// 아주 작은 zip(압축 없이 담기) 만들기 — docx 시험용
function zip(files) {
  const parts = [], central = []; let off = 0
  for (const [name, text] of Object.entries(files)) {
    const nm = Buffer.from(name), data = Buffer.from(text), crc = crc32(data)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26)
    parts.push(lh, nm, data)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42)
    central.push(ch, nm); off += 30 + nm.length + data.length
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, end])
}

const LINES = [{ name: 'refId', value: 'cmp-0026', evidence: '기안서 1항' }]
const clean = (category, raw) => sanitize(category, raw, ['색조', '기초', '선케어', '더마'], ['INF-001', 'INF-002']).values

try {
  await t('엑셀(xlsx): 시트를 행 단위로 풀어 항목 이름과 값이 같이 보인다 (계산 결과가 저장돼 있지 않으면 수식을 적는다)', () => {
    const dir = fs.readdirSync('합성데이터/채운문서').find((d) => d.startsWith('T01_'))
    const text = xlsxToText(fs.readFileSync(`합성데이터/채운문서/${dir}/02_비용편익추계서.xlsx`))
    assert.match(text, /\[시트: 추계서\]/); assert.match(text, /행 12: A: 예상 주문 수 \(건\) \| B: 620/); assert.match(text, /A: 안건 분류 ID \| B: CMP-0026/)
    assert.match(text, /예상 GMV \| B: (\d+|\(수식)/)
  })
  await t('워드(docx)·zip: 문단 단위로 글자만 꺼낸다', () => {
    const buf = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>요청금액 7,000,000원</w:t></w:r></w:p><w:p><w:r><w:t>지급 예정일 2026-09-10</w:t></w:r></w:p></w:body></w:document>' })
    assert.equal(readZip(buf).size, 1)
    assert.equal(docxToText(buf), '요청금액 7,000,000원\n지급 예정일 2026-09-10\n')
    assert.throws(() => readZip(Buffer.from('zip 이 아니에요')), /압축 파일/)
  })
  await t('워드(docx) 표: 칸 사이는 탭, 행 사이는 줄바꿈으로 읽혀 표 모양이 남는다 — 만들어 둔 합성 기안서·계약서도 값이 읽힌다', () => {
    const cell = (x) => `<w:tc><w:p><w:r><w:t>${x}</w:t></w:r></w:p></w:tc>`
    const buf = zip({ 'word/document.xml': `<w:document><w:body><w:tbl><w:tr>${cell('항목')}${cell('작성란')}</w:tr><w:tr>${cell('요청금액')}${cell('7,000,000원')}</w:tr></w:tbl></w:body></w:document>` })
    assert.equal(docxToText(buf), '항목\t작성란\t\n요청금액\t7,000,000원\t\n')
    const dir = fs.readdirSync('합성데이터/채운문서').find((d) => d.startsWith('T01_'))
    const draft = docxToText(fs.readFileSync(`합성데이터/채운문서/${dir}/01_기안서.docx`))
    assert.match(draft, /요청금액 · 계약 방식\t7,000,000원 · ☑ 고정 피/); assert.match(draft, /CMP-0026/); assert.match(draft, /계약 체결 기한 · 지급 예정일\t2026-07-24 · 2026-09-10/)
    const contract = docxToText(fs.readFileSync(`합성데이터/채운문서/${dir}/03_표준계약서_캠페인_계약.docx`))
    assert.match(contract, /건별 계약금액[^\n]*7,000,000원/)
  })
  await t('서류를 Claude 에게 보낼 내용으로: pdf·이미지는 그대로, 엑셀·워드·텍스트는 글자로, 읽을 수 없는 형식(hwp)은 건너뛴다', () => {
    const f = (filename, content = Buffer.from('x'), kind = 'draft') => ({ kind, filename, mime: '', content })
    assert.equal(fileToBlocks(f('a.pdf'))[1].type, 'document')
    assert.equal(fileToBlocks(f('a.PNG'))[1].type, 'image'); assert.equal(fileToBlocks(f('a.jpg'))[1].source.media_type, 'image/jpeg')
    assert.match(fileToBlocks(f('a.txt', Buffer.from('요청금액 100원')))[0].text, /\[기안서 — 파일 a\.txt\][\s\S]*요청금액 100원/)
    assert.equal(fileToBlocks(f('a.hwp')), null); assert.equal(fileToBlocks(f('broken.xlsx', Buffer.from('깨진 파일'), 'estimate')), null)
    assert.match(fileToBlocks({ kind: 'custom', label: '예상 GMV', filename: 'g.csv', mime: '', content: Buffer.from('a,b') })[0].text, /\[예상 GMV — 파일 g\.csv\]/)
  })
  await t('돌아온 값 걸러 내기: 형식에 맞는 값만 남기고(날짜·정수 금액·목록에 있는 값), 맞지 않는 값은 비워 둔다', () => {
    const v = clean('campaign', [
      ...LINES,
      { name: 'settlementDate', value: '2026-09-10', evidence: '' }, { name: 'contractDeadline', value: '2026/07/24', evidence: '' },
      { name: 'requested', value: '7,000,000원', evidence: '기안서 2항' }, { name: 'gmv', value: '52080000', evidence: '' }, { name: 'refund', value: '0', evidence: '' },
      { name: 'cogs', value: '미확인', evidence: '' }, { name: 'productLine', value: '가구', evidence: '' }, { name: 'dealType', value: '확대', evidence: '' },
      { name: 'parentInfluencerId', value: 'inf-002', evidence: '' }, { name: 'memo', value: null, evidence: '' },
    ])
    assert.deepEqual(v, { refId: 'CMP-0026', settlementDate: '2026-09-10', requested: '7000000', gmv: '52080000', refund: '0', dealType: '확대', parentInfluencerId: 'INF-002' })
    assert.equal(clean('campaign', [{ name: 'productLine', value: '색조', evidence: '' }]).productLine, '색조')
  })
  await t('분류에 맞지 않는 칸은 버린다: 캠페인에는 계약 방식·고정 피가, 인플루언서 계약에는 요청금액이 필요 없다. 구분도 분류별로 다르다', () => {
    assert.deepEqual(clean('campaign', [{ name: 'feeType', value: '고정 피', evidence: '' }, { name: 'fixedFee', value: '1000', evidence: '' }, { name: 'currentExpiry', value: '2026-08-31', evidence: '' }]), {})
    const v = clean('influencer', [
      { name: 'requested', value: '7000000', evidence: '' }, { name: 'feeType', value: '혼합 피', evidence: '' }, { name: 'fixedFee', value: '2,800,000,000', evidence: '' },
      { name: 'performanceFee', value: '175000000', evidence: '' }, { name: 'performanceRate', value: '5%', evidence: '' }, { name: 'currentExpiry', value: '2026-08-31', evidence: '' },
      { name: 'dealType', value: '갱신', evidence: '' }, { name: 'refName', value: '혜인', evidence: '' },
    ])
    assert.deepEqual(v, { feeType: '혼합 피', fixedFee: '2800000000', performanceFee: '175000000', performanceRate: '5', currentExpiry: '2026-08-31', dealType: '갱신', refName: '혜인' })
    assert.equal(clean('influencer', [{ name: 'dealType', value: '확대', evidence: '' }]).dealType, undefined)
    assert.equal(clean('influencer', [{ name: 'autoRenew', value: '자동 갱신', evidence: '제2조' }]).autoRenew, '자동 갱신')
    assert.equal(clean('influencer', [{ name: 'autoRenew', value: '있음', evidence: '' }]).autoRenew, undefined, '선택지에 없는 말은 버린다')
    assert.equal(clean('campaign', [{ name: 'autoRenew', value: '자동 갱신', evidence: '' }]).autoRenew, undefined, '캠페인에는 자동 갱신 칸이 없다')
    assert.equal(clean('influencer', [{ name: 'performanceRate', value: '130', evidence: '' }]).performanceRate, undefined)
    assert.equal(clean('influencer', [{ name: 'fixedFee', value: '0', evidence: '' }]).fixedFee, undefined)
  })
  await t('고른 값과 서류 비교: 신규로 골랐는데 서류가 기존 캠페인의 확대 기안서이면 지적하고, 고른 값은 바꾸지 않는다 (같으면 지적 없음)', async () => {
    const { findConflicts } = await import('@/lib/modules/intake/extract-compare')
    const cat = { refLabel: '캠페인 ID', idPrefix: 'CMP-', options: [{ id: 'CMP-0003', label: 'CMP-0003 토모카 기초 캠페인3' }] }
    const doc = { refId: 'CMP-0003', dealType: '확대' }
    const a = findConflicts(cat, { refId: '__new__', isNew: true, deal: '신규' }, doc, '구분')
    assert.equal(a.length, 2); assert.match(a[0], /신규 ID 입력.*이미 있는 캠페인 CMP-0003 토모카 기초 캠페인3의 안건/); assert.match(a[1], /구분: '신규'.*'확대'/)
    const b = findConflicts(cat, { refId: 'CMP-0003', isNew: false, deal: '신규' }, doc, '구분')
    assert.equal(b.length, 1); assert.match(b[0], /구분: '신규'/)
    assert.deepEqual(findConflicts(cat, { refId: 'CMP-0003', isNew: false, deal: '확대' }, doc, '구분'), [], '같으면 지적하지 않는다')
    assert.match(findConflicts(cat, { refId: 'CMP-0009', isNew: false, deal: '확대' }, doc, '구분')[0], /고른 CMP-0009와 서류의 CMP-0003/)
    assert.deepEqual(findConflicts(cat, { refId: '', isNew: false, deal: '' }, doc, '구분'), [], '아직 아무것도 안 골랐으면 지적할 것이 없다')
  })
  await t('원본 마스터로 채우기: 서류가 캠페인 ID 만 적었으면 소속 인플루언서·제품 종류를 마스터에서 채우고, 서류에 적힌 값은 건드리지 않는다', async () => {
    const { enrichFromMaster } = await import('@/lib/modules/intake/extract-compare')
    const master = [{ id: 'CMP-0003', influencerId: 'INF-003', productLine: '기초' }]
    const v = { refId: 'CMP-0003' }, ev = {}
    enrichFromMaster('campaign', v, ev, master)
    assert.equal(v.parentInfluencerId, 'INF-003'); assert.equal(v.productLine, '기초'); assert.match(ev.productLine, /m_campaign_ms\.csv.*CMP-0003/)
    const w = { refId: 'CMP-0003', productLine: '색조' }; enrichFromMaster('campaign', w, {}, master)
    assert.equal(w.productLine, '색조', '서류에 적힌 값이 우선'); assert.equal(w.parentInfluencerId, 'INF-003')
    const u = { refId: 'CMP-9999' }; enrichFromMaster('campaign', u, {}, master); assert.deepEqual(u, { refId: 'CMP-9999' }, '마스터에 없는 ID 는 채우지 않는다')
    const i = { refId: 'CMP-0003' }; enrichFromMaster('influencer', i, {}, master); assert.deepEqual(i, { refId: 'CMP-0003' }, '인플루언서 분류에는 쓰지 않는다')
  })
  await t('시연용 서류: data/demo 의 파일은 합성데이터 원본과 같고, ZIP 으로 묶어도 한글 파일 이름·내용이 그대로 풀린다', async () => {
    const { buildZip, crc32 } = await import('@/lib/modules/intake/demo-files')
    const { createHash } = await import('node:crypto')
    const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    const pairs = [['normal', '합성데이터/채운문서/T26_확대_토모카_캠페인3'], ['exception', '합성데이터/예외문서/M04_값누락_추계서_신규_보미_캠페인4_T13']]
    for (const [kind, src] of pairs) {
      const names = fs.readdirSync(`data/demo/${kind}`).sort()
      assert.ok(names.length >= 3, `${kind}: 서류가 3개 이상`)
      for (const f of names) assert.equal(sha(`data/demo/${kind}/${f}`), sha(`${src}/${f}`), `${kind}/${f} 가 합성데이터 원본과 같다`)
      const zipped = buildZip(names.map((f) => ({ filename: f, content: fs.readFileSync(`data/demo/${kind}/${f}`) })))
      const back = readZip(zipped)
      assert.deepEqual([...back.keys()].sort(), names)
      for (const f of names) assert.ok(back.get(f).equals(fs.readFileSync(`data/demo/${kind}/${f}`)), `${f} 내용 그대로`)
    }
    assert.equal(crc32(Buffer.from('hello')), crc32(Buffer.from('hello'))); assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926, 'CRC32 표준 시험값')
    assert.match(xlsxToText(fs.readFileSync('data/demo/exception/02_비용편익추계서_누락.xlsx')), /시트/)
  })
  await t('AI 키 오류 안내: 배포본(production)에는 .env.local 안내가 나오지 않고, 로컬에는 나온다', async () => {
    const { aiKeyMessage } = await import('@/lib/modules/w02/ai-claude')
    const prev = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      for (const k of ['missing', 'invalid']) { assert.doesNotMatch(aiKeyMessage(k), /\.env\.local|개발 서버/); assert.match(aiKeyMessage(k), /관리자에게 알려/) }
      process.env.NODE_ENV = 'development'
      assert.match(aiKeyMessage('missing'), /\.env\.local/); assert.match(aiKeyMessage('invalid'), /\.env\.local/)
    } finally { process.env.NODE_ENV = prev }
  })
  console.log(`\n${n}개 시험 모두 통과`)
  process.exit(0)
} catch (e) {
  console.error(e)
  process.exit(1)
}
