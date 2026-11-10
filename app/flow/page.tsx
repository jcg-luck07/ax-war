import Link from 'next/link'
import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { StatusPill } from '@/components/bits'
import { FlowDiagram } from '@/components/FlowDiagram'
import { getEngine } from '@/lib/app/engine'
import { getCaseView, listCases } from '@/lib/engine/engine'
import { FLOWS } from '@/lib/process/definitions'
import { countWaiting, deriveFlowState } from '@/lib/process/state'
import { roleLabel } from '@/lib/app/engine'

export const dynamic = 'force-dynamic'

export default async function FlowPage() {
  const { sql } = await getEngine()
  const cases = await listCases(sql)
  const views = await Promise.all(cases.map((c) => getCaseView(sql, c.id)))

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader
          title="업무 흐름"
          description="안건이 어느 부서(가로 줄)에서 어떤 단계를 거쳐 누구의 결정으로 이어지는지 BPMN 방식으로 보여 줘요. 파란 숫자는 그 단계에서 지금 기다리는 안건 수예요."
        />
        {FLOWS.map((def) => {
          const mine = views.filter((v) => def.caseTypes.includes(v.case.caseType))
          const states = mine.map((v) => ({ v, s: deriveFlowState(def, v) }))
          const counts = countWaiting(def, states.map((x) => x.s))
          const waiting = states.filter((x) => x.s.current.length > 0).slice(0, 12)
          return (
            <Card key={def.id}>
              <Card.Header>
                <Card.Title>{def.title}</Card.Title>
                <Card.Description>{def.description} · 안건 {mine.length}건</Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-col gap-6">
                <FlowDiagram def={def} counts={counts} laneLabels={{ approver: '승인권자 (규칙집이 판정)' }} uid={`flow-${def.id}`} />
                {waiting.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="t-small font-semibold">지금 기다리는 안건</p>
                    {waiting.map(({ v, s }) => (
                      <Link key={v.case.id} href={`/cases/${v.case.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-default p-3">
                        <span className="t-small">{v.case.title}</span>
                        <span className="flex items-center gap-2">
                          <span className="t-caption">
                            {s.current.map((n) => `${def.lanes.find((l) => l.id === n.lane)?.label ?? n.lane} · ${n.label}${n.lane === 'approver' && v.case.authority ? ` (${roleLabel(v.case.authority)})` : ''}`).join(' / ')}
                          </span>
                          <StatusPill status={v.case.status} />
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </Card.Content>
            </Card>
          )
        })}
      </div>
    </AppShell>
  )
}
