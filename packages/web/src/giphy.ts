/**
 * One GIF from GIPHY (ADR-0056). `preview` is what the picker shows (200px wide) and `url` is what gets sent.
 * Both are exactly the URLs GIPHY gave, query and all: GIPHY forbids changing them.
 */
export type Gif = {
  id: string;
  title: string;
  preview: string;
  url: string;
  width: number;
  height: number;
};

/** GIPHY image URLs. We only draw these, so a message can't make the viewer's browser load any other address (ADR-0044). */
const MEDIA = /^https:\/\/media\d*\.giphy\.com\/media\//;

type Found = {
  id?: unknown;
  title?: unknown;
  images?: Record<string, { url?: unknown; width?: unknown; height?: unknown } | undefined>;
};

/**
 * Asks GIPHY straight from the browser with the server's key (ADR-0056): trending when `query` is empty.
 * Rating up to R, 24 at a time. Over GIPHY's hourly limit or offline, it throws.
 */
export async function searchGiphy(key: string, query: string): Promise<Gif[]> {
  const url = new URL(query ? "/v1/gifs/search" : "/v1/gifs/trending", "https://api.giphy.com");
  url.search = new URLSearchParams({
    api_key: key,
    limit: "24",
    rating: "r",
    ...(query && { q: query, lang: "ko" }),
  }).toString();
  const response = await fetch(url);
  const json = await response.json().catch(() => undefined);
  if (!response.ok || !Array.isArray(json?.data)) throw new Error("GIPHY didn't answer");
  // GIPHY's order and choice stay as they are. Only an entry without GIPHY image URLs can't be drawn, so it's skipped.
  return json.data.flatMap((found: Found) => {
    const small = found.images?.fixed_width;
    const gif = {
      id: String(found.id),
      title: typeof found.title === "string" ? found.title : "",
      preview: small?.url,
      url: found.images?.original?.url,
      width: Number(small?.width),
      height: Number(small?.height),
    };
    return typeof gif.preview === "string" &&
      typeof gif.url === "string" &&
      MEDIA.test(gif.preview) &&
      MEDIA.test(gif.url) &&
      gif.width > 0 &&
      gif.height > 0
      ? [gif as Gif]
      : [];
  });
}

/**
 * A GIF in a message (DESIGN.md "GIF"): the image to draw if the text is a single GIPHY URL, otherwise undefined.
 * A `media*.giphy.com/media/…` URL is drawn exactly as written. A pasted `giphy.com/gifs/name-id` page link isn't an image, so it becomes the GIF's image URL.
 * Other image URLs aren't drawn (ADR-0044).
 */
export function giphyImage(text: string) {
  if (
    /^https:\/\/media\d*\.giphy\.com\/media\/(?:v1\.[\w.=-]+\/)?[A-Za-z0-9]+\/[\w.]+(?:\?\S*)?$/.test(
      text,
    )
  )
    return text;
  const page =
    /^https:\/\/(?:www\.)?giphy\.com\/gifs\/(?:[\w-]*-)?([A-Za-z0-9]+)\/?(?:\?\S*)?$/.exec(text);
  return page ? `https://media.giphy.com/media/${page[1]}/giphy.gif` : undefined;
}
