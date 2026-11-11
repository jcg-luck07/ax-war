import type { ReactNode } from 'react'

// 서로 다른 내용의 항목을 번호로 나누어 보여 준다 — 번호 옆에 제목, 그 아래는 들여쓰고, 항목 사이는 한 줄 띄운다.
// 화면의 모든 설명 상자(같이 봐야 할 점·다음 행동·단계 상세 …)가 이 모양을 같이 쓴다.
export function NumberedList({ items, start = 1 }: { items: { key?: string; title: ReactNode; body?: ReactNode }[]; start?: number }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((it, i) => (
        <li key={it.key ?? i} className="flex gap-2">
          <span className="w-5 shrink-0 t-small font-semibold">{start + i}.</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="t-small font-semibold">{it.title}</div>
            {it.body}
          </div>
        </li>
      ))}
    </ol>
  )
}
