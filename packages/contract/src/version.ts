// This install's version: the npm package's (ADR-0048), or the clone's from Git (ADR-0019). Node only. Kept apart from index.ts, which the web reads.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The npm package this runs from and the dist-tag it was published under (`latest` or `next`), which the build writes as
 * `publishConfig.tag` (ADR-0048). None in a clone: the repo's package.json, at the same place, has no tag.
 */
export function installedPackage(): { version: string; tag: string } | undefined {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    const tag = pkg.publishConfig?.tag;
    return typeof tag === "string" ? { version: pkg.version, tag } : undefined;
  } catch {
    return undefined;
  }
}

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
 * The npm package's version when installed from npm. In a clone, `git describe --tags`: `v0.1.0` on a released commit, `v0.1.0-3-gabc1234` on a commit after it.
 * For a clone that didn't get the tags (a shallow clone, etc.), says the version is unknown and adds the commit. Never reads the repo's package.json version (always 0.0.0).
 */
export function checkoutVersion() {
  const installed = installedPackage();
  if (installed) return installed.version;
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
