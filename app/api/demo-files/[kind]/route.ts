// 시연용 첨부서류(정상 / 데이터 누락) 내려받기 — DB 에 올려 둔 합성 서류를 ZIP 한 개로 묶어 준다.
// 로그인한 사람(시험 계정 포함)이면 받을 수 있다. 가상 데이터라 민감한 내용은 없다.
import { getEngine } from '@/lib/app/engine'
import { currentUser } from '@/lib/app/auth'
import { DEMO_SETS, buildZip, getDemoFiles, isDemoKind } from '@/lib/modules/intake/demo-files'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  if (!isDemoKind(kind)) return new Response('없는 시연 파일이에요', { status: 404 })
  const { sql } = await getEngine()
  const user = await currentUser(sql)
  if (!user.authenticated) return new Response('로그인이 필요해요', { status: 401 })
  const files = await getDemoFiles(sql, kind)
  if (files.length === 0) return new Response('시연 파일이 아직 준비되지 않았어요', { status: 404 })
  const zip = buildZip(files)
  return new Response(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(DEMO_SETS[kind].zipName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(zip.length),
    },
  })
}
