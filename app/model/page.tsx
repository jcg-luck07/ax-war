import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { Pill } from '@/components/bits'
import { MASIL_MODEL } from '@/lib/semantic/model'

export const dynamic = 'force-dynamic'

const SCALE_COLOR = { 풀스케일: 'success', '대표 표본': 'warning', 마스터: 'default', 계산: 'default' } as const

export default function ModelPage() {
  const m = MASIL_MODEL
  const entities = Object.values(m.entities)
  const relations = entities.flatMap((e) => Object.entries(e.relations ?? {}).map(([name, r]) => ({ from: e, name, r })))
  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader
          title="데이터 모델 (시맨틱 레이어)"
          description="화면과 판단이 읽는 업무 대상·관계·측정값·지표의 정의가 이 한 곳에 있어요. 지표를 바꾸려면 여기(lib/semantic/model.ts)만 고치면 모든 화면에 반영돼요."
        />

        <Card>
          <Card.Header>
            <Card.Title>지표 ({Object.keys(m.metrics).length}개)</Card.Title>
            <Card.Description>측정값을 식으로 조합한 값이에요. 기준·출처·주의사항을 같이 적어 둬요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            {Object.values(m.metrics).map((x) => (
              <div key={x.id} className="flex flex-col gap-1 border-b border-default pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="t-small font-semibold">{x.label}</span>
                  <Pill color={x.origin === '원본 정의' ? 'success' : 'warning'}>{x.origin}</Pill>
                  <span className="t-caption">{x.unit}</span>
                </div>
                <span className="t-small">{x.formula}</span>
                <span className="t-caption">기준: {x.basis}</span>
                <span className="t-caption">출처: {x.sources.join(', ')}</span>
                {x.caveats?.map((c) => <span key={c} className="t-caption">· {c}</span>)}
              </div>
            ))}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>측정값 ({Object.keys(m.measures).length}개)</Card.Title>
            <Card.Description>한 대상(기준 엔티티)의 행을 세거나 더하는 단위 계산이에요. 기준이 다른 측정값은 따로 집계한 뒤 합쳐서 행이 부풀지 않아요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {Object.values(m.measures).map((x) => (
              <div key={x.id} className="flex flex-col gap-0.5">
                <span className="t-small"><strong>{x.label}</strong> <span className="t-caption">· 기준 {m.entities[x.entity].label} · {x.agg === 'sum' ? '합계' : '건수'} · {x.unit}</span></span>
                <span className="t-caption">{x.description}</span>
              </div>
            ))}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>업무 대상 (엔티티 {entities.length}개)</Card.Title>
            <Card.Description>원본 CSV 한 파일 = 한 대상. 규모 표시가 &lsquo;대표 표본&rsquo;이면 순위·비중·방향에만 쓰고 전사 금액과 섞지 않아요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-5">
            {entities.map((e) => (
              <div key={e.id} className="flex flex-col gap-1 border-b border-default pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="t-small font-semibold">{e.label}</span>
                  <Pill color={SCALE_COLOR[e.scale]}>{e.scale}</Pill>
                  <span className="t-caption">한 행 = {e.grain}</span>
                </div>
                <span className="t-caption">{e.kind === 'source' ? `원본: ${e.source}` : `${m.entities[e.from].label} 을(를) ${e.groupBy.join(', ')} 별로 묶은 값`}</span>
                <span className="t-caption">
                  열: {Object.entries(e.kind === 'source' ? e.columns : e.columns).map(([k, c]) => `${c.label}(${k})`).join(' · ')}
                </span>
                {e.kind === 'source' && Object.values(e.columns).filter((c) => c.note).map((c) => <span key={c.label} className="t-caption">· {c.label}: {c.note}</span>)}
              </div>
            ))}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>관계 ({relations.length}개)</Card.Title>
            <Card.Description>&ldquo;이 행은 저 행 하나에 속한다&rdquo;를 따라가면 주문 → 캠페인 → 인플루언서처럼 이어서 볼 수 있어요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-1">
            {relations.map(({ from, name, r }) => (
              <span key={`${from.id}.${name}`} className="t-small">
                {from.label} → {m.entities[r.to].label} <span className="t-caption">({Object.entries(r.on).map(([a, b]) => `${a} = ${b}`).join(', ')}) · {r.label}</span>
              </span>
            ))}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>계산 가정</Card.Title>
            <Card.Description>원본에 없어서 가정한 값이에요. 바꿔서 다시 계산할 수 있어요 (인플루언서 성과 화면).</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-2">
            {Object.values(m.parameters).map((p) => (
              <span key={p.id} className="t-small">{p.label}: 기본 {p.default} <span className="t-caption">— {p.note}</span></span>
            ))}
          </Card.Content>
        </Card>
      </div>
    </AppShell>
  )
}
