// 업무 흐름 선언. 모양은 W02.bpmn / W02.svg(교육용 현재 업무)를 따른다:
//   업무 발생(동그라미) → 안건 접수 → 성과·비용표 취합(재무) → 계약조건·기한 확인(계약 담당) → 승인됐는가?(마름모, 승인권자)
//   → 예: 승인 후속 작업 → 종료 / 아니오: 기한 전 재검토 → 종료
// 표기: 동그라미 = 시작·종료, 둥근 사각형 = 활동, 마름모 = 조건 분기. 가로 구역 = 담당 역할.
// W02.bpmn 의 단계와 역할은 주최 측의 교육용 가정이다(세계관_BPMN/W02.html). 원본에 없는 단계(보류 사유 확인 등)는 우리가 더한 것이다.
import type { FlowDef } from './types'
import { CATEGORY_LABEL } from '@/lib/app/labels'

const CONTRACT_LANES = [
  { id: 'marketing', label: '마케팅' },
  { id: 'finance', label: '재무팀' },
  { id: 'contract', label: '계약 담당' },
  { id: 'approver', label: '승인권자' },
]

export const CONTRACT_FLOW: FlowDef = {
  id: 'contract_renewal',
  title: CATEGORY_LABEL.influencer,
  caseTypes: ['w02.contract_renewal'],
  description: '통보 기한 안에 갱신안을 상신하고, 결과를 상대방에 알려야 해요. 기한을 넘기면 동일 조건으로 자동 갱신(체결로 간주)돼요.',
  lanes: CONTRACT_LANES,
  nodes: [
    { id: 'start', kind: 'start', label: '업무 발생', lane: 'marketing', col: 0, bind: { t: 'start' } },
    { id: 'accept', kind: 'task', label: '안건 접수', lane: 'marketing', col: 1, bind: { t: 'accept' } },
    { id: 'collect', kind: 'task', label: '성과·비용표 취합', lane: 'finance', col: 2, bind: { t: 'prep', key: 'collect-performance', infoKeys: ['info:', 'finance-shift-settlement'] } },
    { id: 'confirm', kind: 'task', label: '계약조건·기한 확인', lane: 'contract', col: 3, bind: { t: 'prep', key: 'confirm-terms' } },
    { id: 'decide', kind: 'gateway', label: '갱신안이 승인됐는가?', lane: 'approver', col: 4, bind: { t: 'decision' } },
    { id: 'doc', kind: 'task', label: '승인조건 문서화', lane: 'contract', col: 5, bind: { t: 'task', key: 'doc-conditions', branch: 'approved' } },
    { id: 'notify', kind: 'task', label: '상대방에 결과 통보', lane: 'marketing', col: 6, bind: { t: 'task', key: 'notify-counterparty', branch: 'approved' }, hint: '기한 전' },
    { id: 'record', kind: 'task', label: '통보·회신 기록 보관', lane: 'contract', col: 7, bind: { t: 'task', key: 'record-reply', branch: 'approved' } },
    { id: 'endOk', kind: 'end', label: '통보 기록', lane: 'contract', col: 8, bind: { t: 'end', branch: 'approved' } },
    { id: 'rethink', kind: 'task', label: '기한 전 재검토', lane: 'marketing', col: 5, bind: { t: 'task', key: 'rethink-before-deadline', branch: 'rejected' } },
    { id: 'watch', kind: 'task', label: '통보 기한 모니터링', lane: 'contract', col: 5, row: 1, bind: { t: 'task', key: 'watch-deadline', branch: 'rejected' }, hint: '미결정이면 자동 갱신' },
    { id: 'endNo', kind: 'end', label: '재검토 종료', lane: 'marketing', col: 6, row: 1, bind: { t: 'end', branch: 'rejected' } },
    { id: 'holdReason', kind: 'task', label: '보류 사유 확인', lane: 'approver', col: 5, bind: { t: 'task', key: 'hold-reason', branch: 'on_hold' }, hint: '우리가 더한 단계' },
  ],
  edges: [
    { from: 'start', to: 'accept' },
    { from: 'accept', to: 'collect' },
    { from: 'collect', to: 'confirm' },
    { from: 'confirm', to: 'decide' },
    { from: 'decide', to: 'doc', label: '예', when: 'approved' },
    { from: 'doc', to: 'notify' },
    { from: 'notify', to: 'record' },
    { from: 'record', to: 'endOk' },
    { from: 'decide', to: 'rethink', label: '아니오', when: 'rejected' },
    { from: 'decide', to: 'watch', label: '아니오', when: 'rejected' },
    { from: 'rethink', to: 'endNo' },
    { from: 'decide', to: 'holdReason', label: '보류', when: 'on_hold' },
  ],
}

export const EXPANSION_FLOW: FlowDef = {
  id: 'campaign_expansion',
  title: CATEGORY_LABEL.campaign,
  caseTypes: ['w02.campaign_expansion'],
  description: '집행 예정일이 현금 하회 구간 안이면 금액이 작아도 CEO/이사회 승인이 필요해요. 계약 확정기한을 넘기면 자동 확정돼요.',
  lanes: CONTRACT_LANES,
  nodes: [
    { id: 'start', kind: 'start', label: '업무 발생', lane: 'marketing', col: 0, bind: { t: 'start' } },
    { id: 'accept', kind: 'task', label: '안건 접수', lane: 'marketing', col: 1, bind: { t: 'accept' } },
    { id: 'collect', kind: 'task', label: '성과·비용표 취합', lane: 'finance', col: 2, bind: { t: 'prep', key: 'collect-performance', infoKeys: ['info:', 'finance-shift-settlement'] }, hint: '300억 연결·집행일 회신 포함' },
    { id: 'confirm', kind: 'task', label: '계약 확정기한·전속계약 확인', lane: 'contract', col: 3, bind: { t: 'prep', key: 'confirm-terms' } },
    { id: 'decide', kind: 'gateway', label: '기안이 승인됐는가?', lane: 'approver', col: 4, bind: { t: 'decision' } },
    { id: 'prepare', kind: 'task', label: '집행 준비', lane: 'marketing', col: 5, bind: { t: 'task', key: 'prepare-execution', branch: 'approved' } },
    { id: 'cashLine', kind: 'task', label: '현금 재전망에 반영', lane: 'finance', col: 5, bind: { t: 'task', key: 'finance-cash-line', branch: 'approved' } },
    { id: 'report', kind: 'task', label: '그룹 보고', lane: 'marketing', col: 6, bind: { t: 'task', key: 'group-report', branch: 'approved' }, hint: '총액 1억 초과 시' },
    { id: 'endOk', kind: 'end', label: '집행 확정', lane: 'marketing', col: 7, bind: { t: 'end', branch: 'approved' } },
    { id: 'rethinkAlloc', kind: 'task', label: '예산 배분 재검토', lane: 'marketing', col: 5, row: 1, bind: { t: 'task', key: 'rethink-allocation', branch: 'rejected' }, hint: '제안 · 표본 한계' },
    { id: 'checkContract', kind: 'task', label: '전속계약은 별개 결정 확인', lane: 'contract', col: 5, bind: { t: 'task', key: 'check-contract', branch: 'rejected' } },
    { id: 'endNo', kind: 'end', label: '재검토 종료', lane: 'marketing', col: 6, row: 1, bind: { t: 'end', branch: 'rejected' } },
    { id: 'holdReason', kind: 'task', label: '보류 사유 확인', lane: 'approver', col: 5, bind: { t: 'task', key: 'hold-reason', branch: 'on_hold' }, hint: '우리가 더한 단계' },
  ],
  edges: [
    { from: 'start', to: 'accept' },
    { from: 'accept', to: 'collect' },
    { from: 'collect', to: 'confirm' },
    { from: 'confirm', to: 'decide' },
    { from: 'decide', to: 'prepare', label: '예', when: 'approved' },
    { from: 'decide', to: 'cashLine', label: '예', when: 'approved' },
    { from: 'prepare', to: 'report' },
    { from: 'report', to: 'endOk' },
    { from: 'decide', to: 'rethinkAlloc', label: '아니오', when: 'rejected' },
    { from: 'decide', to: 'checkContract', label: '아니오', when: 'rejected' },
    { from: 'rethinkAlloc', to: 'endNo' },
    { from: 'decide', to: 'holdReason', label: '보류', when: 'on_hold' },
  ],
}

export const FLOWS: FlowDef[] = [CONTRACT_FLOW, EXPANSION_FLOW]

export const flowForCaseType = (caseType: string): FlowDef | undefined => FLOWS.find((f) => f.caseTypes.includes(caseType))
