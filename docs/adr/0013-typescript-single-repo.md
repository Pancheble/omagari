---
status: accepted
---

# TypeScript 단일 레포로 만든다

서버, 러너, CLI, 훅, 웹을 한 레포에서 TypeScript로 만든다. 웹은 어차피 TypeScript이고, 다섯 조각이 러너와 서버 사이의 메시지 타입과 API 스키마(계약)를 한 정의로 함께 쓰게 하려는 것이다. 계약이 첫 이슈이고(`docs/NEXT.md`), 1단계의 불확실성은 러너에 몰려 있어 조각 사이의 어긋남까지 떠안을 여유가 없다. 같은 모양의 문제를 푼 Room도 TypeScript 단일 레포에 서버, 클론마다의 프로세스, 훅, 웹, 공유 타입을 나눠 둔다.

런타임, 프레임워크, 저장소, 실시간 전송 방식 같은 세부는 여기서 정하지 않는다. 계약 이슈에서 정한다.

## Considered Options

- 러너와 CLI만 Go나 Rust로 만든 단일 실행 파일: 각자 기기에 깔기는 쉽지만, 계약 타입을 두 언어로 따로 적어 맞춰야 한다.

## Consequences

- 러너, CLI, 훅을 쓰려면 각자 기기에 JavaScript 런타임이 있어야 한다.
- 화면 없이 띄우는 것이 CLI로 모자라면 두 실행기 모두 TypeScript SDK로 갈 수 있다(Claude Agent SDK, Codex SDK).
