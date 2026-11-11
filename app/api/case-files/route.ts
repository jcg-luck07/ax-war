// 안건에 계약서를 첨부한다 — 계약 담당만 올릴 수 있다 (계약 담당 확인 단계가 열려 있을 때).
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getEngine } from '@/lib/app/engine'
import { canHandle, currentUser } from '@/lib/app/auth'
import { EngineError } from '@/lib/engine/engine'
import { CONTRACT_KIND, addCaseFile } from '@/lib/modules/w02/handoff'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { sql } = await getEngine()
    const user = await currentUser(sql)
    if (!user.authenticated) return NextResponse.json({ ok: false, message: '로그인이 필요해요.' }, { status: 401 })
    if (!canHandle(user, '계약 담당')) return NextResponse.json({ ok: false, message: '계약서는 계약 담당만 첨부할 수 있어요.' }, { status: 403 })
    const form = await req.formData()
    const caseId = Number(form.get('caseId'))
    if (!Number.isInteger(caseId)) return NextResponse.json({ ok: false, message: '안건을 알 수 없어요' }, { status: 400 })
    const files = form.getAll('file').filter((v): v is File => typeof v !== 'string' && v.size > 0)
    if (files.length === 0) return NextResponse.json({ ok: false, message: '파일을 골라 주세요' }, { status: 400 })
    for (const f of files) {
      await addCaseFile(sql, { caseId, kind: CONTRACT_KIND, filename: f.name, mime: f.type, content: Buffer.from(await f.arrayBuffer()), by: user.name })
    }
    revalidatePath('/', 'layout')
    return NextResponse.json({ ok: true, message: `계약서 ${files.length}개를 첨부했어요.` })
  } catch (e) {
    const message = e instanceof EngineError ? e.message : `처리하지 못했어요: ${e instanceof Error ? e.message : String(e)}`
    return NextResponse.json({ ok: false, message }, { status: e instanceof EngineError ? 400 : 500 })
  }
}
