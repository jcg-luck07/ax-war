// 안건 제출(보고) — 파일 첨부가 있어서 서버 동작 대신 multipart 요청으로 받는다.
// 로그인한 사람 중 그 분류를 제출할 수 있는 역할만 올릴 수 있다.
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getEngine, roleLabel } from '@/lib/app/engine'
import { canSubmitCategory, currentUser } from '@/lib/app/auth'
import { EngineError } from '@/lib/engine/engine'
import { categoryById, submitIntake, type UploadedFile } from '@/lib/modules/intake/submissions'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { sql } = await getEngine()
    const user = await currentUser(sql)
    if (!user.authenticated) return NextResponse.json({ ok: false, message: '로그인이 필요해요.' }, { status: 401 })
    const form = await req.formData()
    const category = String(form.get('category') ?? '')
    const cat = categoryById(category)
    if (!cat) return NextResponse.json({ ok: false, message: '안건 종류를 골라 주세요' }, { status: 400 })
    if (!canSubmitCategory(user, cat.submitRoles, cat.acceptRole)) {
      return NextResponse.json({ ok: false, message: `${cat.label} 안건은 권한이 필요해요` }, { status: 403 })
    }
    const values: Record<string, string> = {}
    for (const [k, v] of form.entries()) if (typeof v === 'string' && k.startsWith('v:')) values[k.slice(2)] = v
    const files: UploadedFile[] = []
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string' || v.size === 0) continue
      if (k.startsWith('f:')) files.push({ kind: k.slice(2).split('#')[0], filename: v.name, mime: v.type, content: Buffer.from(await v.arrayBuffer()) })
      // 직접 추가한 첨부: cf:<번호>#<순서> 파일 + cl:<번호> 종류 이름
      else if (k.startsWith('cf:')) {
        const idx = k.slice(3).split('#')[0]
        files.push({ kind: 'custom', label: String(form.get(`cl:${idx}`) ?? ''), filename: v.name, mime: v.type, content: Buffer.from(await v.arrayBuffer()) })
      }
    }
    const sub = await submitIntake(sql, { category, refId: String(form.get('refId') ?? ''), values, files, by: user.name, allowIncomplete: form.get('allowIncomplete') === '1' })
    revalidatePath('/', 'layout')
    return NextResponse.json({ ok: true, message: `${roleLabel(cat.acceptRole)}에게 보고했어요. 접수되면 안건 목록의 기안서 안에 나타나요.`, id: sub.id })
  } catch (e) {
    const message = e instanceof EngineError ? e.message : `처리하지 못했어요: ${e instanceof Error ? e.message : String(e)}`
    return NextResponse.json({ ok: false, message }, { status: e instanceof EngineError ? 400 : 500 })
  }
}
