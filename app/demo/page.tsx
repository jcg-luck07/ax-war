import Link from 'next/link'
import { Card, buttonVariants } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { BulkAnswerButtons, DemoControls } from '@/components/case-actions'
import { getEngine } from '@/lib/app/engine'
import { listCases } from '@/lib/engine/engine'

export const dynamic = 'force-dynamic'

export default async function DemoPage() {
  const { sql } = await getEngine()
  const cases = await listCases(sql)
  const contract = cases.find((c) => c.caseType === 'w02.contract_renewal')
  const plan = cases.find((c) => c.caseType === 'w02.campaign_expansion' && c.payload.evaluation && (c.payload.evaluation as { facts?: Record<string, unknown> }).facts?.in_cash_breach_window === true)

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader title="시연 도구" description="안건을 불러오고, 모의 회신을 넣고, 처음 상태로 되돌려 같은 시연을 반복할 수 있어요." />

        <Card>
          <Card.Header>
            <Card.Title>1. 준비</Card.Title>
            <Card.Description>
              현재 안건 {cases.length}개. 원본 CSV는 읽기만 하고, 여기서 만드는 안건·승인·작업은 별도 테이블에 저장돼요. 초기화해도 원본 복사본은 그대로예요.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <DemoControls />
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>2. 세 가지 상황 따라 하기</Card.Title>
            <Card.Description>각 단계의 결과는 안건 화면의 &lsquo;이력&rsquo;과 &lsquo;후속 작업&rsquo;에 그대로 남아요.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="t-small font-semibold">상황 1 · 정상</p>
              <p className="t-small">
                혜인 전속계약(연 28억 원)이 접수되고 규칙집이 CEO/이사회 승인을 요구해요. 낮은 권한(Masil 대표)으로 승인을 눌러 거부되는 것을 확인한 뒤 CEO/이사회로 승인하면, 통보·문서화·기록 작업이 생겨요. 작업을 모두 완료하면 안건이 닫혀요.
              </p>
              {contract && <div><Link className={buttonVariants({ size: 'sm' })} href={`/cases/${contract.id}`}>전속계약 안건 열기</Link></div>}
            </div>
            <div className="flex flex-col gap-2">
              <p className="t-small font-semibold">상황 2 · 조건 변경</p>
              <p className="t-small">
                같은 안건(승인 전)에서 &lsquo;조건 변경&rsquo;에 고정 피 <strong>20</strong>(억)을 넣으면 여전히 10억 원 초과라 <strong>결론이 유지</strong>돼요. 이어서 <strong>8</strong>을 넣으면 Masil 대표 전결이 되려 하지만 현금 유출일과 300억 연결 여부를 모르므로 확정하지 않고 재무에 확인을 요청해요.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="t-small font-semibold">상황 3 · 정보 부족 / 승인 거절</p>
              <p className="t-small">
                확인 요청에 모의 회신을 넣으면 이어서 재평가돼요 (예: 고정 피 지급일 2026-09-15 → 구간 밖, 2026-07-28 → 구간 안이라 그룹 CEO). 기안은 한꺼번에 회신하는 도구가 아래에 있어요. 대표가 기안을 부결하면 재검토 작업이 생기고 전속계약은 별개 결정이라는 확인 작업이 함께 생겨요.
              </p>
              {plan && <div><Link className={buttonVariants({ size: 'sm', variant: 'outline' })} href={`/cases/${plan.id}`}>현금 하회 구간 안의 기안 열기 (재무 영향 시연)</Link></div>}
            </div>
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>3. 기안 묶음에 한꺼번에 회신</Card.Title>
            <Card.Description>
              &lsquo;이 기안이 그룹 300억 배분 사업과 연결되나요?&rsquo;는 25건이 같은 질문이에요 (회의에서 정리되지 않은 사항). 모의 회신을 한 번만 넣으면 열린 확인 요청 전부에 반영돼요. 가상 입력으로 기록돼요.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <BulkAnswerButtons />
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>실제 작동 · 모의 처리 · 설계 단계</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-1">
            <p className="t-small">• 실제 작동: 안건 접수, 규칙 판정, 승인 요청·결정, 후속 작업 생성, 상태 변경, 이력, 재평가, 지표·현금 계산 (원본 데이터 기준)</p>
            <p className="t-small">• 모의 처리: 상대방 통보, 재무·계약 담당의 회신, 발주 전달 (실제로 보내지 않음, 가상 입력으로 표시)</p>
            <p className="t-small">• 설계 단계: 재고 발주 외 다른 업무로의 확장, 법무 서명 절차</p>
          </Card.Content>
        </Card>
      </div>
    </AppShell>
  )
}
