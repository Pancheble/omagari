import type { Language } from "@omagari/contract";
import {
  Apple,
  Car,
  Clock,
  Flag,
  Hand,
  Heart,
  Lightbulb,
  type LucideIcon,
  PawPrint,
  Search,
  Smile,
  Trophy,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { language, t } from "./i18n.ts";

/**
 * The emoji palette (DESIGN.md "Emoji palette"). The emoji, their names, and search words come from the Emojibase data for the current language (`en` or `ko` in `emojibase-data`).
 * Vite ships the data as a chunk of the web build. It never asks an external CDN.
 */

type Emoji = { emoji: string; label: string };
type Item = Emoji & { tags: string[]; group: number; skins?: Emoji[] };
type Data = { items: Item[]; labels: Map<string, string> };

/** Emojibase's nine groups (group 2, "components", is skin tones and hair pieces, so it's left out). Names are in the dictionary, same as Emojibase's messages. */
const GROUPS: [group: number, Icon: LucideIcon][] = [
  [0, Smile],
  [1, Hand],
  [3, PawPrint],
  [4, Apple],
  [5, Car],
  [6, Trophy],
  [7, Lightbulb],
  [8, Heart],
  [9, Flag],
];
/** Skin tones: default plus Emojibase's five (tone 1-5). Names are in the dictionary. */
const MODIFIERS = ["", "🏻", "🏼", "🏽", "🏾", "🏿"];
const MAX_RECENT = 12;
const RECENT_KEY = "omagari.emoji.recent";
const TONE_KEY = "omagari.emoji.tone";

/** The font that draws emoji. The color emoji fonts go first so the body font (IBM Plex Sans KR) doesn't draw © or ↔ as black-and-white text. Same as `--emoji` in app.css. */
const EMOJI_FONT =
  '"Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", "Twemoji Mozilla", "Android Emoji", sans-serif';

/**
 * Does this device draw this emoji as one color glyph? An unknown emoji becomes an empty box or a black-and-white glyph in the text color,
 * and an unknown ZWJ sequence splits into several glyphs and gets wider. If the same emoji drawn in two colors looks the same, it's a color glyph.
 */
function drawable(emoji: string) {
  const size = 16;
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return true;
  context.canvas.width = size;
  context.canvas.height = size;
  context.font = `${size}px ${EMOJI_FONT}`;
  context.textBaseline = "top";
  if (context.measureText(emoji).width >= size * 2) return false;
  const paint = (color: string) => {
    context.clearRect(0, 0, size, size);
    context.fillStyle = color;
    context.fillText(emoji, 0, 0);
    return context.getImageData(0, 0, size, size).data;
  };
  const blue = paint("#00f");
  const red = paint("#f00");
  return blue.some((value) => value !== 0) && blue.every((value, at) => value === red[at]);
}

const loading = new Map<Language, Promise<Data>>();
const loaded = new Map<Language, Data>();
/**
 * Load the data once and keep only what this device draws. Whether it draws is decided per emoji version by that version's first emoji (from the newest version down to the first one it draws),
 * and country flags are checked separately (Windows doesn't draw flags).
 */
export const loadEmoji = () => {
  const lang = language;
  const started = loading.get(lang);
  if (started) return started;
  const source =
    lang === "ko" ? import("emojibase-data/ko/data.json") : import("emojibase-data/en/data.json");
  const promise = source.then(({ default: all }) => {
    const usable = all.filter((emoji) => emoji.group !== undefined && emoji.group !== 2);
    const firsts = new Map<number, string>();
    for (const { version, emoji } of usable) if (!firsts.has(version)) firsts.set(version, emoji);
    const newest = [...firsts].sort(([a], [b]) => b - a).find(([, emoji]) => drawable(emoji));
    const version = newest?.[0] ?? Number.POSITIVE_INFINITY;
    const flags = drawable("🇪🇺");
    const items = usable
      .filter((emoji) => emoji.version <= version)
      .filter((emoji) => flags || !/\p{Regional_Indicator}|\u{E007F}/u.test(emoji.emoji))
      .map(({ emoji, label, tags, group, skins }): Item => {
        const tones = skins?.filter((skin) => typeof skin.tone === "number");
        return {
          emoji,
          label,
          tags: tags ?? [],
          group: group as number,
          skins:
            tones?.length === 5 ? tones.map(({ emoji, label }) => ({ emoji, label })) : undefined,
        };
      });
    const labels = new Map(
      items.flatMap((item) => [item, ...(item.skins ?? [])]).map((e) => [e.emoji, e.label]),
    );
    const data = { items, labels };
    loaded.set(lang, data);
    return data;
  });
  loading.set(lang, promise);
  return promise;
};

const stored = <T,>(key: string, fallback: T, valid: (value: unknown) => value is T): T => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // In a browser that blocks storage, it's remembered only in this window.
  }
};
const isTone = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value < MODIFIERS.length;
const isList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((emoji) => typeof emoji === "string");

/** Remember the chosen emoji at the front of "Recently used". */
export const remember = (emoji: string) =>
  store(
    RECENT_KEY,
    [emoji, ...stored(RECENT_KEY, [], isList).filter((other) => other !== emoji)].slice(
      0,
      MAX_RECENT,
    ),
  );

/** The loaded data for the current language, if any. Otherwise call `loadEmoji()`. */
export const loadedEmoji = () => loaded.get(language);

export type Found = { emoji: string; label: string; tag?: string };

/**
 * `:` autocomplete (DESIGN.md "Emoji in chat"): up to `limit` matches from names and search words, with recently used ones first.
 * `tag` is the search word that matched (absent if the name matched).
 */
export function findEmoji({ items }: Data, query: string, limit = 5): Found[] {
  const words = query.trim().toLowerCase();
  const recent = stored(RECENT_KEY, [], isList);
  const rank = (emoji: string) => {
    const at = recent.indexOf(emoji);
    return at < 0 ? recent.length : at;
  };
  return items
    .flatMap((item): Found[] => {
      if (item.label.toLowerCase().includes(words))
        return [{ emoji: item.emoji, label: item.label }];
      const tag = item.tags.find((tag) => tag.toLowerCase().includes(words));
      return tag ? [{ emoji: item.emoji, label: item.label, tag }] : [];
    })
    .sort((a, b) => rank(a.emoji) - rank(b.emoji))
    .slice(0, limit);
}

type Section = { name: string; Icon: LucideIcon; emojis: Emoji[] };

/**
 * The emoji palette. From the top: the search row, a heading and grid for each category, and the category bar. When it opens, focus goes to the search field.
 * Picking an emoji calls `onPick`, "Clear" calls `onClear`, and Esc calls `onClose`. Pressing outside is closed by the caller.
 */
export function EmojiPalette({
  current,
  onPick,
  onClear,
  onClose,
  hideClear,
}: {
  current: string | null;
  onPick: (emoji: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Where the emoji slot is never emptied (the chat composer), there's no "Clear". */
  hideClear?: boolean;
}) {
  const [data, setData] = useState(loadedEmoji);
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState(() => stored(TONE_KEY, 0, isTone));
  const [recent] = useState(() => stored(RECENT_KEY, [], isList));
  const [columns, setColumns] = useState(12);
  const [active, setActive] = useState<[row: number, column: number]>([0, 0]);
  const [shown, setShown] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (!data) void loadEmoji().then(setData);
    search.current?.focus();
  }, [data]);

  // The column count fits the list width: 12 on wide screens, and as many 44px cells as fit on narrow ones (the sheet).
  useLayoutEffect(() => {
    const viewport = list.current;
    if (!viewport) return;
    const fit = () => {
      const style = getComputedStyle(viewport);
      const cell = Number.parseFloat(style.getPropertyValue("--cell")) + 2;
      const width =
        viewport.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      setColumns(Math.max(1, Math.floor((width + 2) / cell)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const words = query.trim().toLowerCase();
  const toned = (item: Item) => (tone > 0 && item.skins?.[tone - 1]) || item;
  const sections: Section[] = [
    {
      name: t.profile.emoji.recent,
      Icon: Clock,
      emojis: words
        ? []
        : recent.flatMap((emoji) => {
            const label = data?.labels.get(emoji);
            return label ? [{ emoji, label }] : [];
          }),
    },
    ...GROUPS.map(([group, Icon]) => ({
      name: t.profile.emoji.groups[group] ?? "",
      Icon,
      emojis: (data?.items ?? [])
        .filter(
          (item) =>
            item.group === group &&
            (!words ||
              item.label.toLowerCase().includes(words) ||
              item.tags.some((tag) => tag.toLowerCase().includes(words))),
        )
        .map(toned),
    })),
  ];
  const visible = sections.filter((section) => section.emojis.length > 0);
  /** The rows you move through by keyboard. A new category starts a new row. */
  const rows = visible.flatMap((section, at) =>
    Array.from({ length: Math.ceil(section.emojis.length / columns) }, (_, row) => ({
      section: at,
      emojis: section.emojis.slice(row * columns, (row + 1) * columns),
    })),
  );

  // When the search words or column count change, go back to the first cell and the top of the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the values that signal a change are read
  useEffect(() => {
    setActive([0, 0]);
    setShown(0);
    list.current?.scrollTo({ top: 0 });
  }, [words, columns]);

  const cell = ([row, column]: [number, number]) =>
    list.current?.querySelector<HTMLElement>(`[data-cell="${row}:${column}"]`);
  const move = (to: [number, number]) => {
    setActive(to);
    const target = cell(to);
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  };

  /** Arrow keys in the grid (DESIGN.md "Keyboard"): move between cells, and going up from the first row returns to the search field. Enter is handled by the cell (a button). */
  const onGridKey = (event: KeyboardEvent) => {
    const [row, column] = active;
    const last = (at: number) => (rows[at]?.emojis.length ?? 1) - 1;
    if (event.key === "ArrowRight") {
      if (column < last(row)) move([row, column + 1]);
      else if (row + 1 < rows.length) move([row + 1, 0]);
    } else if (event.key === "ArrowLeft") {
      if (column > 0) move([row, column - 1]);
      else if (row > 0) move([row - 1, last(row - 1)]);
    } else if (event.key === "ArrowDown") {
      if (row + 1 < rows.length) move([row + 1, Math.min(column, last(row + 1))]);
    } else if (event.key === "ArrowUp") {
      if (row > 0) move([row - 1, Math.min(column, last(row - 1))]);
      else search.current?.focus();
    } else return;
    event.preventDefault();
  };

  /** The category in view: the last heading that has passed the top of the list. */
  const onScroll = () => {
    const viewport = list.current;
    if (!viewport) return;
    const heads = [...viewport.querySelectorAll<HTMLElement>("[data-section]")];
    const passed = heads.filter((head) => head.offsetTop <= viewport.scrollTop + 8);
    setShown(passed.length > 0 ? passed.length - 1 : 0);
  };

  const pick = (emoji: string) => {
    remember(emoji);
    onPick(emoji);
  };

  return (
    <div
      className="menu emoji-palette"
      role="dialog"
      aria-label={t.profile.emoji.pick}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="palette-search">
        <label className="palette-find">
          <Search size={14} aria-hidden />
          <input
            ref={search}
            type="search"
            aria-label={t.profile.emoji.find}
            placeholder={t.profile.emoji.findPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" || rows.length === 0) return;
              event.preventDefault();
              move([0, 0]);
            }}
          />
        </label>
        <button
          type="button"
          className="tone-button"
          aria-label={t.profile.emoji.tone(t.profile.emoji.tones[tone] ?? "")}
          data-tip={t.profile.emoji.tone(t.profile.emoji.tones[tone] ?? "")}
          onClick={() => {
            const next = (tone + 1) % MODIFIERS.length;
            setTone(next);
            store(TONE_KEY, next);
          }}
        >
          ✋{MODIFIERS[tone]}
        </button>
        {!hideClear && (
          <button type="button" className="button quiet" onClick={onClear}>
            {t.profile.emoji.clear}
          </button>
        )}
      </div>
      {/* ponytail: draws all ~2,000 cells with no virtual scrolling. If that's heavy on slow devices, draw only the visible rows. */}
      <div className="emoji-list" ref={list} onScroll={onScroll}>
        {data && rows.length === 0 && <p className="emoji-empty">{t.profile.emoji.none}</p>}
        {visible.map((section, at) => (
          <section key={section.name} className="emoji-section">
            <h3 id={`${id}-${at}`} data-section>
              {section.name}
            </h3>
            {/* biome-ignore lint/a11y/useSemanticElements: a grid you move through with arrow keys (WAI-ARIA grid), not a table */}
            <div role="grid" aria-labelledby={`${id}-${at}`} onKeyDown={onGridKey}>
              {rows.map(
                (row, index) =>
                  row.section === at && (
                    // biome-ignore lint/a11y/useFocusableInteractive: a row only groups cells, and the cells take focus
                    // biome-ignore lint/a11y/useSemanticElements: a grid row
                    <div key={row.emojis[0]?.emoji} role="row" className="emoji-row">
                      {row.emojis.map(({ emoji, label }, column) => (
                        // biome-ignore lint/a11y/useSemanticElements: a grid cell. It is a button that picks on press
                        <button
                          key={emoji}
                          type="button"
                          role="gridcell"
                          data-cell={`${index}:${column}`}
                          tabIndex={active[0] === index && active[1] === column ? 0 : -1}
                          aria-label={label}
                          aria-selected={emoji === current}
                          data-tip={label}
                          onFocus={() => setActive([index, column])}
                          onClick={() => pick(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ),
              )}
            </div>
          </section>
        ))}
      </div>
      <nav className="emoji-bar" aria-label={t.profile.emoji.categories}>
        {sections.map((section) => {
          const at = visible.indexOf(section);
          return (
            <button
              key={section.name}
              type="button"
              aria-label={section.name}
              aria-current={at >= 0 && at === shown ? "true" : undefined}
              disabled={at < 0}
              onClick={() => {
                const viewport = list.current;
                const head = viewport?.querySelectorAll<HTMLElement>("[data-section]")[at];
                if (!viewport || !head) return;
                viewport.scrollTo({ top: head.offsetTop });
                setShown(at);
              }}
            >
              <section.Icon size={18} aria-hidden />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
