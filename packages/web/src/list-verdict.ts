import type { Alert } from "@omagari/contract";

/** The verdict shown in the forum list (DESIGN.md "Verdict in the list"). "Didn't run" has no label of its own and shows as `estimate`. Its words are `t.verdict.list`. */
export type ListVerdict = "estimate" | "running" | "broken" | "unclear" | "pass" | "direct";

/**
 * The list verdict of an alert. Duplicate work and contract changes aren't merge-run, so they have none (ADR-0036).
 * A confirmed alert (`confirmed`) stays until the next verdict, so it's "broken" even if the result is old (`stale`). A resolved alert isn't confirmed.
 * Old results, no verdict, and "didn't run" all show as an estimate.
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
