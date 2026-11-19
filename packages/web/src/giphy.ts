/**
 * A GIF in a message (DESIGN.md "GIF"): the GIF's id if the text is a single GIPHY URL, otherwise undefined.
 * Accepts `giphy.com/gifs/name-id` and `media*.giphy.com/media/(v1.…/)id/file`. Other image URLs aren't drawn (ADR-0044).
 */
export function giphyId(text: string) {
  const match =
    /^https:\/\/(?:www\.)?giphy\.com\/gifs\/(?:[\w-]*-)?([A-Za-z0-9]+)\/?(?:\?\S*)?$/.exec(text) ??
    /^https:\/\/media\d*\.giphy\.com\/media\/(?:v1\.[\w.=-]+\/)?([A-Za-z0-9]+)\/[\w.]+(?:\?\S*)?$/.exec(
      text,
    );
  return match?.[1];
}

/** The one-line GIPHY URL put in the message when sending a GIF. With `still`, it's the still first frame. */
export const giphyUrl = (id: string, still = false) =>
  `https://media.giphy.com/media/${id}/${still ? "giphy_s" : "giphy"}.gif`;
