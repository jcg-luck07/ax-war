// 서버 페이지에서 반복해 쓰는 작은 조각 (상태 알약 · 데이터 성격 알약).
import { Chip } from '@heroui/react'
import { ORIGIN, STATUS, type ChipColor } from '@/lib/app/format'

export function Pill({ color, children }: { color: ChipColor; children: string }) {
  return (
    <Chip color={color} size="sm">
      <Chip.Label>{children}</Chip.Label>
    </Chip>
  )
}

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, color: 'default' as ChipColor }
  return <Pill color={s.color}>{s.label}</Pill>
}

export function OriginPill({ origin }: { origin: string }) {
  const o = ORIGIN[origin] ?? { label: origin, color: 'default' as ChipColor }
  return <Pill color={o.color}>{o.label}</Pill>
}
