import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const WEB = join(import.meta.dirname, "..");
const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;
/** The only places Korean may live (ADR-0045): the dictionaries, and `i18n.ts` for the language's own name. */
const ALLOWED = (path: string) =>
  path.startsWith(join("src", "words") + "/") || path === join("src", "i18n.ts");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test("web code has no Hangul outside the Korean dictionary", () => {
  const found = files(WEB)
    .map((path) => relative(WEB, path))
    .filter((path) => /\.(tsx?|css|html|json)$/.test(path) && !ALLOWED(path))
    .flatMap((path) =>
      readFileSync(join(WEB, path), "utf8")
        .split("\n")
        .flatMap((line, at) =>
          HANGUL.test(line) ? [`${path}:${at + 1}: ${line.trim().slice(0, 80)}`] : [],
        ),
    );
  assert.deepEqual(
    found,
    [],
    "Korean text goes in packages/web/src/words/ko.ts (or a words/*.ko.ts file), and comments are in English",
  );
});
