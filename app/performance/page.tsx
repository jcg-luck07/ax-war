import Link from 'next/link'
import { Card, Table, buttonVariants } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { Pill } from '@/components/bits'
import { fmtPct, fmtRoas, fmtWon } from '@/lib/app/format'
import { tryPerformance } from '@/lib/app/queries'
import { DEFAULT_ASSUMPTIONS, type PerfAssumptions } from '@/lib/metrics/performance'

export const dynamic = 'force-dynamic'

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ units?: string; recover?: string; rlog?: string }> }) {
  const sp = await searchParams
  const a: PerfAssumptions = {
    unitsPerOrder: Math.max(1, Number(sp.units) || DEFAULT_ASSUMPTIONS.unitsPerOrder),
    returnLogisticsTimes: Math.max(1, Number(sp.rlog) || DEFAULT_ASSUMPTIONS.returnLogisticsTimes),
    recoverCostOnRefund: sp.recover === '1',
    recoverChannelFeeOnRefund: sp.recover === '1',
  }
  const perf = await tryPerformance(a)
  const presets = [
    { label: '기본 가정', q: '' },
    { label: '주문당 원가·배송비 2회', q: '?units=2' },
    { label: '환불 시 원가·수수료 회수', q: '?recover=1' },
    { label: '반품 물류비 2회', q: '?rlog=2' },
  ]
  const cur = `${a.unitsPerOrder}-${a.recoverCostOnRefund}-${a.returnLogisticsTimes}`

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader
          title="인플루언서 성과"
          description="GMV(얼마나 팔렸나)와 실질 공헌이익(얼마 남았나)을 같은 기준으로 나란히 봐요. 가정을 바꿔 결론이 유지되는지 확인할 수 있어요."
        />

        {!perf ? (
          <Card>
            <Card.Content>
              <p className="t-small">원본 자료가 DB 에 없어요. 터미널에서 <code>node scripts/ingest.mjs</code> 를 먼저 실행해 주세요.</p>
            </Card.Content>
          </Card>
        ) : (
          <>
            <Card>
              <Card.Header>
                <Card.Title>계산 가정</Card.Title>
                <Card.Description>주문 행에 수량이 없어서 원가·배송비를 주문 1건에 몇 번 적용할지는 가정이에요 (A05). 아래에서 바꿔 보세요.</Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {presets.map((p) => {
                    const pa = new URLSearchParams(p.q.replace('?', ''))
                    const key = `${Number(pa.get('units')) || 1}-${pa.get('recover') === '1'}-${Number(pa.get('rlog')) || 1}`
                    return (
                      <Link key={p.label} href={`/performance${p.q}`} className={buttonVariants({ variant: key === cur ? 'primary' : 'outline', size: 'sm' })}>
                        {p.label}
                      </Link>
                    )
                  })}
                </div>
                <p className="t-caption">
                  지금 적용: 주문당 {a.unitsPerOrder}회 · 반품 물류비 {a.returnLogisticsTimes}회 · 환불 시 원가·수수료 {a.recoverCostOnRefund ? '회수' : '회수 안 함'}
                </p>
              </Card.Content>
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>배분은 성과를 따라가고 있나?</Card.Title>
                <Card.Description>광고비 집행 순위와 실질 공헌이익 순위의 상관이에요. 원본 지침은 &ldquo;배분이 성과와 같은 방향인지 확인하라&rdquo;고만 해서, 계산식과 판정 기준(±0.3)은 제가 정한 가정이에요.</Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-wrap items-center gap-6">
                <span className="t-small">정렬도 <strong>{perf.alignment.spearman === null ? '계산 불가' : perf.alignment.spearman.toFixed(2)}</strong></span>
                <Pill color={perf.alignment.direction === '반대 방향' ? 'danger' : perf.alignment.direction === '같은 방향' ? 'success' : 'default'}>{perf.alignment.direction}</Pill>
                <span className="t-caption">10명 표본이라 통계 결론이 아니라 방향 표시예요.</span>
              </Card.Content>
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>인플루언서별 비교 (대표 표본)</Card.Title>
                <Card.Description>
                  표본 금액이에요. 연간 예산이나 28억 원 계약과 곱해 손익으로 바꾸지 않고, 순위·비중·방향으로만 읽어요.
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <Table>
                  <Table.ScrollContainer>
                    <Table.Content aria-label="인플루언서별 성과">
                      <Table.Header>
                        <Table.Column isRowHeader>인플루언서</Table.Column>
                        <Table.Column>GMV 순위</Table.Column>
                        <Table.Column>광고비 비중 (순위)</Table.Column>
                        <Table.Column>실질 공헌이익 (표본)</Table.Column>
                        <Table.Column>공헌이익 순위</Table.Column>
                        <Table.Column>명목 ROAS</Table.Column>
                        <Table.Column>실질 ROAS</Table.Column>
                        <Table.Column>반품률</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {perf.byInfluencer.map((p) => (
                          <Table.Row key={p.influencerId} id={p.influencerId}>
                            <Table.Cell>{p.influencerName} <span className="t-caption">{p.influencerId}</span></Table.Cell>
                            <Table.Cell>{p.rankByGmv}위</Table.Cell>
                            <Table.Cell>{fmtPct(p.spendShare)} ({p.rankBySpend}위)</Table.Cell>
                            <Table.Cell>{fmtWon(p.contributionProfit)}</Table.Cell>
                            <Table.Cell><strong>{p.rankByContribution}위</strong></Table.Cell>
                            <Table.Cell>{fmtRoas(p.nominalRoas)}</Table.Cell>
                            <Table.Cell>{fmtRoas(p.realRoas)}</Table.Cell>
                            <Table.Cell>{fmtPct(p.returnRate)}</Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              </Card.Content>
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>자료 품질</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-1">
                <p className="t-small">비용 마스터에 없는 주문 {perf.quality.ordersMissingCost}건 · 캠페인에 연결 안 된 주문 {perf.quality.ordersWithoutCampaign}건 · 주문과 연결 안 된 환불 {perf.quality.returnsWithoutOrder}건</p>
                <p className="t-caption">긴급배송 추가비용과 CS 문의 비용은 원본에 항목도 데이터도 없어 계산에서 빠져 있어요. 그래서 실제보다 낙관적일 수 있어요.</p>
              </Card.Content>
            </Card>
          </>
        )}

        <p className="t-caption">지표의 정의·기준·주의사항은 <a className="text-primary" href="/model">데이터 모델</a> 화면에 있어요.</p>
      </div>
    </AppShell>
  )
}
