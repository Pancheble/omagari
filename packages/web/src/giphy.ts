/**
 * 메시지 속 GIF(DESIGN.md "GIF"): 글이 GIPHY 주소 하나뿐이면 그 GIF의 id. 아니면 undefined다.
 * `giphy.com/gifs/이름-id`와 `media*.giphy.com/media/(v1.…/)id/파일`을 받는다. 다른 이미지 주소는 그리지 않는다(ADR-0044).
 */
export function giphyId(text: string) {
  const match =
    /^https:\/\/(?:www\.)?giphy\.com\/gifs\/(?:[\w-]*-)?([A-Za-z0-9]+)\/?(?:\?\S*)?$/.exec(text) ??
    /^https:\/\/media\d*\.giphy\.com\/media\/(?:v1\.[\w.=-]+\/)?([A-Za-z0-9]+)\/[\w.]+(?:\?\S*)?$/.exec(
      text,
    );
  return match?.[1];
}

/** GIF를 보낼 때 담는 GIPHY 주소 한 줄. `still`이면 멈춘 첫 장면이다. */
export const giphyUrl = (id: string, still = false) =>
  `https://media.giphy.com/media/${id}/${still ? "giphy_s" : "giphy"}.gif`;
