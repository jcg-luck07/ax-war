// 안건에 붙은 첨부파일(계약서) 내려받기. 로그인한 사람 중 역할이 있는 사람만 받을 수 있다.
import { getEngine } from '@/lib/app/engine'
import { canWork, currentUser } from '@/lib/app/auth'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canHandle } from '@/lib/app/auth'
import { EngineError } from '@/lib/engine/engine'
import { getCaseFile, removeCaseFile } from '@/lib/modules/w02/handoff'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { sql } = await getEngine()
  const user = await currentUser(sql)
  if (!canWork(user)) return new Response('권한이 없어요', { status: 403 })
  const fid = Number(id)
  if (!Number.isInteger(fid)) return new Response('없는 파일이에요', { status: 404 })
  const f = await getCaseFile(sql, fid)
  if (!f) return new Response('없는 파일이에요', { status: 404 })
  return new Response(new Uint8Array(f.content), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(f.size),
    },
  })
}

/** 첨부한 서류 빼기 — 계약 담당만, 그 서류를 올릴 수 있는 단계가 열려 있을 때만 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { sql } = await getEngine()
    const user = await currentUser(sql)
    if (!user.authenticated) return NextResponse.json({ ok: false, message: '로그인이 필요해요.' }, { status: 401 })
    if (!canHandle(user, '계약 담당')) return NextResponse.json({ ok: false, message: '첨부는 계약 담당만 뺄 수 있어요.' }, { status: 403 })
    const fid = Number(id)
    if (!Number.isInteger(fid)) return NextResponse.json({ ok: false, message: '없는 파일이에요' }, { status: 404 })
    await removeCaseFile(sql, fid, user.name)
    revalidatePath('/', 'layout')
    return NextResponse.json({ ok: true, message: '첨부를 뺐어요.' })
  } catch (e) {
    const message = e instanceof EngineError ? e.message : `처리하지 못했어요: ${e instanceof Error ? e.message : String(e)}`
    return NextResponse.json({ ok: false, message }, { status: e instanceof EngineError ? 400 : 500 })
  }
}
