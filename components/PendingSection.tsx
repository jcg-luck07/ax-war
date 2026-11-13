// 미확정 안건 구역 — 안건 목록 화면의 맨 위. 회부·승인·부결·재검토를 바로 확정하지 않고 "후보"로 모아 둔 안건을 분류별로 보여 준다.
//  · 처음에는 분류 목록(회부 후보 — 계약 담당 / 승인 후보 …). 분류를 누르면 그 안의 안건 목록이 나온다 (안건 목록과 같은 모양 + 맨 오른쪽 공헌이익 + 왼쪽 체크박스).
//  · 안건을 누르면 그 아래에 수익성 검증, 그 아래에 처리 버튼(확정하기 · ○○ 후보로 변경하기 · 후보에서 빼기)이 나온다.
//  · 후보로 넣어도 안건의 진행 상태는 바뀌지 않는다.
import Link from 'next/link'
import { ArrowLeft, FolderOpen } from '@phosphor-icons/react/ssr'
import { CaseDetail } from '@/components/CaseDetail'
import { PendingWorkbench, type ChangeOption, type PendingRow } from '@/components/PendingWorkbench'
import { AS_OF } from '@/lib/app/engine'
import type { AppUser } from '@/lib/app/auth'
import { ddayText, deadlineAlertClass, fmtWon } from '@/lib/app/format'
import type { CaseRow, DraftRow } from '@/lib/app/case-list'
import { contributionOfCases } from '@/lib/app/case-profit'
import { daysUntil } from '@/lib/engine/engine'
import { CANDIDATE_KINDS, checkCandidate, groupKey, groupLabel, listCandidates, type Candidate, type CandidateKind } from '@/lib/modules/w02/candidates'
import { REWORK_TARGETS } from '@/lib/modules/w02/handoff'
import type { Sql } from 'postgres'

interface Item { cand: Candidate; row: CaseRow; mine: boolean; step: string | null }

/** 분류에서 바꿀 수 있는 다른 후보 */
const CHANGES: Record<CandidateKind, ChangeOption[]> = {
  approve: [{ kind: 'reject', label: '부결 후보' }, { kind: 'hold', label: '재검토 후보' }],
  reject: [{ kind: 'approve', label: '승인 후보' }, { kind: 'hold', label: '재검토 후보' }],
  hold: [{ kind: 'approve', label: '승인 후보' }, { kind: 'reject', label: '부결 후보' }],
  proceed: [{ kind: 'rework', label: '보완요청 후보' }],
  rework: [{ kind: 'proceed', label: '회부 후보' }],
}

export async function PendingSection({ sql, user, all, drafts, group, pid, qs }: {
  sql: Sql
  user: AppUser
  all: CaseRow[]
  drafts: DraftRow[]
  /** 열려 있는 분류 (주소의 pgroup) */
  group: string | undefined
  /** 분류 안에서 고른 안건 (주소의 pid) */
  pid: string | undefined
  /** 다른 주소 값(기안서·안건·정렬 …)은 그대로 두고 일부만 바꾼 주소를 만든다 */
  qs: (over: Record<string, string | undefined>) => string
}) {
  const cands = await listCandidates(sql)
  const draftName = new Map(drafts.map((d) => [d.id, d.name]))
  const byId = new Map(all.map((r) => [r.id, r]))

  // 후보마다: 내 역할로 지금 확정할 수 있는가 (후보를 넣은 뒤 상태가 바뀌었을 수 있으니 매번 다시 확인한다)
  const items: Item[] = []
  for (const cand of cands) {
    const row = byId.get(cand.caseId)
    if (!row) continue
    let mine = false, step: string | null = null
    try { const chk = await checkCandidate(sql, user, cand.caseId, cand.kind, cand.params); mine = true; step = chk.step } catch { /* 지금은 확정할 수 없는 후보 */ }
    // 내 계정에 해당하는 후보만 보여 준다: 내 역할로 확정할 수 있거나, 내가 후보로 넣은 것 (상태가 바뀌어 지금은 확정할 수 없어도 내가 넣은 것은 빼거나 바꿀 수 있어야 한다)
    if (mine || cand.addedBy === user.name) items.push({ cand, row, mine, step })
  }

  const groups = new Map<string, Item[]>()
  for (const it of items) groups.set(groupKey(it.cand), [...(groups.get(groupKey(it.cand)) ?? []), it])
  const keys = [...groups.keys()].sort((a, b) => CANDIDATE_KINDS.indexOf(a.split(':')[0] as CandidateKind) - CANDIDATE_KINDS.indexOf(b.split(':')[0] as CandidateKind) || a.localeCompare(b, 'ko'))
  const key = group && groups.has(group) ? group : null
  const groupItems = key ? groups.get(key)! : []
  const selectedId = key && pid && Number.isInteger(Number(pid)) && groupItems.some((i) => i.row.id === Number(pid)) ? Number(pid) : null
  const dl = (d: string | null) => (d ? `${d} (${ddayText(daysUntil(d, AS_OF))})` : '—')

  // ── 분류 안의 안건 목록
  if (key) {
    const kind = key.split(':')[0] as CandidateKind
    const isApproval = kind === 'approve' || kind === 'reject' || kind === 'hold'
    const steps = groupItems.map((i) => i.step).filter(Boolean)
    const step = steps.filter((s) => s === 'contract').length > steps.filter((s) => s === 'finance').length ? 'contract' : 'finance'
    const reworkTeams = REWORK_TARGETS[step === 'contract' ? 'confirm-terms' : 'collect-performance']
    const profit = await contributionOfCases(sql, groupItems.map((i) => i.row.id))
    const rows: PendingRow[] = groupItems.map(({ row: r, mine }) => {
      const cp = profit.get(r.id) ?? null
      return {
        id: r.id,
        href: qs({ pgroup: key, pid: String(r.id) }),
        code: r.code || '—',
        title: r.title,
        draft: r.draftId !== null ? draftName.get(r.draftId) ?? '—' : '—',
        type: r.categoryLabel,
        amount: r.amount === null ? '—' : fmtWon(r.amount),
        state: r.state,
        settle: r.settlementDate ?? '—',
        deadline: dl(r.deadline),
        deadlineClass: deadlineAlertClass(r.deadline ? daysUntil(r.deadline, AS_OF) : null),
        profit: cp === null ? '—' : fmtWon(cp),
        profitNegative: cp !== null && cp < 0,
        mine,
      }
    })
    return (
      <div className="border border-default" style={{ borderRadius: 2 }}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
          <Link href={qs({ pgroup: undefined, pid: undefined })} scroll={false} className="inline-flex items-center gap-1 border border-default px-2 py-0.5 t-small hover:bg-surface" style={{ borderRadius: 2 }} aria-label="미확정 분류 목록으로 돌아가기">
            <ArrowLeft size={14} /> 미확정 안건
          </Link>
          <span className="t-small font-semibold">
            <FolderOpen size={16} weight="fill" className="mr-1 inline align-text-bottom" />
            {groupLabel(key)} {groupItems.length}건
          </span>
        </div>
        <div className="border-t border-default p-3">
          <PendingWorkbench
            groupLabel={groupLabel(key)}
            rows={rows}
            selectedId={selectedId}
            changeOptions={CHANGES[kind]}
            reworkTeams={reworkTeams.map((t) => ({ role: t.role, label: t.label }))}
            askLinked={kind === 'rework' && step === 'finance'}
          >
            {selectedId ? <CaseDetail key={selectedId} caseId={selectedId} profitOnly={isApproval ? 'approver' : 'finance'} /> : null}
          </PendingWorkbench>
        </div>
      </div>
    )
  }

  // ── 분류 목록
  return (
    <div className="border border-default" style={{ borderRadius: 2 }}>
      <div className="px-3 py-1.5">
        <span className="t-small font-semibold">미확정 안건 {items.length}건 <span className="t-caption">(분류 {keys.length}개) · 내 계정에 해당하는 안건만 보여요. 회부·승인·부결·재검토를 바로 확정하지 않고 &#39;후보&#39;로 모아 둔 안건이에요. 분류를 누르면 그 안의 안건을 비교하고 한꺼번에 확정할 수 있어요.</span></span>
      </div>
      <div className="overflow-auto border-t border-default">
        <table className="w-full border-collapse t-small" style={{ minWidth: 640 }}>
          <thead className="bg-surface">
            <tr>
              {['분류', '안건 수', '요청금액 합계', '지금 확정할 수 있는 안건', '가장 빠른 계약 체결 기한'].map((h, i) => (
                <th key={h} className={`border-b border-r border-default px-3 py-1.5 font-semibold ${i >= 1 && i <= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 t-small">내 계정에 해당하는 후보 안건이 없어요. 아래 안건 목록에서 안건을 열고 &quot;○○ 후보로 넣기&quot;를 누르면 여기에 모여요.</td></tr>
            )}
            {keys.map((k) => {
              const list = groups.get(k)!
              const amounts = list.map((i) => i.row.amount).filter((a): a is number => a !== null)
              const earliest = list.map((i) => i.row.deadline).filter((d): d is string => !!d).sort()[0] ?? null
              const href = qs({ pgroup: k, pid: undefined })
              const cells = [groupLabel(k), `${list.length}건`, amounts.length ? fmtWon(amounts.reduce((a, b) => a + b, 0)) : '—', `${list.filter((i) => i.mine).length}건`, dl(earliest)]
              return (
                <tr key={k} className="border-b border-default hover:bg-surface">
                  {cells.map((t, i) => (
                    <td key={i} className={`border-r border-default p-0 ${i === 0 ? 'font-semibold' : ''} ${i >= 1 && i <= 3 ? 'text-right' : ''}`}>
                      <Link href={href} scroll={false} className={`block truncate whitespace-nowrap px-3 py-1.5 ${i === 4 ? deadlineAlertClass(earliest ? daysUntil(earliest, AS_OF) : null) : ''}`}>{t}</Link>
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
