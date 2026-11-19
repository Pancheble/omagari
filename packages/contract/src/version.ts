// This checkout's version (ADR-0019). It calls Git, so use it only in Node. Kept apart from index.ts, which the web reads.
import { execFileSync } from "node:child_process";

/** Calls Git in this checkout. If it fails (no Git, not a clone, no tags), there's none. */
function git(...args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * This checkout's `git describe --tags`: `v0.1.0` on a released commit, `v0.1.0-3-gabc1234` on a commit after it.
 * For a clone that didn't get the tags (a shallow clone, etc.), says the version is unknown and adds the commit. Doesn't read version in package.json.
 */
export function checkoutVersion() {
  const tag = git("describe", "--tags");
  if (tag) return tag;
  const commit = git("rev-parse", "--short", "HEAD");
  return commit ? `version unknown (commit ${commit})` : "version unknown";
}

/** This checkout's top-level folder. None if it isn't a clone. */
export function checkoutRoot() {
  return git("rev-parse", "--show-toplevel");
}

/** The branch this checkout is on. None if it isn't on a branch (a tag or commit is checked out). */
export function checkoutBranch() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  return branch && branch !== "HEAD" ? branch : undefined;
}
