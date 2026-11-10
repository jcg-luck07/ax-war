'use client'

// 아이콘(@phosphor-icons/react)이 브라우저 쪽 모듈이라 이 파일도 브라우저 쪽이에요. 서버 페이지에서 import 하지 마세요.
// 사이드바 메뉴. 화면을 추가하면 여기에 한 줄 더하면 돼요.
//
//   { label: "할 일", href: "/todos", icon: ListChecks }
//
// 아이콘은 @phosphor-icons/react 에서 골라요 (https://phosphoricons.com — 이름 그대로 import).
// href 가 http(s):// 로 시작하면 새 탭으로 열려요.
// 관리자만 쓰는 화면은 adminOnly: true — 관리자가 아닌 사람의 메뉴에서 빠져요 (화면 자체의 권한 확인은 따로 해요).
import { ChartBar, Database, House, ListChecks, Tray, TreeStructure, UsersThree, Wallet, FilePlus, Scales, type Icon } from "@phosphor-icons/react";

// 왼쪽 위 앱 아이콘. 앱이 하는 일에 맞는 아이콘으로 바꿔요 (예: 휴가 앱이면 AirplaneTilt, 거래처 앱이면 Buildings).
export const APP_ICON: Icon = Scales;

export type NavItem = {
  label: string;
  href: string;
  icon: Icon;
  adminOnly?: boolean;
};

export const NAVIGATION: NavItem[] = [
  { label: "홈", href: "/", icon: House },
  { label: "할 일", href: "/inbox", icon: Tray },
  { label: "안건", href: "/cases", icon: ListChecks },
  { label: "업무 흐름", href: "/flow", icon: TreeStructure },
  { label: "안건 접수", href: "/intake", icon: FilePlus },
  { label: "인플루언서 성과", href: "/performance", icon: ChartBar },
  { label: "현금 재전망", href: "/cash", icon: Wallet },
  { label: "데이터 모델", href: "/model", icon: Database },
  { label: "사용자·권한", href: "/admin/users", icon: UsersThree, adminOnly: true },
];
