import { AiJudgmentPanel } from '@/components/AiJudgmentPanel'
import { fmtWon } from '@/lib/app/format'
import type { JudgmentInput } from '@/lib/modules/w02/judgment-input'
import type { SavedJudgment } from '@/lib/modules/w02/ai-store'
import type { MetricSet, ProfitabilityData, ShareCompare } from '@/lib/modules/w02/profitability'

// 수익성 검증 — 판단자가 의사결정을 쉽게 내리도록: ① 지표 비교표(공헌이익 줄은 색을 달리해 강조) ② AI 판단.
// AI 판단은 버튼을 눌렀을 때 Claude API 에 물어서 보여 준다.
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
const times = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}배`)

const ROWS: { key: keyof MetricSet; label: string; fmt: (m: MetricSet) => string; strong?: boolean; rankKey?: 'cp' | 'cpRate' | 'poas' | 'roas' }[] = [
  { key: 'cp', label: '실질 공헌이익', fmt: (m) => fmtWon(m.cp), strong: true, rankKey: 'cp' },
  { key: 'cpRate', label: '공헌이익률 (공헌이익 ÷ 순매출)', fmt: (m) => pct(m.cpRate), rankKey: 'cpRate' },
  { key: 'poas', label: '실질 ROAS (공헌이익 ÷ 광고비 · 손익분기 0배)', fmt: (m) => times(m.poas), rankKey: 'poas' },
  { key: 'roas', label: '명목 ROAS (GMV ÷ 광고비)', fmt: (m) => times(m.roas), rankKey: 'roas' },
]

export function ProfitabilityCard({
  data, stepLabel, isApprover = false, shares = null, judgmentInput = null, caseId, aiHash = '', aiSaved = null,
}: {
  data: ProfitabilityData
  /** 지금 진행 단계를 맡은 부서 이름 (예: 재무팀) */
  stepLabel: string
  /** 승인권자 화면이면 '보완요청하기' 대신 '재검토'로 돌려보내라고 안내한다 */
  isApprover?: boolean
  /** 요청 비중 vs 기존 집행 비중 (캠페인 집행 안건) */
  shares?: ShareCompare | null
  /** Claude 에게 보낼 입력 — 버튼을 누르면 이것으로 묻는다 */
  judgmentInput?: JudgmentInput | null
  /** AI 판단을 안건마다 저장·재사용하기 위한 값 (안건 번호, 지금 판단 자료의 해시, 저장된 판단) */
  caseId?: number
  aiHash?: string
  aiSaved?: SavedJudgment | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="t-caption">
        {data.subjectName} · 대상 값은 <strong>{data.basis ?? '자료 없음'}</strong> 기준이에요{data.basis === '제출 추정' ? ' (팀원이 넣은 추정값)' : data.basis === '기존 실적' ? ' (원본 자료로 계산)' : ''}.
      </p>

      {data.estimateMissing.length > 0 && data.missing.length === 0 && (
        <div className="flex flex-col gap-1 border border-danger p-2" style={{ borderRadius: 2 }}>
          <p className="t-small font-semibold text-danger">제출한 추계서의 공헌이익은 계산할 수 없어서 제외했어요</p>
          <p className="t-small">비어 있는 칸: {data.estimateMissing.join(', ')}. 0원으로 보고 계산하지 않았고, 아래 표의 비교·순위·AI 판단에는 쓰지 않았어요(표의 값은 기존 실적 기준이에요). 마케팅팀에 빈 칸을 보완해 달라고 요청하세요.</p>
        </div>
      )}

      {data.missing.length > 0 ? (
        <div className="flex flex-col gap-1 border border-danger p-2" style={{ borderRadius: 2 }}>
          <p className="t-small font-semibold text-danger">공헌이익을 구할 자료가 없어서 AI 판단을 하지 않았어요</p>
          {data.missing.map((m, i) => <p key={i} className="t-small">• {m}</p>)}
          <p className="t-small">
            원래 기안을 올린 <strong>마케팅팀</strong>에 누락된 자료를 보완해 달라고 요청해야 해요.{' '}
            {isApprover
              ? '승인권자는 재검토로 돌려보내 마케팅팀이 자료를 보완하게 해 주세요.'
              : <>지금 진행 단계를 맡은 <strong>{stepLabel}</strong>은 아래 <strong>보완요청하기</strong>를 눌러 마케팅팀에 알려 주세요.</>}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse t-small" style={{ minWidth: 520 }}>
              <thead>
                <tr className="bg-surface">
                  <th className="border border-default px-2 py-1 text-left">지표</th>
                  {data.columns.map((c, i) => (
                    <th key={c.label} className={`border border-default px-2 py-1 text-right ${i === 0 ? 'bg-primary-soft' : ''}`}>
                      {c.label}
                      {c.sub && <span className="block t-caption font-normal">{c.sub}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.key} className={r.strong ? 'bg-warning-soft font-semibold' : ''}>
                    <td className="border border-default px-2 py-1">
                      {r.label}
                      {r.strong && <span className="block t-caption font-normal">※ 이 줄만 보면 부정확해요 — 연 고정 피·성과 피가 빠져 있어요. 아래 비율 지표도 함께 보세요.</span>}
                    </td>
                    {data.columns.map((c, ci) => {
                      const rk = ci === 0 && r.rankKey && data.ranks ? data.ranks[r.rankKey] : null
                      return (
                        <td key={c.label} className="border border-default px-2 py-1 text-right">
                          {c.m ? r.fmt(c.m) : '—'}
                          {rk !== null && <span className="block t-small font-normal">{data.ranks?.n}{data.kind === 'influencer' ? '명' : '개'} 중 {rk}위</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {shares && shares.rows.length > 0 && <ShareTable shares={shares} />}

      {data.missing.length === 0 && judgmentInput && caseId !== undefined && (
        // key: 다른 안건을 열거나 저장된 판단·자료가 바뀌면 칸을 새로 만든다 (이전 안건의 판단이 남아 보이지 않도록)
        <AiJudgmentPanel key={`${caseId}:${aiHash}:${aiSaved?.createdAt ?? ''}`} caseId={caseId} input={judgmentInput} currentHash={aiHash} saved={aiSaved} />
      )}
    </div>
  )
}

const pc = (v: number) => `${(v * 100).toFixed(1)}%`

/** 이 기안의 인플루언서별 요청 비중과 지난 1년 집행 비중을 나란히 — 작년보다 비중이 얼마나 변했는지, 비중 순위가 실질 공헌이익 순위와 이어지는지(배분이 성과를 따라가는지) */
function ShareTable({ shares }: { shares: ShareCompare }) {
  const dir = shares.correlation === null ? null : shares.correlation <= -0.2 ? 'bad' : shares.correlation >= 0.2 ? 'good' : 'flat'
  const mineRows = shares.rows.filter((r) => r.influencerId === shares.subjectId)
  const Row = ({ r }: { r: ShareCompare['rows'][number] }) => {
    const mine = r.influencerId === shares.subjectId
    const diff = r.requestShare - r.spendShare
    return (
      <tr className={mine ? 'bg-primary-soft font-semibold' : ''}>
        <td className="border border-default px-2 py-1">{r.name}{mine ? ' (이 안건)' : ''}</td>
        <td className="border border-default px-2 py-1 text-right">{pc(r.requestShare)}</td>
        <td className="border border-default px-2 py-1 text-right">{pc(r.spendShare)}</td>
        <td className="border border-default px-2 py-1 text-right">{diff >= 0 ? '+' : '−'}{pc(Math.abs(diff))}p</td>
        <td className="border border-default px-2 py-1 text-right">{r.requestRank}위</td>
        <td className="border border-default px-2 py-1 text-right">{r.cpRank === null ? '—' : `${r.cpRank}위`}</td>
      </tr>
    )
  }
  const head = (
    <thead className="bg-surface">
      <tr>
        {['인플루언서', '이번 기안 요청 비중', '지난 1년 집행 비중', '차이', '요청 비중 순위', '실질 공헌이익 순위'].map((h, i) => (
          <th key={h} className={`border border-default px-2 py-1 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
        ))}
      </tr>
    </thead>
  )
  return (
    <div className="flex flex-col gap-2 border border-default p-2" style={{ borderRadius: 2 }}>
      <p className="t-small font-semibold">요청 비중 vs 기존 집행 비중 <span className="t-caption font-normal">(금액이 아니라 비중)</span></p>
      {dir && (
        <p className="t-small">
          {dir === 'bad' && <>요청 비중이 큰 인플루언서일수록 실질 공헌이익은 오히려 낮아요 (순위 상관 {shares.correlation?.toFixed(2)}). 지난 1년과 같은 원칙으로 배분했다면 이 문제는 이 기안만이 아니라 연간 예산 전체에서 반복돼요.</>}
          {dir === 'good' && <>요청 비중이 큰 인플루언서일수록 실질 공헌이익도 높아요 (순위 상관 {shares.correlation?.toFixed(2)}). 배분이 성과를 따라가고 있어요.</>}
          {dir === 'flat' && <>요청 비중과 실질 공헌이익 순위 사이에 뚜렷한 방향이 없어요 (순위 상관 {shares.correlation?.toFixed(2)}).</>}
          {shares.invertedTop.length > 0 && <> 요청 비중은 상위인데 실질 공헌이익은 하위인 인플루언서: <strong>{shares.invertedTop.join(', ')}</strong>.</>}
        </p>
      )}
      {/* 맨 위에는 이번 안건의 대상 1명만, 전체 보기를 누르면 대상을 포함한 모두 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse t-small" style={{ minWidth: 520 }}>
          {head}
          <tbody>{mineRows.map((r) => <Row key={r.influencerId} r={r} />)}</tbody>
        </table>
      </div>
      <details>
        <summary className="cursor-pointer t-small underline">전체 {shares.rows.length}명 보기</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse t-small" style={{ minWidth: 520 }}>
            {head}
            <tbody>{shares.rows.map((r) => <Row key={r.influencerId} r={r} />)}</tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
