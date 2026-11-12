import { Pill } from '@/components/bits'
import { fmtWon } from '@/lib/app/format'
import type { Judgment } from '@/lib/modules/w02/ai-judgment'
import type { MetricSet, ProfitabilityData } from '@/lib/modules/w02/profitability'

// 수익성 검증 — 판단자가 의사결정을 쉽게 내리도록: ① 지표 비교표(공헌이익 줄은 색을 달리해 강조) ② AI 판단.
// AI 판단은 아직 AI API 를 연결하지 않아서 규칙으로 흉내 낸 시험용 결과다.
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
const times = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}배`)

const ROWS: { key: keyof MetricSet; label: string; fmt: (m: MetricSet) => string; strong?: boolean }[] = [
  { key: 'cp', label: '실질 공헌이익', fmt: (m) => fmtWon(m.cp), strong: true },
  { key: 'cpRate', label: '공헌이익률 (공헌이익 ÷ 순매출)', fmt: (m) => pct(m.cpRate) },
  { key: 'poas', label: '실질 ROAS = POAS (공헌이익 ÷ 광고비)', fmt: (m) => times(m.poas) },
  { key: 'roas', label: '명목 ROAS (GMV ÷ 광고비)', fmt: (m) => times(m.roas) },
  { key: 'returnRate', label: '반품률', fmt: (m) => pct(m.returnRate) },
]

const TONE: Record<string, 'success' | 'danger' | 'warning'> = { good: 'success', bad: 'danger', caution: 'warning' }

export function ProfitabilityCard({
  data, judgment, stepLabel, isApprover = false,
}: {
  data: ProfitabilityData
  judgment: Judgment
  /** 지금 진행 단계를 맡은 부서 이름 (예: 재무팀) */
  stepLabel: string
  /** 승인권자 화면이면 '보완요청하기' 대신 '재검토'로 돌려보내라고 안내한다 */
  isApprover?: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="t-caption">
        {data.subjectName} · 대상 값은 <strong>{data.basis ?? '자료 없음'}</strong> 기준이에요{data.basis === '제출 추정' ? ' (팀원이 넣은 추정값)' : data.basis === '기존 실적' ? ' (원본 자료로 계산)' : ''}.
      </p>

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
                    {data.columns.map((c) => (
                      <td key={c.label} className="border border-default px-2 py-1 text-right">{c.m ? r.fmt(c.m) : '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data.rank || data.spendShare) && (
            <p className="t-caption">
              {data.rank ? `실질 공헌이익 순위 ${data.rank.n}${data.kind === 'influencer' ? '명' : '개'} 중 ${data.rank.cp}위` : ''}
              {data.rank && data.spendShare ? ' · ' : ''}
              {data.spendShare ? `광고비 집행 비중 ${(data.spendShare.share * 100).toFixed(1)}% (${data.spendShare.n}명 중 ${data.spendShare.rank}위)` : ''}
            </p>
          )}
        </>
      )}

      {judgment.status === 'ok' && (
        <div className="flex flex-col gap-2 border border-default p-2">
          <p className="t-small font-semibold">AI 판단 <span className="t-caption font-normal">(시험용 — 아직 AI API를 연결하지 않아 규칙으로 흉내 낸 결과예요)</span></p>
          {judgment.lines.map((l, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="shrink-0"><Pill color={TONE[l.tone]}>{l.label}</Pill></span>
              <span className="t-small">{l.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
