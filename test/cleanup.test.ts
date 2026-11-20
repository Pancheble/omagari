import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { eventually, startWorld } from "./harness.ts";

const write = async (folder: string, path: string, content: string) => {
  await mkdir(dirname(join(folder, path)), { recursive: true });
  await writeFile(join(folder, path), content);
};

test("changed-file content unchanged for 30 days is dropped (path stays), a changed work uploads fresh content, and a deleted branch's work is gone", async (t) => {
  // The test clock: 30 days shortened to 2 seconds.
  const world = await startWorld({ observeMs: 50, followMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const desk = await world.desk(alice);
  t.after(desk.remove);
  await desk.git("switch", "--create", "refund");
  await write(desk.folder, "a.ts", "a1\n");
  const files = async () =>
    (await world.works(world.owner)).find((w) => w.login === "alice" && w.branch === "refund")
      ?.files;
  await eventually(async () =>
    assert.deepEqual(await files(), [{ path: "a.ts", content: "a1\n" }]),
  );

  // Newer than the window stays; older than it goes, and the runner re-sending the same files doesn't bring it back.
  await world.restartServer({ contentMs: 2000 });
  await eventually(async () =>
    assert.deepEqual(await files(), [{ path: "a.ts", omitted: "share" }]),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(await files(), [{ path: "a.ts", omitted: "share" }]);

  // Changing again uploads fresh content as usual.
  await write(desk.folder, "b.ts", "b1\n");
  await eventually(async () =>
    assert.deepEqual(await files(), [
      { path: "a.ts", content: "a1\n" },
      { path: "b.ts", content: "b1\n" },
    ]),
  );

  // A deleted branch's work is gone at the next run.
  await desk.git("switch", "--detach");
  await desk.git("branch", "-D", "refund");
  await eventually(async () => assert.equal(await files(), undefined));
});
