import { Card } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ax'
import { ContractNoticeForm, ImportPlansButton, PurchaseRequestForm } from '@/components/case-actions'
import { getEngine } from '@/lib/app/engine'
import { canWork, currentUser } from '@/lib/app/auth'
import { fmtWon } from '@/lib/app/format'
import { pendingExpansionPlans } from '@/lib/modules/w02/intake'
import { CONTRACT_NOTICE } from '@/lib/modules/w02/contract-notice'

export const dynamic = 'force-dynamic'

export default async function IntakePage() {
  const { sql } = await getEngine()
  const user = await currentUser(sql)
  const { all, fresh } = await pendingExpansionPlans(sql).catch(() => ({ all: [], fresh: [] }))
  const freshTotal = fresh.reduce((s, p) => s + Number(p.requested_budget_krw), 0)

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <PageHeader title="안건 접수" description="새 결정거리를 받아요. 접수하면 바로 규칙집이 평가해서 누구의 승인이 필요한지, 모르는 사실이 있는지 알려 줘요." />

        {!canWork(user) && (
          <Card>
            <Card.Content>
              <p className="t-small">접수하려면 역할이 필요해요. 관리자에게 역할 부여를 요청하세요.</p>
            </Card.Content>
          </Card>
        )}

        <Card>
          <Card.Header>
            <Card.Title>1. 캠페인 확대 기안</Card.Title>
            <Card.Description>
              마케팅팀이 올린 기안(02_masil/marketing/mkt_budget_plan_ms.csv) 전체 {all.length}건 중 아직 접수하지 않은 건을 한꺼번에 접수해요. 이미 접수한 기안은 건너뛰어요.
            </Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            <p className="t-small">접수 대기 {fresh.length}건{fresh.length > 0 ? ` · 요청액 합계 ${fmtWon(freshTotal)}` : ''}</p>
            {canWork(user) ? <div><ImportPlansButton fresh={fresh.length} /></div> : null}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>2. 전속계약 갱신 통보</Card.Title>
            <Card.Description>
              통보서의 내용을 입력해요. 기본값은 {CONTRACT_NOTICE.influencerName}({CONTRACT_NOTICE.influencerId}) 통보서({CONTRACT_NOTICE.sourceFile}) 기준이에요. 통보 기한 안에 결정하지 않으면 동일 조건으로 자동 갱신돼요.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            {canWork(user) ? (
              <ContractNoticeForm
                defaults={{
                  influencerId: CONTRACT_NOTICE.influencerId,
                  annualFixedFeeEok: String(CONTRACT_NOTICE.annualFixedFeeKrw / 100_000_000),
                  notifyDeadline: CONTRACT_NOTICE.notifyDeadline,
                  currentExpiry: CONTRACT_NOTICE.currentExpiry,
                }}
              />
            ) : (
              <p className="t-small">역할이 있는 사람만 접수할 수 있어요.</p>
            )}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>3. 재고 발주 승인 요청</Card.Title>
            <Card.Description>평시에는 SCM 이 승인하고, 대금 지급일이 현금 하회 예상 구간 안이면 그룹 CEO 승인이 우선해요. 지급일을 모르면 재무에 확인을 요청해요.</Card.Description>
          </Card.Header>
          <Card.Content>{canWork(user) ? <PurchaseRequestForm /> : <p className="t-small">역할이 있는 사람만 접수할 수 있어요.</p>}</Card.Content>
        </Card>
      </div>
    </AppShell>
  )
}
