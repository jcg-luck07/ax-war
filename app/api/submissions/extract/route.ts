// 안건 제출 — 첨부문서를 AI 로 읽어 빈칸 값을 돌려준다. 칸에 넣는 것은 제출 화면이고, 아무것도 저장하지 않는다.
// 제출 권한이 있는 로그인 사용자만 쓸 수 있다 (호출마다 비용이 든다).
import { NextResponse } from 'next/server'
import { getEngine } from '@/lib/app/engine'
import { canSubmitCategory, currentUser } from '@/lib/app/auth'
import { EngineError } from '@/lib/engine/engine'
import { categoryById, type UploadedFile } from '@/lib/modules/intake/submissions'
import { extractFromFiles } from '@/lib/modules/intake/extract'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_TOTAL = 24 * 1024 * 1024

export async function POST(req: Request) {
  try {
    const { sql } = await getEngine()
    const user = await currentUser(sql)
    if (!user.authenticated) return NextResponse.json({ ok: false, message: '로그인이 필요해요.' }, { status: 401 })
    const form = await req.formData()
    const category = String(form.get('category') ?? '')
    const cat = categoryById(category)
    if (!cat) return NextResponse.json({ ok: false, message: '안건 종류를 골라 주세요' }, { status: 400 })
    if (!canSubmitCategory(user, cat.submitRoles, cat.acceptRole)) return NextResponse.json({ ok: false, message: `${cat.label} 안건은 권한이 필요해요` }, { status: 403 })
    const files: UploadedFile[] = []
    let total = 0
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string' || v.size === 0) continue
      total += v.size
      if (v.size > 8 * 1024 * 1024) return NextResponse.json({ ok: false, message: `${v.name}: 파일이 너무 커요 (8MB 까지)` }, { status: 400 })
      const content = Buffer.from(await v.arrayBuffer())
      if (k.startsWith('f:')) files.push({ kind: k.slice(2).split('#')[0], filename: v.name, mime: v.type, content })
      else if (k.startsWith('cf:')) files.push({ kind: 'custom', label: String(form.get(`cl:${k.slice(3).split('#')[0]}`) ?? ''), filename: v.name, mime: v.type, content })
    }
    if (total > MAX_TOTAL) return NextResponse.json({ ok: false, message: '첨부 파일이 너무 많아요 (합계 24MB 까지)' }, { status: 400 })
    const r = await extractFromFiles(sql, category, files)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    const message = e instanceof EngineError || e instanceof Error ? e.message : String(e)
    // 이 길에서 던지는 오류는 모두 사용자에게 보여 줄 안내 문구라서 400 으로 돌려준다
    return NextResponse.json({ ok: false, message }, { status: e instanceof Error ? 400 : 500 })
  }
}
