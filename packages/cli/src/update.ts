// Fetches the installed clone when the server's contract is newer and rejected us (ADR-0042). Never touches the watched repo folder.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { checkoutBranch, checkoutRoot } from "@omagari/contract/version";

/** Marker passed to the runner restarted from the fetched clone. Stops it from fetching the same version again. */
export const UPDATED = "OMAGARI_UPDATED";

/** One run-log line (installed clone updated): when, which branch, from which commit to which commit. */
export type UpdateRecord = {
  at: string;
  kind: "update";
  branch: string;
  from: string;
  to: string;
};

/**
 * Runs `git pull --ff-only` and `npm ci` in the installed clone. If it can't update (for example there are
 * modified files or a fast-forward isn't possible), it changes nothing and returns `todo` (what a person has to do).
 */
export async function updateClone(): Promise<
  { record: Omit<UpdateRecord, "at" | "kind"> } | { todo: string }
> {
  const root = checkoutRoot();
  const branch = checkoutBranch();
  if (!root) return { todo: "This checkout is not a Git clone. Clone it again" };
  if (!branch)
    return {
      todo: "The clone is not on a branch. Check out a branch and update it",
    };
  const run = async (file: string, ...args: string[]) =>
    (await promisify(execFile)(file, args, { cwd: root })).stdout.trim();
  const fail = (what: string, error: unknown) => ({
    todo: `${what} (${root}): ${error instanceof Error ? error.message : error}`,
  });
  if (await run("git", "status", "--porcelain", "--untracked-files=no").catch(() => "?"))
    return {
      todo: `${root} has modified files. Clean them up, run \`git pull\` and \`npm ci\`, then restart the runner`,
    };
  const from = await run("git", "rev-parse", "HEAD");
  try {
    await run("git", "pull", "--ff-only");
  } catch (error) {
    return fail("`git pull --ff-only` failed. Update it yourself", error);
  }
  const to = await run("git", "rev-parse", "HEAD");
  if (to === from)
    return {
      todo: `${branch} has no new commits to fetch. Check which version the server runs`,
    };
  try {
    await run("npm", "ci");
  } catch (error) {
    return fail(
      `Fetched ${branch}, but \`npm ci\` failed. Run it yourself and restart the runner`,
      error,
    );
  }
  return { record: { branch, from, to } };
}

/** Starts this program again with the same arguments and waits for it to end. Stop signals are passed to the new process. */
export function restart() {
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, [UPDATED]: "1" },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  return new Promise<number>((done) => child.on("exit", (code) => done(code ?? 1)));
}
