import { ContractFailure, Gif } from "@omagari/contract";

/** The server's outer boundary: GIPHY (ADR-0044). Only the server keeps the key and asks on people's behalf. Tests plug a fake GIPHY into `base`. */
export type Giphy = { search(query: string): Promise<Gif[]> };

/** The images in the search box only accept GIPHY image URLs. We don't pass other addresses to the web. */
const MEDIA = /^https:\/\/media\d*\.giphy\.com\//;
const HOUR_MS = 60 * 60_000;

/** The parts we use of one GIF in a GIPHY response. We don't trust it; we check field by field. */
type Found = {
  id?: unknown;
  title?: unknown;
  images?: { fixed_width?: { url?: unknown; width?: unknown; height?: unknown } };
};

/**
 * The real GIPHY. Rating up to R, 24 per request. `perHour` is the key's hourly limit (100 for beta keys).
 * Past it, we refuse without asking GIPHY. We don't keep the results we found (GIPHY's terms).
 */
export function realGiphy(
  key: string,
  { base = "https://api.giphy.com", perHour = 100 } = {},
): Giphy {
  /** When we asked GIPHY in the last hour. */
  let asked: number[] = [];
  const unavailable = (message: string) => new ContractFailure({ code: "internal", message });
  return {
    async search(query) {
      const now = Date.now();
      asked = asked.filter((at) => now - at < HOUR_MS);
      if (asked.length >= perHour)
        throw unavailable("Over GIPHY's hourly limit. Try again in a bit");
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
      if (!response?.ok || !Array.isArray(json?.data)) throw unavailable("GIPHY didn't answer");
      // Pass along only what the web uses (URL, size, title). The size comes as a string. Drop it if the shape is off or the URL isn't GIPHY's.
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
