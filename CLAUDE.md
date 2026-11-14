# Claude Code 가이드

이 프로젝트의 행동 규칙은 모두 [AGENTS.md](./AGENTS.md) 에 있어요.
**먼저 AGENTS.md 를 읽고 그 규칙을 따라요.** Claude Code 든 Codex 든 동일한 규칙이에요.

## 화면을 만들기 전에 (요약 — 자세히는 AGENTS.md 「디자인」)

- 컴포넌트는 `@heroui/react` **v3** 에서 가져와요. v2 문법(`HeroUIProvider`, `@heroui/button`, `CardBody`, `onClick`)은 틀려요 — `Card.Header`, `onPress`.
- 이 프로젝트는 `@jocoding-ax-partners/design-system`(CSS 전용, HeroUI 를 콘솔처럼 칠함)을 써요.
  UI 코드를 쓰기 전에 `node_modules/@jocoding-ax-partners/design-system/llms.txt` 를 읽어요.
- 확인창 `useConfirm`, `PageHeader`, `StatusDot`, `CodeBlock` 은 `@/components/ax` 에서 (= `@jocoding-ax-partners/react`).
- 아이콘은 `@phosphor-icons/react` (서버 파일은 `@phosphor-icons/react/ssr`).
- 색·글자는 의미 토큰만: `bg-content` `text-muted` `border-default` `t-small` … — #hex · `text-[15px]` · `text-gray-500` 금지.
- 다른 UI 라이브러리는 설치하지 않아요. 고친 뒤 `npm run check:design` 으로 확인해요.

## AXHub 사용 규칙 (AX 인재전쟁 — 자세히는 AGENTS.md 「AXHub 사용 규칙」)

- 앱은 `lounge` 테넌트(조직)에만 만든다. 제출할 앱은 하나(`ax-war-samil-jcg`)라서, 사용자가 말하지 않으면 새 앱을 만들지 않고 지금 앱에 이어서 배포한다.
- 앱 공개 범위는 「누구나」(`internet`)로 두고 바꾸지 않는다. 심사위원이 로그인 없이 열 수 있어야 한다.
- 공동 소유자 추가와 소유권 이전은 하지 않는다(개인전).
- 앱에 AI 기능을 넣을 때는 사용자의 API 키를 axhub 환경변수로 등록해서 쓴다(`ANTHROPIC_API_KEY`). 키를 코드나 저장소에 넣지 않는다.
- 저장해야 하는 데이터는 axhub DB 에 둔다. 컨테이너 볼륨에 둔 데이터는 앱이 일시정지되면 모두 지워진다.
- 기업용 기능(AXRouter, 플러그인, 커넥터, 사설망, 에이전트)은 대회에서 쓸 수 없으니 쓰지 않는다. (`ANTHROPIC_BASE_URL` 도 설정하지 않는다.)
- 웹소켓과 웹훅 수신은 대회에서 지원하지 않는다. 사용자가 따로 요청하지 않으면 쓰지 않고, 실시간 갱신이 필요하면 주기적으로 다시 불러오는 방식으로 만든다.
- 크레딧이 부족하다는 안내가 나오면 다른 방법으로 돌아가지 말고 사용자에게 먼저 알린다.
- 제출 마감 뒤에는 앱이 잠겨 재배포·되돌리기·환경변수 변경·삭제가 안 된다. 마감 전에 마지막 배포와 환경변수 등록을 끝낸다.
- `.claude/settings.local.json` · `.codex/hooks.json` · `.agents/hooks.json` 은 기록 키가 든 파일이라 커밋하지 않는다.
