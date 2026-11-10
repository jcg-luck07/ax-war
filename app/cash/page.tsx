import { Card, Table } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { Pill } from '@/components/bits'
import { getEngine } from '@/lib/app/engine'
import { fmtWon } from '@/lib/app/format'
import { loadCashInputs } from '@/lib/modules/cash/service'
import { DEFAULT_CASH_OPTIONS, simulateWithSensitivity } from '@/lib/modules/cash/simulate'
import { AS_OF } from '@/lib/app/engine'

export const dynamic = 'force-dynamic'

export default async function CashPage() {
  await getEngine()
  let inputs
  try {
    inputs = await loadCashInputs()
  } catch {
    inputs = null
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader
          title="현금 재전망"
          description="Masil 단독 기준(그룹 지원 제외)으로 매 영업일 종가가 최소현금 30억 원 아래로 내려가는지 봐요. 자금일보는 실적만 담고 있어서 미래는 회수·지급 일정을 직접 합산해요."
        />
        {!inputs ? (
          <Card>
            <Card.Content>
              <p className="t-small">원본 자료가 DB 에 없어요. 터미널에서 <code>node scripts/ingest.mjs</code> 를 먼저 실행해 주세요.</p>
            </Card.Content>
          </Card>
        ) : (
          <CashBody inputs={inputs} />
        )}
      </div>
    </AppShell>
  )
}

function CashBody({ inputs }: { inputs: Awaited<ReturnType<typeof loadCashInputs>> }) {
  const { base, alternative, sameFirstBreach } = simulateWithSensitivity(inputs, { ...DEFAULT_CASH_OPTIONS, asOf: AS_OF })
  const horizon = base.days.slice(0, 50)
  const maxClose = Math.max(...horizon.map((d) => d.closing), 1)
  return (
    <>
      <Card>
        <Card.Header>
          <Card.Title>결과 요약</Card.Title>
          <Card.Description>시작 잔액은 {base.openingDate} 종가 {fmtWon(base.openingBalance)}이에요.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <span className="t-small">첫 하회일 <strong>{base.firstBreach ?? '없음'}</strong></span>
            <span className="t-small">최저 잔액 <strong>{fmtWon(base.minBalance)}</strong> ({base.minDate})</span>
            <span className="t-small">30억 대비 부족 <strong>{fmtWon(base.shortfallAtMin)}</strong></span>
          </div>
          {base.windows.map((w) => (
            <p key={w.start} className="t-small">
              하회 구간: <strong>{w.start} ~ {w.end}</strong>{w.openEnded ? ' (전망 기간 끝까지 회복 못 함)' : ' (이후 30억 이상으로 회복)'} · 구간 안 최저 {fmtWon(w.minBalance)} ({w.minDate})
            </p>
          ))}
          <p className="t-caption">
            이 구간에 현금이 나가는 신규 약정은 금액·종류와 관계없이 그룹 CEO 승인이 필요해요 (covenant_terms_ms.md). 그래서 안건 화면의 &lsquo;돈 나가는 날&rsquo; 판단이 이 구간을 써요.
          </p>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>가정을 바꿔도 결론이 같은가?</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-2">
          <p className="t-small">
            기한이 지난 미수금({base.options.overdueCollections === 'asOf' ? '기준일에 회수된다고 봄' : '회수 안 됨'}) 가정을 반대로 바꾸면 최저 잔액이 {fmtWon(base.minBalance)} → {fmtWon(alternative.minBalance)}로 달라지고, 첫 하회일은{' '}
            <strong>{sameFirstBreach ? '같아요 (' + (base.firstBreach ?? '없음') + ')' : `달라져요 (${base.firstBreach} → ${alternative.firstBreach})`}</strong>.
          </p>
          {base.issues.map((i) => <p key={i} className="t-caption">• {i}</p>)}
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>재무팀 공식 전망과 대조</Card.Title>
          <Card.Description>공식 전망은 정답이 아니라 대조 대상이에요. 차이의 원인은 아직 확정하지 못했어요.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="공식 전망 대조">
                <Table.Header>
                  <Table.Column isRowHeader>주(월요일)</Table.Column>
                  <Table.Column>공식 전망 종가</Table.Column>
                  <Table.Column>재계산 종가 (금요일)</Table.Column>
                  <Table.Column>차이</Table.Column>
                </Table.Header>
                <Table.Body>
                  {base.forecastComparison.map((f) => (
                    <Table.Row key={f.week} id={f.week}>
                      <Table.Cell>{f.week}</Table.Cell>
                      <Table.Cell>{fmtWon(f.official)}</Table.Cell>
                      <Table.Cell>{fmtWon(f.simulated)}</Table.Cell>
                      <Table.Cell>{fmtWon(f.diff)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
          <p className="t-caption">
            재계산은 이미 확정된 회수(AR)·지급(AP)·발주 일정만 합산해서 앞으로 생길 신규 매출 회수를 넣지 않았어요. 그래서 공식 전망보다 낮게 나오는 게 자연스러워요. 어느 정도가 이 때문이고 어느 정도가 가정 차이(예: LC-0001 결제조건 45일→90일 연장 반영 여부)인지는 자료만으로 확정하지 못했어요.
          </p>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>영업일별 종가 (앞 50영업일)</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-1">
          {horizon.map((d) => (
            <div key={d.date} className="grid grid-cols-[7rem_1fr_6rem_4rem] items-center gap-3">
              <span className="t-caption">{d.date}</span>
              <div className="h-2 rounded-input bg-muted">
                <div className={`h-2 rounded-input ${d.breach ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${Math.max(2, (d.closing / maxClose) * 100)}%` }} />
              </div>
              <span className="t-caption text-right">{fmtWon(d.closing)}</span>
              {d.breach ? <Pill color="danger">하회</Pill> : <span />}
            </div>
          ))}
        </Card.Content>
      </Card>
    </>
  )
}
