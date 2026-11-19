import type { Gif } from "@omagari/contract";
import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { giphyUrl } from "./giphy.ts";

/** 치다가 이만큼 멈추면 찾는다. */
const PAUSE_MS = 400;

/** 높이가 낮은 열부터 채워 두 열의 엇갈린 격자로 나눈다. */
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
 * GIF 칸(DESIGN.md "GIF", 시안 102-A): 찾기 칸, 두 열의 엇갈린 격자, "Powered by GIPHY" 줄.
 * 찾기는 서버를 거친다(`search`). 비어 있으면 인기 GIF다. 고르면 `onPick`, Esc면 `onClose`.
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
  /** 격자의 칸 `[열, 줄]`로 초점을 옮긴다. 줄은 그 열의 끝에 맞춘다. */
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
      aria-label="GIF 찾기"
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
          // biome-ignore lint/a11y/noAutofocus: 열면 바로 찾게 초점이 찾기 칸에 온다(DESIGN.md "GIF")
          autoFocus
          type="search"
          aria-label="GIF 찾기"
          placeholder="GIPHY에서 찾기"
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
            ? "지금은 GIF를 찾을 수 없어요"
            : found.status === "ready"
              ? "찾는 GIF가 없어요"
              : ""}
        </p>
      )}
      <p className="gif-foot">
        <strong>Powered by GIPHY</strong> · 찾는 말은 GIPHY로 가요
      </p>
    </div>
  );
}

/**
 * 입력 칸의 GIF 버튼(DESIGN.md "입력")과 그 위에 열리는 GIF 칸. 고르면 칸을 닫고 `onPick`, 닫히면 `onClosed`(초점을 입력 칸으로).
 * 바깥을 누르면 닫는다.
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
 * 메시지 속 GIF: 주소 대신 그림. 브라우저가 GIPHY에서 바로 받는다(보내는 쪽 주소는 싣지 않는다).
 * 움직임 줄이기를 켠 사람에게는 멈춘 첫 장면을 보이고, 누르면 움직인다.
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
      aria-label="GIF 움직이기"
      onClick={() => setPlay(true)}
    >
      {image}
    </button>
  );
}
