import type { Alert } from "@omagari/contract";

/** 포럼 목록에 보이는 판정(DESIGN.md "목록의 판정"). 돌리지 못함은 따로 없이 `estimate`로 보인다. */
export type ListVerdict = "estimate" | "running" | "broken" | "unclear" | "pass" | "direct";

export const LIST_VERDICT_LABELS = {
  estimate: "추정",
  running: "돌려 보는 중",
  broken: "깨짐",
  unclear: "가릴 수 없음",
  pass: "통과",
  direct: "직접 충돌",
} as const satisfies Record<ListVerdict, string>;

/**
 * 알림의 목록 판정. 중복 구현과 계약 변경은 합쳐 돌리지 않으므로 없다(ADR-0036).
 * 확인됨(`confirmed`)은 다음 판정까지 남으므로 지난 결과(`stale`)여도 깨짐이다. 풀린 알림은 확인됨이 아니다.
 * 지난 결과나 판정이 없는 것, 돌리지 못함은 추정이다.
 */
export function listVerdict(alert: Alert): ListVerdict | undefined {
  if (alert.kind === "direct") return "direct";
  if (alert.kind !== "indirect") return undefined;
  if (alert.confirmed && !alert.resolved) return "broken";
  const run = alert.run;
  if (!run || run.stale) return "estimate";
  if (run.verdict === "running" || run.verdict === "unclear" || run.verdict === "pass")
    return run.verdict;
  return "estimate";
}
