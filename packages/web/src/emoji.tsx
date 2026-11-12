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

/**
 * 이모지 팔레트(DESIGN.md "이모지 팔레트"). 이모지와 한국어 이름, 찾는 말은 Emojibase 한국어 데이터(`emojibase-data`의 `ko`)다.
 * 데이터는 Vite가 웹 빌드의 한 조각으로 내려준다. 외부 CDN에 묻지 않는다.
 */

type Emoji = { emoji: string; label: string };
type Item = Emoji & { tags: string[]; group: number; skins?: Emoji[] };
type Data = { items: Item[]; labels: Map<string, string> };

/** Emojibase의 분류 아홉(2번 "구성 요소"는 피부색과 머리 조각이라 뺀다). 이름은 Emojibase `ko` messages와 같다. */
const GROUPS: [group: number, name: string, Icon: LucideIcon][] = [
  [0, "웃는 얼굴과 감정", Smile],
  [1, "사람과 몸", Hand],
  [3, "동물과 자연", PawPrint],
  [4, "음식 및 음료", Apple],
  [5, "여행 및 장소", Car],
  [6, "활동", Trophy],
  [7, "사물", Lightbulb],
  [8, "기호", Heart],
  [9, "깃발", Flag],
];
const RECENT = "최근 사용";
/** 피부색: 기본과 Emojibase의 다섯(tone 1~5). 이름은 Emojibase `ko` messages와 같다. */
const TONES = [
  "기본",
  "밝은 피부 톤",
  "중간 밝은 피부 톤",
  "중간 피부 톤",
  "중간 어두운 피부 톤",
  "어두운 피부 톤",
];
const MODIFIERS = ["", "🏻", "🏼", "🏽", "🏾", "🏿"];
const MAX_RECENT = 12;
const RECENT_KEY = "omagari.emoji.recent";
const TONE_KEY = "omagari.emoji.tone";

/** 이모지를 그릴 글꼴. 본문 글꼴(IBM Plex Sans KR)이 ©나 ↔를 흑백 글자로 그리지 않게 색 이모지 글꼴을 먼저 둔다. app.css의 `--emoji`와 같다. */
const EMOJI_FONT =
  '"Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", "Twemoji Mozilla", "Android Emoji", sans-serif';

/**
 * 이 기기가 이 이모지를 한 글자 색 그림으로 그리는가. 모르는 이모지는 빈 네모나 글자색을 따르는 흑백 글자가 되고,
 * 모르는 ZWJ 묶음은 여러 그림으로 갈라져 넓어진다. 같은 이모지를 두 색으로 그려 같으면 색 그림이다.
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

let loading: Promise<Data> | undefined;
let loaded: Data | undefined;
/**
 * 데이터를 한 번 불러 이 기기가 그리는 것만 남긴다. 그리는지는 이모지 판마다 첫 이모지로 가리고(새 판부터 내려가며 처음 그리는 판까지),
 * 나라 깃발은 따로 본다(Windows는 깃발을 그리지 않는다).
 */
export const loadEmoji = () => {
  loading ??= import("emojibase-data/ko/data.json").then(({ default: all }) => {
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
    loaded = { items, labels };
    return loaded;
  });
  return loading;
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
    // 저장소를 막아 둔 브라우저면 이번 창에서만 기억한다.
  }
};
const isTone = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value < TONES.length;
const isList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((emoji) => typeof emoji === "string");

type Section = { name: string; Icon: LucideIcon; emojis: Emoji[] };

/**
 * 이모지 팔레트. 위에서부터 찾기 줄, 분류마다 제목과 격자, 분류 막대다. 열리면 찾기 칸에 초점이 온다.
 * 이모지를 고르면 `onPick`, "지우기"는 `onClear`, Esc는 `onClose`다. 바깥 누르기는 부르는 쪽이 닫는다.
 */
export function EmojiPalette({
  current,
  onPick,
  onClear,
  onClose,
}: {
  current: string | null;
  onPick: (emoji: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState(loaded);
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

  // 열 수는 목록 폭에 맞춘다: 넓은 화면은 12열, 좁은 화면(시트)은 44px 칸이 들어가는 만큼.
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
      name: RECENT,
      Icon: Clock,
      emojis: words
        ? []
        : recent.flatMap((emoji) => {
            const label = data?.labels.get(emoji);
            return label ? [{ emoji, label }] : [];
          }),
    },
    ...GROUPS.map(([group, name, Icon]) => ({
      name,
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
  /** 키보드로 옮겨 다니는 줄. 분류가 바뀌면 새 줄에서 시작한다. */
  const rows = visible.flatMap((section, at) =>
    Array.from({ length: Math.ceil(section.emojis.length / columns) }, (_, row) => ({
      section: at,
      emojis: section.emojis.slice(row * columns, (row + 1) * columns),
    })),
  );

  // 찾는 말이나 열 수가 바뀌면 처음 칸으로, 목록 맨 위로 돌아간다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 바뀐 것을 알리는 값만 본다
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

  /** 격자의 화살표(DESIGN.md "키보드"): 칸을 옮기고, 첫 줄에서 위로 가면 찾기 칸으로 돌아간다. Enter는 칸(버튼)이 받는다. */
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

  /** 지금 보이는 분류: 목록 맨 위를 지난 마지막 제목. */
  const onScroll = () => {
    const viewport = list.current;
    if (!viewport) return;
    const heads = [...viewport.querySelectorAll<HTMLElement>("[data-section]")];
    const passed = heads.filter((head) => head.offsetTop <= viewport.scrollTop + 8);
    setShown(passed.length > 0 ? passed.length - 1 : 0);
  };

  const pick = (emoji: string) => {
    store(RECENT_KEY, [emoji, ...recent.filter((other) => other !== emoji)].slice(0, MAX_RECENT));
    onPick(emoji);
  };

  return (
    <div
      className="menu emoji-palette"
      role="dialog"
      aria-label="이모지 고르기"
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
            aria-label="이모지 찾기"
            placeholder="이모지 찾기 (예: 웃음, 고양이)"
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
          aria-label={`피부색: ${TONES[tone]}`}
          title={`피부색: ${TONES[tone]}`}
          onClick={() => {
            const next = (tone + 1) % TONES.length;
            setTone(next);
            store(TONE_KEY, next);
          }}
        >
          ✋{MODIFIERS[tone]}
        </button>
        <button type="button" className="button quiet" onClick={onClear}>
          지우기
        </button>
      </div>
      {/* ponytail: 2천 칸을 가상 스크롤 없이 모두 그린다. 느린 기기에서 무거우면 보이는 줄만 그린다. */}
      <div className="emoji-list" ref={list} onScroll={onScroll}>
        {data && rows.length === 0 && <p className="emoji-empty">찾는 이모지가 없어요</p>}
        {visible.map((section, at) => (
          <section key={section.name} className="emoji-section">
            <h3 id={`${id}-${at}`} data-section>
              {section.name}
            </h3>
            {/* biome-ignore lint/a11y/useSemanticElements: 화살표로 칸을 옮기는 격자(WAI-ARIA grid)다. 표가 아니다 */}
            <div role="grid" aria-labelledby={`${id}-${at}`} onKeyDown={onGridKey}>
              {rows.map(
                (row, index) =>
                  row.section === at && (
                    // biome-ignore lint/a11y/useFocusableInteractive: 줄은 칸을 묶을 뿐이고 초점은 칸이 받는다
                    // biome-ignore lint/a11y/useSemanticElements: 격자의 줄이다
                    <div key={row.emojis[0]?.emoji} role="row" className="emoji-row">
                      {row.emojis.map(({ emoji, label }, column) => (
                        // biome-ignore lint/a11y/useSemanticElements: 격자의 칸이다. 누르면 고르는 버튼이다
                        <button
                          key={emoji}
                          type="button"
                          role="gridcell"
                          data-cell={`${index}:${column}`}
                          tabIndex={active[0] === index && active[1] === column ? 0 : -1}
                          aria-label={label}
                          aria-selected={emoji === current}
                          title={label}
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
      <nav className="emoji-bar" aria-label="분류">
        {sections.map((section) => {
          const at = visible.indexOf(section);
          return (
            <button
              key={section.name}
              type="button"
              aria-label={section.name}
              title={section.name}
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
