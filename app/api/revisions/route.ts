// 수정 보고 — 승인 또는 부결 뒤에 금액이 바뀐 안건을 다시 보고한다. 첨부(바뀐 계약서 등)가 있어 multipart 로 받는다.
// 마케팅 부서(안건을 올린 쪽)와 계약 담당(계약 조건이 바뀌었음을 아는 쪽)이 보고할 수 있다.
// 승인 뒤부터 최종 종결 전까지만 가능하다.
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getEngine, roleLabel } from '@/lib/app/engine'
import { canHandle, currentUser } from '@/lib/app/auth'
import { EngineError } from '@/lib/engine/engine'
import { reportRevision } from '@/lib/modules/w02/revision'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { sql, cfg } = await getEngine()
    const user = await currentUser(sql)
    if (!user.authenticated) return NextResponse.json({ ok: false, message: '로그인이 필요해요.' }, { status: 401 })
    if (!canHandle(user, '마케팅') && !canHandle(user, '계약 담당')) return NextResponse.json({ ok: false, message: '수정 보고는 마케팅 부서나 계약 담당만 할 수 있어요.' }, { status: 403 })
    const form = await req.formData()
    const caseId = Number(form.get('caseId'))
    if (!Number.isInteger(caseId)) return NextResponse.json({ ok: false, message: '안건을 알 수 없어요' }, { status: 400 })
    const newAmount = Number(String(form.get('newAmount') ?? '').replace(/,/g, ''))
    const files = []
    for (const v of form.getAll('file')) {
      if (typeof v === 'string' || v.size === 0) continue
      files.push({ filename: v.name, mime: v.type, content: Buffer.from(await v.arrayBuffer()) })
    }
    const r = await reportRevision(sql, cfg, { caseId, newAmount, reason: String(form.get('reason') ?? ''), files, by: user.name })
    revalidatePath('/', 'layout')
    const pct = `${(r.pct * 100).toFixed(1)}%`
    return NextResponse.json({
      ok: true,
      message: r.route === 'direct'
        ? `금액 변동 ${pct} (5% 이내) — ${roleLabel(r.approverRole)}에게 바로 보고했어요.`
        : `금액 변동 ${pct} (5% 초과) — 재무팀 절차부터 다시 진행한 뒤 ${roleLabel(r.approverRole)}에게 보고해요.`,
    })
  } catch (e) {
    const message = e instanceof EngineError ? e.message : `처리하지 못했어요: ${e instanceof Error ? e.message : String(e)}`
    return NextResponse.json({ ok: false, message }, { status: e instanceof EngineError ? 400 : 500 })
  }
}
