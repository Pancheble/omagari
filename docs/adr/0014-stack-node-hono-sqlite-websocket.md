---
status: accepted
---

# 스택 세부: Node.js, Hono와 React, SQLite, WebSocket

ADR-0013이 계약 이슈로 미뤄 둔 네 가지를 정한다(이슈 #5). 고른 기준은 하나다. 1단계의 불확실성은 러너에 몰려 있으니, 나머지는 덜 놀라운 것과 이미 들어 있는 것을 쓴다.

- **런타임**: Node.js 24 LTS 이상. 빌드 단계 없이 TypeScript를 그대로 실행한다. Node의 타입 벗기기가 v24.12.0부터 stable이라 tsx도 번들도 필요 없다([Node TypeScript](https://nodejs.org/api/typescript.html)). 러너가 기대는 자식 프로세스, 파일 감시, Git 호출은 Node가 기준 구현이고, Room도 Node 22 이상에서 소스 `.ts`를 그대로 돌린다.
- **프레임워크**: 서버는 Hono, 웹은 React와 Vite로 만든 SPA. 서버는 평범한 HTTP + JSON API라(구현 4장) 본문 읽기와 경로 나누기만 맡기면 된다. Room은 `node:http` 위에 그것을 직접 짰다. 화면은 사이드바, 채널, DM이 실시간으로 바뀌는 앱이라 컴포넌트 프레임워크를 쓰고, 서버가 따로 있어 SSR은 두지 않는다.
- **저장소**: SQLite 파일 하나. Node 내장 `node:sqlite`를 쓰고 ORM 없이 SQL을 쓴다. 서버 하나에 워크스페이스 하나이고(ADR-0012) 담을 것이 관계형이며 작다. 테스트마다 실제 서버를 임시 폴더에 띄우는데, 파일 DB는 컨테이너 없이 격리된다.
- **실시간 전송**: WebSocket 한 가지. JSON 텍스트 프레임에 계약의 봉투를 싣는다. 러너와 서버는 양방향이고 연결 하나의 생사가 곧 오프라인 여부다. 웹은 조작을 HTTP API로 하고 받는 것만 WebSocket으로 받는다([Discord Gateway](https://docs.discord.com/developers/events/gateway)와 같은 나눔). 서버 쪽은 `ws`를 Hono의 Node 어댑터에 붙이고([Hono WebSocket](https://hono.dev/helpers/websocket)), 러너 쪽은 Node 내장 `WebSocket`을 쓴다.

뒤집기 쉬운 기본값도 함께 둔다: npm workspaces, 계약 정의는 Zod(타입과 런타임 검증이 한 정의에서 나온다), 테스트는 내장 `node:test`, 포맷과 린트는 Biome.

테스트 러너의 예외는 하나다(2026-11-11, 이슈 #18): 화면 부품을 따로 테스트해야 하게 되면 Vitest를 `packages/web`에만 넣는다. 그 전에는 넣지 않는다. Node는 타입만 지우고 실행하므로 JSX가 든 `.tsx`를 돌리지 못하고(Node 24.19에서 확인), 웹은 이미 Vite를 써서 Vitest가 그 설정을 그대로 쓴다. 넣을 때는 루트 `npm test`의 `node --test` 범위(`packages/*/src/**/*.test.ts`)가 web의 Vitest 테스트를 집지 않게 범위나 파일 이름을 나눈다.

## Considered Options

- **Bun**: TypeScript, SQLite, WebSocket 서버, 테스트가 내장이고 단일 실행 파일로 묶여 기기에 깔기 쉽다. 러너가 기대는 `child_process`와 파일 감시가 Node 호환 계층 위에 있어, 불확실한 곳에 불확실한 것을 더한다.
- **Fastify, `node:http` 직접**: Fastify는 JSON Schema가 중심이라 Zod 정의와 겹친다. `node:http` 직접은 Room이 간 길이고 직접 짤 것이 많다.
- **Postgres**: 서버를 여러 대로 늘릴 때 간다. 지금은 테스트와 CI에 컨테이너만 더한다.
- **웹만 SSE, 전부 SSE + POST**: SSE는 알아서 다시 붙지만 전송 방식이 둘이 되거나, 순서와 연결 생사를 직접 다뤄야 한다.
- **Yjs(Room)**: Room은 모든 상태를 CRDT 문서 하나에 둔다. Omagari는 서버가 규칙을 계산하므로 맞지 않는다.

## Consequences

- Node는 `node_modules` 아래의 `.ts`를 실행하지 않는다. 러너, CLI, 훅을 기기에 배포할 때는 JS로 빌드한다. enum처럼 지워지지 않는 문법은 쓰지 않는다(`erasableSyntaxOnly`).
- `node:sqlite`는 아직 release candidate다(Stability 1.2, [문서](https://nodejs.org/api/sqlite.html)). 말썽이면 동기 API가 거의 같은 better-sqlite3로 바꾼다.
- 서버는 디스크가 남는 호스트 한 대에 띄운다.
- API 스키마는 Hono의 타입이 아니라 계약 패키지의 Zod 정의에서 나온다. 프레임워크를 바꿔도 계약은 그대로다.
- 웹 코드와 DB 코드는 그것이 처음 필요한 이슈가 넣는다.
