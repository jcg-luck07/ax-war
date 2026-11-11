import { redirect } from 'next/navigation'

// 안건은 안건 목록 화면의 아래쪽에서 보여 준다. 예전 주소는 그쪽으로 보낸다.
export default async function CaseRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/cases?id=${encodeURIComponent(id)}`)
}
