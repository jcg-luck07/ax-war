// 안건에 붙은 첨부파일(계약서) 내려받기. 로그인한 사람 중 역할이 있는 사람만 받을 수 있다.
import { getEngine } from '@/lib/app/engine'
import { canWork, currentUser } from '@/lib/app/auth'
import { getCaseFile } from '@/lib/modules/w02/handoff'

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
