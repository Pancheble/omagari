import assert from "node:assert/strict";
import { test } from "node:test";
import type { Alert } from "@omagari/contract";
import { listVerdict } from "./list-verdict.ts";

const work = { login: "a", name: "A", branch: "x" };
const indirect = (extra: Record<string, unknown> = {}) =>
  ({
    kind: "indirect",
    works: [work, work],
    more: 0,
    resolved: null,
    symbols: [],
    ...extra,
  }) as unknown as Alert;
const run = (verdict: string, stale = false) => ({ verdict, stale });

test("list verdict", () => {
  assert.equal(listVerdict(indirect()), "estimate");
  assert.equal(listVerdict(indirect({ run: run("running") })), "running");
  assert.equal(listVerdict(indirect({ run: run("unclear") })), "unclear");
  assert.equal(listVerdict(indirect({ run: run("pass"), resolved: "t" })), "pass");
  assert.equal(listVerdict(indirect({ run: run("not_run") })), "estimate");
  assert.equal(listVerdict(indirect({ run: run("running", true) })), "estimate");
  assert.equal(listVerdict(indirect({ confirmed: true, run: run("broken", true) })), "broken");
  assert.equal(listVerdict(indirect({ confirmed: true, resolved: "t" })), "estimate");
  assert.equal(listVerdict({ ...indirect(), kind: "direct", files: [] } as Alert), "direct");
  assert.equal(listVerdict({ ...indirect(), kind: "duplicate" } as Alert), undefined);
  assert.equal(listVerdict({ ...indirect(), kind: "declared" } as Alert), undefined);
});
