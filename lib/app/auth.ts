// 현재 사용자와 권한 (서버 전용).
//
// 실제 회사에서 쓰는 프로그램이라 "누가 결정했나"가 기록되고, 그 사람이 가진 역할만큼만 승인·회신·작업을 할 수 있다.
//  - 배포본(production): axhub 가 알려 주는 로그인 사용자(이메일)를 쓴다. 이메일에 역할을 붙이는 일은 관리자가 /admin/users 에서 한다.
//    로그인하지 않은 사람은 볼 수만 있고 아무것도 바꿀 수 없다.
//  - 로컬 개발(next dev): axhub 로그인이 없으므로 .env.local 의 DEV_USER_* 값을 사용자로 쓴다 (화면에 역할 전환 같은 기능은 없다).
//      DEV_USER_EMAIL / DEV_USER_NAME / DEV_USER_ROLES(쉼표 구분 또는 all) / DEV_USER_ADMIN(1)
import type { Sql } from 'postgres'
import { db, ensureSchema } from '@/lib/db'
import { isAxhubConfigured, me } from '@/lib/axhub-server'
import { ROLES } from '@/lib/rules/authority.rules'

export interface AppUser {
  authenticated: boolean
  email: string
  name: string
  /** 가진 역할 id 들 */
  roles: string[]
  isAdmin: boolean
}

const ALL_ROLE_IDS = ROLES.map((r) => r.id)
const validRoles = (ids: string[]) => ids.filter((x) => ALL_ROLE_IDS.includes(x))

/** 로컬 개발·시험용 계정. 기본은 마케팅 팀원이고, 화면 오른쪽 위에서 다른 계정으로 바꿔 볼 수 있다 (배포본에는 없다). */
export const DEV_ACCOUNTS: { id: string; name: string; label: string; roles: string[] }[] = [
  { id: 'member', name: '마케팅 팀원', label: '마케팅 팀원', roles: ['marketing_member'] },
  { id: 'lead', name: '마케팅 팀장', label: '마케팅 팀장', roles: ['marketing_team'] },
  { id: 'finance', name: '재무팀', label: '재무팀', roles: ['finance'] },
  { id: 'contract', name: '계약 담당', label: '계약 담당', roles: ['contract_mgr'] },
  { id: 'masil', name: 'Masil 대표', label: 'Masil 대표', roles: ['masil_ceo'] },
  { id: 'ceo', name: 'CEO/이사회', label: 'CEO/이사회', roles: ['ceo_board'] },
]
export const DEV_COOKIE = 'dev_account'

async function devAccountId(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers')
    return (await cookies()).get(DEV_COOKIE)?.value ?? null
  } catch {
    return null // 요청 밖(시험 등)
  }
}

export async function currentUser(sqlArg?: Sql): Promise<AppUser> {
  if (process.env.NODE_ENV !== 'production') {
    const devId = await devAccountId()
    const acc = DEV_ACCOUNTS.find((a) => a.id === devId)
    if (acc) return { authenticated: true, email: `${acc.id}@local`, name: acc.name, roles: acc.roles, isAdmin: false }
    if (process.env.DEV_USER_ROLES === undefined && process.env.DEV_USER_NAME === undefined) {
      const d = DEV_ACCOUNTS[0]
      return { authenticated: true, email: `${d.id}@local`, name: d.name, roles: d.roles, isAdmin: false }
    }
    const raw = process.env.DEV_USER_ROLES ?? 'all'
    return {
      authenticated: true,
      email: process.env.DEV_USER_EMAIL || 'dev@local',
      name: process.env.DEV_USER_NAME || '로컬 개발자',
      roles: raw === 'all' ? ALL_ROLE_IDS : validRoles(raw.split(',').map((x) => x.trim())),
      isAdmin: process.env.DEV_USER_ADMIN !== '0',
    }
  }
  if (!isAxhubConfigured()) return { authenticated: false, email: '', name: '', roles: [], isAdmin: false }
  const v = await me()
  if (!v.authenticated) return { authenticated: false, email: '', name: '', roles: [], isAdmin: false }
  await ensureSchema()
  const sql = sqlArg ?? db()
  const rows = await sql<{ roles: string[] }[]>`SELECT roles FROM user_roles WHERE lower(email) = lower(${v.email})`
  return {
    authenticated: true,
    email: v.email,
    name: v.name || v.email,
    roles: validRoles(rows[0]?.roles ?? []),
    isAdmin: Boolean(v.is_admin),
  }
}

const roleById = (id: string) => ROLES.find((r) => r.id === id)

/** 이 사람이 요구 권한(requiredRoleId)의 승인을 할 수 있는가. 가능하면 결정에 쓸 역할을 돌려준다(그 승인을 맡은 역할 본인만). */
export function decidingRole(user: AppUser, requiredRoleId: string): string | null {
  const need = roleById(requiredRoleId)?.rank
  if (need === undefined || need <= 0) return null
  // 승인은 그 승인을 맡은 역할 본인만 한다 (높은 권한이 낮은 권한의 승인을 대신하지 않는다)
  return user.roles.includes(requiredRoleId) ? requiredRoleId : null
}

/** 작업의 담당(assignee 이름)을 이 사람이 처리할 수 있는가 */
export function canHandle(user: AppUser, assignee: string | null): boolean {
  if (!user.authenticated) return false
  if (user.isAdmin) return true
  if (!assignee) return user.roles.length > 0
  return user.roles.some((id) => roleById(id)?.aliases?.includes(assignee))
}

/** 안건을 접수하거나 조건을 바꾸는 등 일반 업무를 할 수 있는가 (역할이 하나라도 있으면) */
export const canWork = (user: AppUser) => user.authenticated && user.roles.length > 0

export const roleLabels = (ids: string[]) => ids.map((id) => roleById(id)?.label ?? id)

/** 이 사람이 현금흐름(covenant 하회 구간 재전망)을 볼 수 있는가 — 승인 권한이 있는 역할(팀장 이상)과 재무팀 */
export const canSeeCash = (user: AppUser) =>
  user.authenticated && user.roles.some((id) => id === 'finance' || (roleById(id)?.rank ?? 0) > 0)

/** 이 분류의 안건을 접수(받아서 안건으로 만들기)할 수 있는가 — 접수 최소 역할 이상 */
export const canAcceptCategory = (user: AppUser, acceptRole: string) => user.authenticated && decidingRole(user, acceptRole) !== null

/** 이 분류의 안건을 올릴 수 있는가 — 지정된 역할이거나 접수 권한자 */
export const canSubmitCategory = (user: AppUser, submitRoles: string[], acceptRole: string) =>
  user.authenticated && (user.roles.some((r) => submitRoles.includes(r)) || canAcceptCategory(user, acceptRole))
