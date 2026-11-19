import assert from "node:assert/strict";
import { test } from "node:test";
import { labelsFor } from "./labeler.ts";

const yaml = `
# comment
backend:
  - changed-files:
    - any-glob-to-any-file: 'server/**'
shared:
  - changed-files:
    - any-glob-to-all-files: ['lib/**', "docs/**"]
  - changed-files:
    - all-globs-to-any-file:
      - 'web/**'
      - '!web/legacy/**'
only-ts:
  - changed-files:
    - all-globs-to-all-files: '**/*.ts'
nested:
  - any:
    - changed-files:
      - any-glob-to-any-file: 'a/**'
  - all:
    - changed-files:
      - any-glob-to-any-file: 'b/**'
    - head-branch: ['^feat']
branch-only:
  - head-branch: ['^feature']
"payment":
  - changed-files:
      - any-glob-to-any-file: ['src/payment/**', 'pay/{a,b}.ts']
`;

test("labeler.yml: four file conditions, any/all, and branch conditions ignored", () => {
  const of = (...files: string[]) => labelsFor(yaml, files);
  assert.deepEqual(of("server/a.ts"), ["backend", "only-ts"]);
  assert.deepEqual(of("lib/x.md", "docs/y.md"), []);
  assert.deepEqual(of("docs/y.md", "docs/z.md"), ["shared"]);
  assert.deepEqual(of("web/a.ts"), ["shared", "only-ts"]);
  assert.deepEqual(of("web/legacy/a.js"), []);
  assert.deepEqual(of("a/x.js"), ["nested"]);
  assert.deepEqual(of("b/x.js"), ["nested"]); // branch conditions are ignored; only file conditions count
  assert.deepEqual(of("src/payment/x.js", "pay/a.ts"), ["payment"]);
  assert.deepEqual(of(), []);
  assert.throws(() => labelsFor("- a\n- b", ["x"]));
});
