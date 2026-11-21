---
status: accepted
---

# GIF search goes from the browser straight to GIPHY, and GIPHY's URLs are used as given

The hosted beta needs a GIPHY production key (ADR-0052, #391). GIPHY's API docs, "Prohibited Integration Practices" (checked 2026-11-22), forbid two things ADR-0044 did: proxying requests to GIPHY (search and trending must come from the client) and stripping or changing the URLs the API returns, query params included. Decided on 2026-11-22 by @Pancheble (#418). This replaces ADR-0044's "the server asks on the browser's behalf"; the rest of ADR-0044 stands.

- **The browser asks GIPHY.** `api.me` gives a signed-in member the server's GIPHY key (`giphy`, null without one), and the web calls `api.giphy.com/v1/gifs/search` and `/trending` with it. `api.gifs` is gone. GIPHY now sees each person's IP address and search words, and the key is visible in the browser, which is how GIPHY's client-side calls work. Nothing on our server calls GIPHY.
- **Same choices as before.** 24 results, rating up to R, `lang=ko` on search. GIPHY's order and choice of results are kept; only an entry with no GIPHY image URL is skipped, since it can't be drawn.
- **GIPHY's URLs, untouched.** The picker shows `images.fixed_width.url`, and picking sends `images.original.url` as the message, exactly as GIPHY gave it. A message that is one `media*.giphy.com/media/…` URL is drawn from that exact text, so messages sent before this (`media.giphy.com/media/<id>/giphy.gif`) still show. A pasted `giphy.com/gifs/…` page link isn't an API URL, so it's still turned into its image URL.
- **Reduced motion loads nothing until play.** Showing a still frame meant changing the URL (`giphy_s.gif`), so instead the message shows a play box and loads the GIF when pressed.
- **Limits are GIPHY's.** The server can't count calls it doesn't see, so `GIPHY_PER_HOUR` and `OMAGARI_LIMIT_GIFS` (and the `gifs` limit in the contract) are gone; a server that still sets them ignores them. GIPHY counts per key across everyone on the server: a beta key gets 100 calls an hour. Over it, GIPHY refuses and the picker says "Can't search GIFs right now". This replaces ADR-0052's "the hosted server splits the beta key's hourly budget across workspaces": the hosted server needs the production key.
- **No analytics pingbacks.** GIPHY recommends calling onload, onclick, and onsent, but doesn't require them, and they'd send GIPHY more about each person.
- **A sent GIF stays in the message.** GIPHY forbids caching API responses and media URLs. We read that as a cache of results, not a URL a person chose to send, the same as Slack and Mattermost keep them. If GIPHY reads it otherwise when we apply for the production key, we revisit.

## Considered Options

- **Keep the proxy (ADR-0044)**: GIPHY wouldn't see people's IPs, but it breaks GIPHY's rules, so no production key.
- **A public endpoint for the key**: no need; only signed-in members use GIFs, and `api.me` already goes to them.
- **Store a still-frame URL next to the GIF**: a message is one line of text (ADR-0044); a second URL would need a new message kind.

## Consequences

- The privacy policy says GIF search sends a person's IP, browser info, and search words straight to GIPHY (ADR-0054).
- Tests: the server only hands out the key, so the harness no longer fakes GIPHY. The web's unit tests stub `fetch` to check the request and that GIPHY's URLs pass through untouched. The real GIPHY is checked by hand.
- `CONTRACT_VERSION` goes up: `api.gifs`, `Gif`, and the `gifs` limit are removed, and `api.me`'s `gif` became `giphy`.

## Sources

- [GIPHY API docs: Prohibited Integration Practices, Search, Trending, Action Register, rate limits](https://developers.giphy.com/docs/api/) (2026-11-22)
- [Zulip: browser searches the provider directly](https://zulip.readthedocs.io/en/latest/production/gif-picker-integrations.html)
