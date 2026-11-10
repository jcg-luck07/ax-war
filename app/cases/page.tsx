import Link from 'next/link'
import { Card, Table, buttonVariants } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { OriginPill, StatusPill } from '@/components/bits'
import { AS_OF, getEngine, roleLabel } from '@/lib/app/engine'
import { CASE_TYPE, STATUS, ddayText } from '@/lib/app/format'
import { daysUntil, listCases } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

const TYPES = Object.keys(CASE_TYPE)

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string }> }) {
  const { status, type } = await searchParams
  const { sql } = await getEngine()
  const all = await listCases(sql)
  const rows = all.filter((c) => (!status || c.status === status) && (!type || c.caseType === type))
  const count = (s: string) => all.filter((c) => c.status === s).length
  const href = (p: { status?: string; type?: string }) => {
    const q = new URLSearchParams()
    if (p.status ?? status) q.set('status', (p.status ?? status)!)
    if (p.type ?? type) q.set('type', (p.type ?? type)!)
    const s = q.toString()
    return s ? `/cases?${s}` : '/cases'
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader title="안건" description="결정이 필요한 일을 마감이 빠른 순서로 보여 줘요. 행을 누르면 근거와 다음 행동이 나와요." />
        <Card>
          <Card.Header>
            <Card.Title>필터</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Link className={buttonVariants({ variant: !status ? 'primary' : 'outline', size: 'sm' })} href={href({ status: '' })}>
                전체 {all.length}
              </Link>
              {Object.entries(STATUS).map(([k, v]) => (
                <Link key={k} className={buttonVariants({ variant: status === k ? 'primary' : 'outline', size: 'sm' })} href={href({ status: k })}>
                  {v.label} {count(k)}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className={buttonVariants({ variant: !type ? 'secondary' : 'ghost', size: 'sm' })} href={href({ type: '' })}>
                모든 종류
              </Link>
              {TYPES.map((t) => (
                <Link key={t} className={buttonVariants({ variant: type === t ? 'secondary' : 'ghost', size: 'sm' })} href={href({ type: t })}>
                  {CASE_TYPE[t]}
                </Link>
              ))}
            </div>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content>
            {rows.length === 0 ? (
              <p className="t-small">조건에 맞는 안건이 없어요. {all.length === 0 && '시연 도구에서 안건을 불러오세요.'}</p>
            ) : (
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label="안건 목록">
                    <Table.Header>
                      <Table.Column isRowHeader>안건</Table.Column>
                      <Table.Column>종류</Table.Column>
                      <Table.Column>상태</Table.Column>
                      <Table.Column>승인권자</Table.Column>
                      <Table.Column>마감</Table.Column>
                      <Table.Column>데이터</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {rows.map((c) => (
                        <Table.Row key={c.id} id={c.id}>
                          <Table.Cell>
                            <Link href={`/cases/${c.id}`} className="t-small font-semibold">
                              {c.title}
                            </Link>
                          </Table.Cell>
                          <Table.Cell>{CASE_TYPE[c.caseType] ?? c.caseType}</Table.Cell>
                          <Table.Cell>
                            <StatusPill status={c.status} />
                          </Table.Cell>
                          <Table.Cell>{c.authority ? roleLabel(c.authority) : '미정'}</Table.Cell>
                          <Table.Cell>{c.deadline ? `${c.deadline} (${ddayText(daysUntil(c.deadline, AS_OF))})` : '—'}</Table.Cell>
                          <Table.Cell>
                            <OriginPill origin={c.dataOrigin} />
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            )}
          </Card.Content>
        </Card>
      </div>
    </AppShell>
  )
}
