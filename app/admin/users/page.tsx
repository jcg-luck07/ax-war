import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { UserRoleForm } from '@/components/case-actions'
import { getEngine } from '@/lib/app/engine'
import { currentUser, roleLabels } from '@/lib/app/auth'
import { ROLES } from '@/lib/rules/authority.rules'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const { sql } = await getEngine()
  const user = await currentUser(sql)
  const users = user.isAdmin
    ? await sql<{ email: string; display_name: string; roles: string[] }[]>`SELECT email, display_name, roles FROM user_roles ORDER BY display_name`
    : []
  const roles = ROLES.map((r) => ({ id: r.id, label: r.label }))

  return (
    <AppShell>
      <div className="flex flex-col gap-3">
        <PageHeader title="사용자·권한" description="누가 어떤 승인·확인 요청·작업을 할 수 있는지 정해요. 이메일은 axhub 로그인 이메일과 같아야 해요." />

        <Card>
          <Card.Header><Card.Title>내 정보</Card.Title></Card.Header>
          <Card.Content className="flex flex-col gap-1">
            <span className="t-small">{user.name} {user.email ? `(${user.email})` : ''}</span>
            <span className="t-caption">역할: {roleLabels(user.roles).join(', ') || '없음'} · {user.isAdmin ? '관리자' : '관리자 아님'}</span>
          </Card.Content>
        </Card>

        {!user.isAdmin ? (
          <Card>
            <Card.Content>
              <p className="t-small">관리자만 사용자 권한을 바꿀 수 있어요. (axhub 앱 소유자 또는 회사 관리자)</p>
            </Card.Content>
          </Card>
        ) : (
          <>
            <Card>
              <Card.Header>
                <Card.Title>역할이 하는 일</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-1">
                <span className="t-small">• 마케팅 팀장·Masil 대표·CEO/이사회: 승인할 수 있어요. 더 높은 권한은 낮은 권한의 승인을 대신할 수 있어요 (그룹 CEO와 CEO/이사회는 같은 수준).</span>
                <span className="t-small">• 재무·계약 담당: 승인 권한은 없고, 자기 부서로 온 확인 요청과 작업을 처리해요.</span>
                <span className="t-small">• 역할이 없는 사람은 화면을 볼 수만 있어요.</span>
              </Card.Content>
            </Card>

            <Card>
              <Card.Header><Card.Title>사용자 추가</Card.Title></Card.Header>
              <Card.Content><UserRoleForm roles={roles} /></Card.Content>
            </Card>

            <Card>
              <Card.Header><Card.Title>등록된 사용자 ({users.length}명)</Card.Title></Card.Header>
              <Card.Content className="flex flex-col gap-3">
                {users.length === 0 && <p className="t-small">아직 등록된 사용자가 없어요.</p>}
                {users.map((u) => (
                  <div key={u.email} className="flex flex-col gap-2 border-b border-default pb-6">
                    <UserRoleForm roles={roles} initial={{ email: u.email, name: u.display_name, roles: u.roles }} />
                  </div>
                ))}
              </Card.Content>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}
