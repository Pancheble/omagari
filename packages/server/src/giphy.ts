import { ContractFailure, Gif } from "@omagari/contract";

/** 서버의 바깥 경계: GIPHY(ADR-0044). 서버만 키를 들고 대신 묻는다. 테스트는 `base`에 가짜 GIPHY를 꽂는다. */
export type Giphy = { search(query: string): Promise<Gif[]> };

/** 찾기 칸의 그림은 GIPHY의 그림 주소만 받는다. 다른 곳의 주소를 웹에 넘기지 않는다. */
const MEDIA = /^https:\/\/media\d*\.giphy\.com\//;
const HOUR_MS = 60 * 60_000;

/** GIPHY 응답의 GIF 하나 가운데 쓰는 것. 믿지 않고 하나씩 맞춰 본다. */
type Found = {
  id?: unknown;
  title?: unknown;
  images?: { fixed_width?: { url?: unknown; width?: unknown; height?: unknown } };
};

/**
 * 진짜 GIPHY. 등급은 R까지, 한 번에 24개. `perHour`는 키의 시간당 한도다(베타 키는 100번).
 * 넘으면 GIPHY에 묻지 않고 거절한다. 찾은 결과는 쌓아 두지 않는다(GIPHY 약관).
 */
export function realGiphy(
  key: string,
  { base = "https://api.giphy.com", perHour = 100 } = {},
): Giphy {
  /** 지난 한 시간 안에 GIPHY에 물은 시각들. */
  let asked: number[] = [];
  const unavailable = (message: string) => new ContractFailure({ code: "internal", message });
  return {
    async search(query) {
      const now = Date.now();
      asked = asked.filter((at) => now - at < HOUR_MS);
      if (asked.length >= perHour)
        throw unavailable("GIPHY 시간당 한도를 넘었다. 잠시 뒤 다시 하라");
      asked.push(now);
      const url = new URL(query ? "/v1/gifs/search" : "/v1/gifs/trending", base);
      url.search = new URLSearchParams({
        api_key: key,
        limit: "24",
        rating: "r",
        ...(query && { q: query, lang: "ko" }),
      }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(
        () => undefined,
      );
      const json = await response?.json().catch(() => undefined);
      if (!response?.ok || !Array.isArray(json?.data)) throw unavailable("GIPHY가 답하지 않았다");
      // 웹이 쓰는 것(주소, 크기, 제목)만 넘긴다. 크기는 글자로 온다. 모양이 다르거나 GIPHY 밖의 주소면 뺀다.
      return json.data.flatMap((found: Found) => {
        const image = found.images?.fixed_width;
        const gif = Gif.safeParse({
          id: found.id,
          title: typeof found.title === "string" ? found.title : "",
          url: image?.url,
          width: Number(image?.width),
          height: Number(image?.height),
        });
        return gif.success && MEDIA.test(gif.data.url) && gif.data.width > 0 && gif.data.height > 0
          ? [gif.data]
          : [];
      });
    },
  };
}
