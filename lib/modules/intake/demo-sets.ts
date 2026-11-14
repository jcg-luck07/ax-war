// 시연용 첨부서류 묶음의 이름·설명 (브라우저와 서버가 함께 쓴다 — 서버 전용 모듈을 import 하지 않는다).
//  · 정상: 값이 다 채워진 확대 안건 (합성데이터 T26 확대 토모카 캠페인3)
//  · 예외: 추계서에 값이 빠진 신규 안건 (합성데이터 M04 값누락 추계서 신규 보미 캠페인4)
export type DemoKind = 'normal' | 'exception'

export const DEMO_SETS: Record<DemoKind, { label: string; zipName: string; summary: string }> = {
  normal: {
    label: '정상파일',
    zipName: '시연용_정상파일_T26_확대_토모카_캠페인3.zip',
    summary: '토모카 캠페인3 확대 — 기안서·추계서·계약서 모두 값이 채워져 있어요',
  },
  exception: {
    label: '데이터누락파일',
    zipName: '시연용_데이터누락파일_M04_값누락_추계서_신규_보미_캠페인4.zip',
    summary: '보미 캠페인4 신규 — 추계서에 값이 빠져 있어요',
  },
}

export const isDemoKind = (k: string): k is DemoKind => k === 'normal' || k === 'exception'
