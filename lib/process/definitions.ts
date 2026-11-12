// 업무 흐름 선언. 모양은 W02.bpmn / W02.svg(교육용 현재 업무)를 따른다:
//   업무 발생(동그라미) → 기안 접수 → 성과·비용표 취합(재무) → 계약조건·기한 확인(계약 담당) → 승인됐는가?(마름모, 승인권자)
//   → 예: 승인 후속 작업 → 종료 / 아니오: 기한 전 재검토 → 종료
// 표기: 동그라미 = 시작·종료, 둥근 사각형 = 활동, 마름모 = 조건 분기. 가로 구역 = 담당 역할.
// W02.bpmn 의 단계와 역할은 주최 측의 교육용 가정이다(세계관_BPMN/W02.html). 승인·부결·재검토 뒤의 후속 절차는 사용자가 정한 것이다.
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
  description: '통보 기한 안에 갱신안을 보고하고, 결과를 상대방에 알려야 해요. 기한을 넘기면 동일 조건으로 자동 갱신(체결로 간주)돼요.',
  lanes: CONTRACT_LANES,
  nodes: [
    { id: 'start', kind: 'start', label: '업무 발생', lane: 'marketing', col: 0, bind: { t: 'start' } },
    { id: 'accept', kind: 'task', label: '기안 접수', lane: 'marketing', col: 1, bind: { t: 'accept' } },
    { id: 'collect', kind: 'task', label: '성과·비용표 취합', lane: 'finance', col: 2, bind: { t: 'prep', key: 'collect-performance', infoKeys: ['info:'] } },
    { id: 'confirm', kind: 'task', label: '계약조건·기한 확인', lane: 'contract', col: 3, bind: { t: 'prep', key: 'confirm-terms' } },
    { id: 'decide', kind: 'gateway', label: '승인권자 결정', lane: 'approver', col: 4, bind: { t: 'decision' } },
    { id: 'doc', kind: 'task', label: '승인조건 문서화', lane: 'contract', col: 5, bind: { t: 'task', key: 'doc-conditions', branch: 'approved' } },
    { id: 'notify', kind: 'task', label: '상대방에 결과 통보', lane: 'marketing', col: 6, bind: { t: 'task', key: 'notify-counterparty', branch: 'approved' }, hint: '기한 전 · 원팀' },
    { id: 'record', kind: 'task', label: '통보·회신 기록 보관', lane: 'contract', col: 7, bind: { t: 'task', key: 'record-reply', branch: 'approved' } },
    { id: 'report', kind: 'task', label: '그룹 보고', lane: 'marketing', col: 8, bind: { t: 'task', key: 'group-report', branch: 'approved' } },
    { id: 'endOk', kind: 'end', label: '계약 체결', lane: 'contract', col: 9, bind: { t: 'end', branch: 'approved' } },
    { id: 'rethink', kind: 'task', label: '계약 미갱신 통지서 결재 보고', lane: 'contract', col: 5, row: 1, bind: { t: 'task', key: 'request-nonrenewal', branch: 'rejected' }, hint: '후속조치' },
    { id: 'nonApp', kind: 'task', label: '통지서 승인', lane: 'approver', col: 6, bind: { t: 'approval2', branch: 'rejected' }, hint: '승인권자 재승인' },
    { id: 'watch', kind: 'task', label: '불연장 통지서 발송', lane: 'contract', col: 7, row: 1, bind: { t: 'task', key: 'send-nonrenewal', branch: 'rejected' }, hint: '통보 기한 전' },
    { id: 'endNo', kind: 'end', label: '부결 종결', lane: 'contract', col: 8, row: 1, bind: { t: 'end', branch: 'rejected' } },
    { id: 'holdReason', kind: 'task', label: '보완 후 다시 보고', lane: 'marketing', col: 5, row: 1, bind: { t: 'task', key: 'hold-reason', branch: 'on_hold' }, hint: '재검토 · 원팀' },
  ],
  edges: [
    { from: 'start', to: 'accept' },
    { from: 'accept', to: 'collect' },
    { from: 'collect', to: 'confirm' },
    { from: 'confirm', to: 'decide' },
    { from: 'decide', to: 'doc', label: '승인', when: 'approved' },
    { from: 'doc', to: 'notify' },
    { from: 'notify', to: 'record' },
    { from: 'record', to: 'report' },
    { from: 'report', to: 'endOk' },
    { from: 'decide', to: 'rethink', label: '부결', when: 'rejected' },
    { from: 'rethink', to: 'nonApp' },
    { from: 'nonApp', to: 'watch' },
    { from: 'watch', to: 'endNo' },
    { from: 'decide', to: 'holdReason', label: '재검토', when: 'on_hold' },
    { from: 'holdReason', to: 'collect', label: '처음부터 다시', back: true },
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
    { id: 'accept', kind: 'task', label: '기안 접수', lane: 'marketing', col: 1, bind: { t: 'accept' } },
    { id: 'collect', kind: 'task', label: '성과·비용표 취합', lane: 'finance', col: 2, bind: { t: 'prep', key: 'collect-performance', infoKeys: ['info:'] }, hint: '300억 배분 검토 대상 판정' },
    { id: 'confirm', kind: 'task', label: '계약 확정기한·전속계약 확인', lane: 'contract', col: 3, bind: { t: 'prep', key: 'confirm-terms' } },
    { id: 'decide', kind: 'gateway', label: '승인권자 결정', lane: 'approver', col: 4, bind: { t: 'decision' } },
    { id: 'doc', kind: 'task', label: '승인조건 문서화', lane: 'contract', col: 5, bind: { t: 'task', key: 'doc-conditions', branch: 'approved' } },
    { id: 'notify', kind: 'task', label: '상대방에 계약 통보', lane: 'marketing', col: 6, bind: { t: 'task', key: 'notify-counterparty', branch: 'approved' }, hint: '확정기한 전 · 원팀' },
    { id: 'record', kind: 'task', label: '통보·회신 기록 보관', lane: 'contract', col: 7, bind: { t: 'task', key: 'record-reply', branch: 'approved' } },
    { id: 'report', kind: 'task', label: '그룹 보고', lane: 'marketing', col: 8, bind: { t: 'task', key: 'group-report', branch: 'approved' } },
    { id: 'endOk', kind: 'end', label: '계약 체결', lane: 'marketing', col: 9, bind: { t: 'end', branch: 'approved' } },
    { id: 'rethinkAlloc', kind: 'task', label: '집행 중단 처리', lane: 'contract', col: 5, row: 1, bind: { t: 'task', key: 'stop-campaign', branch: 'rejected' }, hint: '상대방 회신·기록 · 전속계약 기한 확인' },
    { id: 'endNo', kind: 'end', label: '부결 종결', lane: 'contract', col: 6, row: 1, bind: { t: 'end', branch: 'rejected' } },
    { id: 'holdReason', kind: 'task', label: '보완 후 다시 보고', lane: 'marketing', col: 5, row: 1, bind: { t: 'task', key: 'hold-reason', branch: 'on_hold' }, hint: '재검토 · 원팀' },
  ],
  edges: [
    { from: 'start', to: 'accept' },
    { from: 'accept', to: 'collect' },
    { from: 'collect', to: 'confirm' },
    { from: 'confirm', to: 'decide' },
    { from: 'decide', to: 'doc', label: '승인', when: 'approved' },
    { from: 'doc', to: 'notify' },
    { from: 'notify', to: 'record' },
    { from: 'record', to: 'report' },
    { from: 'report', to: 'endOk' },
    { from: 'decide', to: 'rethinkAlloc', label: '부결', when: 'rejected' },
    { from: 'rethinkAlloc', to: 'endNo' },
    { from: 'decide', to: 'holdReason', label: '재검토', when: 'on_hold' },
    { from: 'holdReason', to: 'collect', label: '처음부터 다시', back: true },
  ],
}

export const FLOWS: FlowDef[] = [CONTRACT_FLOW, EXPANSION_FLOW]

export const flowForCaseType = (caseType: string): FlowDef | undefined => FLOWS.find((f) => f.caseTypes.includes(caseType))

/**
 * 그룹 보고는 총액 1억 원 초과로 "그룹 보고"가 붙는 안건에만 있다. 그 밖의 안건은 그룹 보고 노드를 빼고
 * 통보·회신 기록 보관 바로 다음에 계약 체결(종결)이 오도록 흐름을 줄인다.
 */
export function flowWithoutGroupReport(def: FlowDef): FlowDef {
  const report = def.nodes.find((n) => n.id === 'report')
  if (!report) return def
  const record = def.nodes.find((n) => n.id === 'record')
  const nodes = def.nodes
    .filter((n) => n.id !== 'report')
    .map((n) => (n.id === 'endOk' && record ? { ...n, col: record.col + 1 } : n))
  const edges = def.edges
    .filter((e) => e.from !== 'report' && e.to !== 'report')
    .concat({ from: 'record', to: 'endOk' })
  return { ...def, nodes, edges }
}
