import assert from "node:assert/strict";
import { test } from "node:test";
import { placePopover } from "./floating.ts";

const size = { width: 474, height: 409 };
const win = { width: 1280, height: 800 };
const box = (left: number, top: number) => ({ left, right: left + 28, top, bottom: top + 28 });

test("it right-aligns below the anchor when there's room", () => {
  assert.deepEqual(placePopover(box(1100, 100), size, win), { left: 1128 - 474, top: 132 });
});

test("an anchor near the left edge keeps the popover inside the window", () => {
  assert.equal(placePopover(box(372, 100), size, win).left, 8);
});

test("an anchor at the right edge keeps it inside the window", () => {
  assert.equal(placePopover(box(1270, 100), size, win).left, 1280 - 474 - 8);
});

test("near the bottom it opens above the anchor", () => {
  assert.equal(placePopover(box(600, 700), size, win).top, 700 - 4 - 409);
});

test("in a window too short for either side, it stays inside the window", () => {
  assert.equal(placePopover(box(600, 200), size, { width: 1280, height: 420 }).top, 8);
});
