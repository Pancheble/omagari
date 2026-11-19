import type { Gif } from "@omagari/contract";
import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { giphyUrl } from "./giphy.ts";
import { t } from "./i18n.ts";

/** Search once typing pauses this long. */
const PAUSE_MS = 400;

/** Splits GIFs into a two-column staggered grid, filling the shorter column first. */
function columns(gifs: Gif[]) {
  const cols: [Gif[], Gif[]] = [[], []];
  const heights = [0, 0];
  for (const gif of gifs) {
    const i = heights[0] <= heights[1] ? 0 : 1;
    cols[i].push(gif);
    heights[i] += gif.height / gif.width;
  }
  return cols;
}

/**
 * The GIF picker (DESIGN.md "GIF", mockup 102-A): a search field, a two-column staggered grid, and a "Powered by GIPHY" line.
 * Search goes through the server (`search`). Empty means trending GIFs. Picking calls `onPick`, and Esc calls `onClose`.
 */
export function GifPicker({
  search,
  onPick,
  onClose,
}: {
  search: (query: string) => Promise<Gif[]>;
  onPick: (gif: Gif) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ status: "loading" | "ready" | "error"; gifs: Gif[] }>({
    status: "loading",
    gifs: [],
  });
  const grid = useRef<HTMLDivElement>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        searchRef.current(query.trim()).then(
          (gifs) => live && setFound({ status: "ready", gifs }),
          () => live && setFound({ status: "error", gifs: [] }),
        ),
      query.trim() ? PAUSE_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const cols = columns(found.gifs);
  /** Moves focus to the grid cell `[column, row]`. The row is clamped to the end of that column. */
  const focus = (col: number, row: number) => {
    const buttons = grid.current?.children[col]?.querySelectorAll("button");
    if (!buttons?.length) return;
    buttons[Math.max(0, Math.min(row, buttons.length - 1))]?.focus();
  };
  const onGridKey = (event: KeyboardEvent, col: number, row: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [col, row - 1],
      ArrowDown: [col, row + 1],
      ArrowLeft: [0, row],
      ArrowRight: [1, row],
    };
    const to = moves[event.key];
    if (!to) return;
    event.preventDefault();
    focus(...to);
  };

  return (
    <div
      className="menu gif-picker"
      role="dialog"
      aria-label={t.profile.gif.find}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <label className="palette-find gif-find">
        <Search size={14} aria-hidden />
        <input
          // biome-ignore lint/a11y/noAutofocus: focus goes to the search field so you can search right away (DESIGN.md "GIF")
          autoFocus
          type="search"
          aria-label={t.profile.gif.find}
          placeholder={t.profile.gif.placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            focus(0, 0);
          }}
        />
      </label>
      {found.status === "ready" && found.gifs.length > 0 ? (
        <div className="gif-grid" ref={grid} aria-busy={false}>
          {cols.map((col, c) => (
            <div key={c === 0 ? "left" : "right"} className="gif-col">
              {col.map((gif, r) => (
                <button
                  key={gif.id}
                  type="button"
                  className="gif-cell"
                  aria-label={gif.title || "GIF"}
                  style={{ aspectRatio: `${gif.width} / ${gif.height}` }}
                  onClick={() => onPick(gif)}
                  onKeyDown={(event) => onGridKey(event, c, r)}
                >
                  <img src={gif.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="gif-empty" role="status" aria-busy={found.status === "loading"}>
          {found.status === "error"
            ? t.profile.gif.unavailable
            : found.status === "ready"
              ? t.profile.gif.none
              : ""}
        </p>
      )}
      <p className="gif-foot">
        <strong>Powered by GIPHY</strong> · {t.profile.gif.foot}
      </p>
    </div>
  );
}

/**
 * The GIF button in the composer (DESIGN.md "Composer") and the GIF picker that opens above it. Picking closes the picker and calls `onPick`; closing calls `onClosed` (focus goes back to the composer).
 * Pressing outside closes it.
 */
export function GifButton({
  search,
  onPick,
  onClosed,
}: {
  search: (query: string) => Promise<Gif[]>;
  onPick: (gif: Gif) => void;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    onClosed();
  };
  return (
    <span className="emoji-anchor" ref={wrap}>
      <button
        type="button"
        className="composer-icon"
        aria-label="GIF"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip="GIF"
        onClick={() => setOpen(!open)}
      >
        <span className="gif-mark" aria-hidden>
          GIF
        </span>
      </button>
      {open && (
        <GifPicker
          search={search}
          onPick={(gif) => {
            close();
            onPick(gif);
          }}
          onClose={close}
        />
      )}
    </span>
  );
}

/**
 * A GIF in a message: a picture instead of the URL. The browser fetches it straight from GIPHY (the sender's URL isn't included).
 * For people with reduced motion on, it shows the still first frame, and pressing it plays.
 */
export function MessageGif({ id }: { id: string }) {
  const [play, setPlay] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const image = (
    <>
      <img src={giphyUrl(id, !play)} alt="GIF" referrerPolicy="no-referrer" />
      <span className="gif-tag" aria-hidden>
        GIF
      </span>
    </>
  );
  return play ? (
    <span className="message-gif">{image}</span>
  ) : (
    <button
      type="button"
      className="message-gif"
      aria-label={t.profile.gif.play}
      onClick={() => setPlay(true)}
    >
      {image}
    </button>
  );
}
