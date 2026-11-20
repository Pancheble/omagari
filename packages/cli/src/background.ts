// The background runner (ADR-0049): one process per user that runs one runner per repo folder, in-process.
// The session-start hook sends it folders over one socket. It keeps the folders in the config folder and starts them again after a restart.
import { once } from "node:events";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { text } from "node:stream/consumers";
import { backgroundSocket, readRepo, runnerPaths } from "@omagari/runner";

/** How often it tries again the folders whose runner isn't on (server down at login, a terminal runner that ended). */
const RETRY_MS = 60_000;

type Running = { ended: Promise<unknown>; stop: () => Promise<void> | void };

/**
 * Runs until SIGINT or SIGTERM. `start` starts the runner of one repo folder; `foldersFile` keeps the folders it has seen.
 * Until repo sharing (#353), it starts only repos where a runner already ran by hand: `<git-common-dir>/omagari` exists.
 */
export async function background(foldersFile: string, start: (folder: string) => Promise<Running>) {
  let folders: string[] = JSON.parse(await readFile(foldersFile, "utf8").catch(() => "[]"));
  /** Runners by their per-repo socket, which is one per repo whatever worktree the folder is. Pending starts are in it too. */
  const running = new Map<string, Promise<Running | undefined>>();
  /** The last line said about each repo, so a retry every minute doesn't repeat it. */
  const said = new Map<string, string>();
  const say = (key: string, line: string) => {
    if (said.get(key) !== line) console.log(line);
    said.set(key, line);
  };
  const save = async () => {
    await mkdir(dirname(foldersFile), { recursive: true, mode: 0o700 });
    await writeFile(foldersFile, `${JSON.stringify(folders, null, 2)}\n`);
  };

  /** Starts the runner of `folder` unless it's on. Resolves once it's on or it's clear it won't be. */
  async function watch(folder: string) {
    const { socket, log } = await runnerPaths(folder);
    const current = running.get(socket);
    if (current) return current;
    const started = (async () => {
      if (
        !(await access(dirname(log)).then(
          () => true,
          () => false,
        ))
      ) {
        say(
          socket,
          `Not watching ${folder}: no runner has run in this repo yet. Run omagari runner there once`,
        );
        return undefined;
      }
      const runner = await start(folder);
      say(socket, `Watching ${folder}`);
      runner.ended.then((reason) => {
        running.delete(socket);
        say(
          socket,
          `The runner for ${folder} stopped${reason instanceof Error ? `: ${reason.message}` : ""}`,
        );
      });
      return runner;
    })().catch((error) => {
      say(socket, `Couldn't start the runner for ${folder}: ${error.message ?? error}`);
      return undefined;
    });
    running.set(socket, started);
    if (!(await started)) running.delete(socket);
    return started;
  }

  /** Starts every kept folder that isn't on. Folders that are gone (or no longer a Git repo with a GitHub remote) are dropped. */
  async function watchAll() {
    const kept = await Promise.all(
      folders.map((folder) =>
        readRepo(folder).then(
          async () => {
            await watch(folder);
            return folder;
          },
          () => undefined,
        ),
      ),
    );
    const left = kept.filter((folder) => folder !== undefined);
    if (left.length !== folders.length) {
      folders = left;
      await save();
    }
  }

  /** A folder from the hook. "" only asks which repos are watched. Answers with the per-repo sockets of the runners that are on. */
  async function answer(request: string) {
    const repo = request ? await readRepo(request).catch(() => undefined) : undefined;
    if (repo) {
      if (!folders.includes(repo.folder)) {
        folders.push(repo.folder);
        await save();
      }
      await watch(repo.folder);
    }
    const on = await Promise.all(
      [...running].map(async ([socket, runner]) => ((await runner) ? [socket] : [])),
    );
    return JSON.stringify(on.flat());
  }

  const socket = backgroundSocket();
  const local = createServer({ allowHalfOpen: true }, (connection) => {
    connection.on("error", () => {}); // the hook may hang up before the answer
    text(connection)
      .then(answer)
      .then(
        (reply) => connection.end(reply),
        () => connection.destroy(),
      );
  });
  await rm(socket, { force: true }); // left behind by a background runner that was killed
  local.listen(socket);
  await once(local, "listening");
  console.log(`Background runner on: ${socket}`);
  await watchAll();
  const retry = setInterval(() => watchAll().catch(() => {}), RETRY_MS);

  await Promise.race(["SIGINT", "SIGTERM"].map((signal) => once(process, signal)));
  clearInterval(retry);
  local.close();
  await Promise.all([...running.values()].map(async (runner) => (await runner)?.stop()));
  console.log("Background runner stopped");
}
