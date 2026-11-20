import assert from "node:assert/strict";
import { test } from "node:test";
import { contrast, onDark } from "./label-color.ts";

test("label dots on the dark screen reach 3:1 and keep colors that already pass", () => {
  assert.equal(onDark("fbca04"), "fbca04");
  assert.equal(onDark("c5def5"), "c5def5");
  for (const hex of ["b60205", "0e8a16", "5319e7", "000000", "1d76db", "d93f0b"]) {
    const out = onDark(hex);
    assert.ok(contrast(out, "272729") >= 3, `${hex} → ${out}`);
  }
  assert.notEqual(onDark("b60205"), "b60205");
});
