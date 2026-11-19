import type { Channel } from "@omagari/contract";

/** "<계정> 전체"(시안 101-2). 레포가 아닌 곳이라 레포 이름과 겹치지 않는 빈 글로 둔다. */
export const ALL = "";

/**
 * 채널이 패널의 어느 곳에 서나(DESIGN.md "워크스페이스와 레포", ADR-0043). 레포 채팅 채널과 레포 하나만 보는 포럼은 그 레포이고,
 * 워크스페이스 채널과 모든 레포나 레포 둘 이상을 보는 포럼은 "전체"다. 레포가 하나뿐인 계정에는 "전체"가 없어 모두 그 레포에 선다.
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

/** 고른 곳이 아직 있으면 그곳, 없으면(레포를 뺐다, 처음이다) 첫 레포다. 레포가 둘 이상이면 "전체"도 고를 수 있다. */
export const placeIn = (repos: string[], wanted: string | undefined) =>
  wanted !== undefined && (repos.includes(wanted) || (wanted === ALL && repos.length > 1))
    ? wanted
    : (repos[0] ?? ALL);
