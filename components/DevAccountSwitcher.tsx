'use client'

// 로컬 시험용 계정 전환. 로그인이 없는 개발 환경에서 팀원·팀장·대표·CEO 화면을 번갈아 보려고 둔 것이다 (배포본에는 나오지 않는다).
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { switchDevAccountAction } from '@/app/actions'

export function DevAccountSwitcher({ accounts, current }: { accounts: { id: string; label: string }[]; current: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <label className="flex items-center gap-2 t-small">
      <span className="t-caption">시험 계정</span>
      <select
        className="rounded-input border border-default bg-content px-2 py-1 t-small"
        value={current}
        disabled={pending}
        aria-label="시험 계정 전환"
        onChange={(e) => start(async () => { await switchDevAccountAction(e.target.value); router.refresh() })}
      >
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
    </label>
  )
}
