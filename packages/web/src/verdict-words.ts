import { t } from "./i18n.ts";

/**
 * Sorts the reason a check didn't run (text the runner posted) into the four in DESIGN.md. If it can't, the posted text shows as it is.
 * The sandbox text uses the name of whoever ran it (`mine`). Seen by another member, "this machine" would read as their own (#183).
 * `help` is the emphasized link to tack on after ("How to install", "How to set one").
 * The reasons are the runner's English text (written once, shared, so it isn't translated).
 */
export function notRunWords(
  reason: string,
  mine: string,
): { text: string; help?: "sandbox" | "check" } {
  const words = t.verdict.notRun;
  if (/cut off/.test(reason)) return { text: words.limit };
  if (/lines conflict/i.test(reason)) return { text: words.conflict };
  if (/sandbox/i.test(reason)) return { text: words.sandbox(mine), help: "sandbox" };
  if (/check command|omagari\.json|default branch/i.test(reason))
    return { text: words.noCheck, help: "check" };
  return { text: reason || words.fallback };
}
