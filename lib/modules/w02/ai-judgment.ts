// AI 판단 (시험용) — 아직 AI API 를 연결하지 않아서, 같은 입력·같은 출력 모양으로 규칙이 흉내 낸다.
// 나중에 서버에서 AI API 를 부르는 함수로 `judge` 만 바꿔 끼우면 화면은 그대로 쓸 수 있다.
//
// 지키는 약속 (AI 프롬프트와 같다):
//  · 3~4줄. 줄 앞에 "좋음 n점" / "나쁨 n점" / "주의할 점"을 붙인다. 점수는 0~100 정수이고, 불확실한 요소(주의할 점)는 점수를 깎는다.
//    좋음·나쁨·주의할 점은 꼭 하나씩 있어야 하는 것이 아니고 필요에 따라 없거나 여러 번 나올 수 있다.
//  · 실질 공헌이익, ROAS(POAS), 공헌이익률을 반드시 근거로 제시한다.
//  · 비교 대상과 수치가 비슷해서 판단이 바뀌지 않는 지표는 적지 않는다(수치 남발 금지).
//  · 지표의 한계(연 전속 고정 피·성과 피가 공헌이익에 빠져 있는 것 등)도 판단에 넣는다.
//  · 공헌이익을 구하는 데 필요한 자료가 없으면 판단하지 않고, 원래 보고자(마케팅)에게 보완을 요청하라고 알린다.
import { fmtWon } from '@/lib/app/format'
import type { MetricSet, ProfitabilityData } from './profitability'

export interface JudgmentLine {
  tone: 'good' | 'bad' | 'caution'
  /** "좋음 82점" / "나쁨 41점" / "주의할 점" */
  label: string
  text: string
}

export type Judgment =
  | { status: 'ok'; lines: JudgmentLine[] }
  | { status: 'missing'; missing: string[] }

export interface JudgmentContext {
  /** 계약서에 적힌 연 전속 고정 피(원). 모르면 null */
  fixedFeeKrw?: number | null
  /** 연 예상 성과 피(원). 모르면 null */
  performanceFeeKrw?: number | null
  /** 성과 피 비율을 아직 모른다 */
  performanceRateUnknown?: boolean
}

const pct = (v: number | null) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`)
const x = (v: number | null) => (v === null ? '-' : `${v.toFixed(2)}배`)
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** 두 값이 판단을 바꿀 만큼 다른가 (상대 15% 이상 차이) */
function differs(a: number | null, b: number | null, rel = 0.15): boolean {
  if (a === null || b === null) return false
  const base = Math.max(Math.abs(a), Math.abs(b))
  return base > 0 && Math.abs(a - b) / base >= rel
}

/** 비교 묶음 중 대상과 판단이 달라질 만큼 다른 것만, 차이가 큰 순서로 최대 2개를 짧게 적는다 (비슷한 수치는 적지 않는다) */
function contrastText(m: MetricSet, groups: ProfitabilityData['groups']): string {
  const scored = groups
    .map((g) => {
      const bits: string[] = []
      if (differs(m.cp, g.m.cp)) bits.push(fmtWon(g.m.cp))
      if (differs(m.poas, g.m.poas)) bits.push(`POAS ${x(g.m.poas)}`)
      if (differs(m.cpRate, g.m.cpRate)) bits.push(`공헌이익률 ${pct(g.m.cpRate)}`)
      const gap = Math.abs(m.cp - g.m.cp) / Math.max(1, Math.abs(g.m.cp), Math.abs(m.cp))
      return { g, bits, gap }
    })
    .filter((s) => s.bits.length > 0)
    .sort((p, q) => q.gap - p.gap)
    .slice(0, 2)
  return scored.map((s) => `${s.g.short} 평균 ${s.bits.join(' · ')}`).join(', ')
}

export function mockJudge(d: ProfitabilityData, ctx: JudgmentContext = {}): Judgment {
  const m = d.columns[0]?.m ?? null
  // 공헌이익을 구하는 데 필요한 자료가 없으면 판단하지 않는다
  if (d.missing.length > 0 || !m) return { status: 'missing', missing: d.missing.length ? d.missing : ['공헌이익을 구할 자료가 없어요'] }

  // ── 불확실한 요소(주의할 점) 모으기 — 우선순위 순
  const cautions: string[] = []
  const fixedKnown = (ctx.fixedFeeKrw ?? 0) > 0
  const feeKind = d.subjectFeeType ?? ''
  if (fixedKnown || feeKind.includes('고정')) {
    cautions.push(`공헌이익에는 연 고정 피${fixedKnown ? `(${fmtWon(ctx.fixedFeeKrw)})` : ''}${feeKind.includes('성과') || (ctx.performanceFeeKrw ?? 0) > 0 ? '와 성과 피' : ''}가 빠져 있어 실제보다 높게 나온 값이에요. 이 지표만 믿으면 안 돼요.`)
  } else if (feeKind.includes('성과') || (ctx.performanceFeeKrw ?? 0) > 0) {
    cautions.push(`공헌이익에는 성과 피가 빠져 있어 실제보다 높게 나온 값이에요${ctx.performanceRateUnknown ? '(성과 피 비율도 아직 몰라요)' : ''}.`)
  }
  if (d.feeMix && d.feeMix.fixed > 0 && (d.feeMix.perf > 0 || d.feeMix.mixed > 0)) {
    cautions.push(`비교 대상에 고정 피 계약 ${d.feeMix.fixed}명과 성과·혼합 피 계약 ${d.feeMix.perf + d.feeMix.mixed}명이 섞여 있어 같은 잣대가 아니에요.`)
  }
  cautions.push(d.basis === '제출 추정' ? '팀원이 넣은 추정값이라 실제 성과와 다를 수 있어요.' : '대표 표본 자료라 순위·방향만 참고하고 금액으로 환산하지 마세요.')
  const nMin = Math.min(...d.groups.map((g) => g.n))
  if (d.groups.length > 0 && nMin < 3) cautions.push(`비교 대상이 ${nMin}개뿐이라 참고만 하세요.`)
  const shownCautions = cautions.slice(0, 2)
  const penalty = Math.min(30, cautions.length * 8) // 불확실한 요소가 많을수록 좋음·나쁨 점수를 깎는다

  const lines: JudgmentLine[] = []
  const pctile = d.percentile
  const basisClause = `실질 공헌이익 ${fmtWon(m.cp)} · POAS ${x(m.poas)} · 공헌이익률 ${pct(m.cpRate)}`
  const contrast = contrastText(m, d.groups)
  const unit = d.kind === 'influencer' ? '명' : '개'
  const rankText = d.rank ? `전체 ${d.rank.n}${unit} 중 ${d.rank.cp}위` : ''

  const cpGood = m.cp > 0 && (pctile === null || pctile >= 0.5)
  if (cpGood) {
    const base = pctile === null ? 60 : 50 + 50 * pctile
    lines.push({ tone: 'good', label: `좋음 ${clamp(base - penalty)}점`, text: `${basisClause}${rankText ? ` — ${d.kind === 'influencer' ? '인플루언서' : '캠페인'} ${rankText}` : ''}.${contrast ? ` 비교: ${contrast}.` : ''}` })
  } else {
    const base = m.cp < 0 ? Math.max(70, 100 * (1 - (pctile ?? 0))) : 100 * (1 - (pctile ?? 0.5))
    lines.push({ tone: 'bad', label: `나쁨 ${clamp(base - penalty)}점`, text: `${basisClause}${rankText ? ` — ${d.kind === 'influencer' ? '인플루언서' : '캠페인'} ${rankText}` : ''}${m.cp < 0 ? ', 광고비보다 공헌이익이 적어 손실이에요' : ''}.${contrast ? ` 비교: ${contrast}.` : ''}` })
  }

  // 인플루언서: 광고비를 많이 쓰는데 성과는 낮은 경우(배분 방향)
  if (d.spendShare && d.rank && d.spendShare.rank <= Math.ceil(d.spendShare.n / 3) && d.rank.cp > Math.floor((2 * d.rank.n) / 3)) {
    lines.push({
      tone: 'bad',
      label: `나쁨 ${clamp(70 - penalty / 2)}점`,
      text: `광고비 집행 비중은 ${pct(d.spendShare.share)}(${d.spendShare.n}명 중 ${d.spendShare.rank}위)로 높은데 공헌이익 순위는 ${d.rank.cp}위로 낮아, 광고비가 성과와 반대 방향으로 쓰이고 있어요.`,
    })
  } else {
    // 효율(POAS)이 비교 대상과 크게 다르면 공헌이익 신호와 따로 한 줄
    const ref = d.groups[0]
    if (ref && differs(m.poas, ref.m.poas, 0.3) && m.poas !== null && ref.m.poas !== null) {
      const better = m.poas > ref.m.poas
      if (better !== cpGood) {
        lines.push({
          tone: better ? 'good' : 'bad',
          label: `${better ? '좋음' : '나쁨'} ${clamp(better ? 55 - penalty / 2 : 60 - penalty / 2)}점`,
          text: `광고비 대비 효율(POAS)은 ${x(m.poas)}로 ${ref.label}(${x(ref.m.poas)})보다 ${better ? '높아' : '낮아'} 공헌이익 금액과 방향이 달라요.`,
        })
      }
    }
  }
  for (const c of shownCautions) lines.push({ tone: 'caution', label: '주의할 점', text: c })
  return { status: 'ok', lines: lines.slice(0, 4) }
}
