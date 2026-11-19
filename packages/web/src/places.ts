import type { Channel } from "@omagari/contract";

/** "All of <account>" (mockup 101-2). It isn't a repo, so it's an empty string that can't collide with a repo name. */
export const ALL = "";

/**
 * Where in the panel a channel sits (DESIGN.md "Workspace and repo", ADR-0043). A repo chat channel and a forum that watches one repo are in that repo,
 * and a workspace channel and a forum that watches all repos or two or more repos are in "All". An account with a single repo has no "All", so everything sits in that repo.
 */
export function placeOf(channel: Channel, repos: string[]) {
  if (repos.length < 2) return repos[0] ?? ALL;
  const repo =
    channel.kind === "chat"
      ? channel.repo
      : channel.filter?.repos?.length === 1
        ? channel.filter.repos[0]
        : undefined;
  return repo && repos.includes(repo) ? repo : ALL;
}

/** The picked place if it still exists, otherwise (a repo was removed, or first visit) the first repo. With two or more repos, "All" can be picked too. */
export const placeIn = (repos: string[], wanted: string | undefined) =>
  wanted !== undefined && (repos.includes(wanted) || (wanted === ALL && repos.length > 1))
    ? wanted
    : (repos[0] ?? ALL);
