/**
 * 돌리지 못한 까닭(러너가 올린 글)을 DESIGN.md의 네 가지로 가른다. 못 가르면 올라온 글 그대로 보인다.
 * 샌드박스 글은 돌린 사람(`mine`)의 이름을 쓴다. 다른 멤버가 보면 "이 기기"가 자기 기기로 읽히기 때문이다(#183).
 * `help`는 뒤에 붙일 강조 링크("까는 법", "정하는 법")다.
 */
export function notRunWords(
  reason: string,
  mine: string,
): { text: string; help?: "sandbox" | "check" } {
  if (/상한/.test(reason)) return { text: "5분이 넘어 끊었어요 · 통과로 치지 않아요" };
  if (/줄이 부딪혀/.test(reason)) return { text: "직접 충돌을 먼저 풀어야 돌려 볼 수 있어요" };
  if (/샌드박스/.test(reason))
    return { text: `${mine}의 기기에 샌드박스 도구가 없어요`, help: "sandbox" };
  if (/검사 명령|omagari\.json|기본 브랜치/.test(reason))
    return { text: "레포에 검사 명령이 없어요", help: "check" };
  return { text: reason || "돌리지 못했어요" };
}
