import type { ReplyTo } from "@omagari/contract";
import { TextQuote, X } from "lucide-react";
import { useEffect, useState } from "react";
import { giphyImage } from "./giphy.ts";
import { t } from "./i18n.ts";
import { Avatar } from "./workspace.tsx";

/** Who you're replying to in the composer (DESIGN.md "Reply, thread, and quote", draft 113-A). */
export type Replying = { id: number; login: string; name: string; notify: boolean };

/** `> ` lines that start a quote (draft 115-B). With `login`, the first line is `> **login**`. Empty lines stay inside the quote. */
export const quoteLines = (text: string, login?: string) =>
  [...(login ? [`**${login}**`] : []), ...text.trim().split("\n")]
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

/** Puts a quote at the start of `text`, then a blank line. Returns the new text and where the caret goes (after the blank line). */
export const withQuote = (text: string, quote: string) => ({
  text: `${quote}\n\n${text}`,
  caret: quote.length + 2,
});

/** Scrolls to message `id` in the conversation and paints it briefly (app-message-highlight). False if it isn't drawn. */
export function flashMessage(id: number) {
  const row = document.querySelector<HTMLElement>(`[data-message="${id}"]`);
  if (!row) return false;
  row.scrollIntoView({ block: "center" });
  row.classList.remove("highlight");
  void row.offsetWidth; // repaint so the highlight restarts
  row.classList.add("highlight");
  return true;
}

/**
 * The line above a reply: a hook from the avatar, the original's avatar, name, and first line. Pressing it goes to the original.
 * If the original can't be loaded, the same italic line shows whether it was deleted or can't be seen (#239).
 */
export function ReplyLine({ replyTo }: { replyTo: ReplyTo }) {
  const { original } = replyTo;
  if (!original)
    return (
      <p className="reply-line">
        <em className="reply-gone">{t.conversation.reply.gone}</em>
      </p>
    );
  return (
    <p className="reply-line">
      {/* ponytail: an original older than what's loaded doesn't scroll. Load history up to it if people miss it. */}
      <button
        type="button"
        className="reply-jump"
        aria-label={t.conversation.reply.jump}
        onClick={() => flashMessage(replyTo.id)}
      >
        <Avatar name={original.name} login={original.login} size={16} />
        <strong>{original.name}</strong>
        <span className="reply-text">
          {giphyImage(original.line) ? t.conversation.reply.gif : original.line}
        </span>
      </button>
    </p>
  );
}

/** The 32px strip on top of the composer while replying: whom, the `@` toggle, and "Stop replying". */
export function ReplyStrip({
  replying,
  onChange,
}: {
  replying: Replying;
  onChange: (next?: Replying) => void;
}) {
  const r = t.conversation.reply;
  return (
    <div className="reply-strip">
      <span className="reply-strip-who">
        {r.replyingTo[0]}
        <strong>{replying.name}</strong>
        {r.replyingTo[1]}
      </span>
      <button
        type="button"
        className="reply-notify"
        aria-pressed={replying.notify}
        aria-label={r.notify(replying.name)}
        onClick={() => onChange({ ...replying, notify: !replying.notify })}
      >
        @ {replying.notify ? r.on : r.off}
      </button>
      <button
        type="button"
        className="reply-stop"
        aria-label={r.stop}
        title={r.stop}
        onClick={() => onChange(undefined)}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

const QUOTED = /^>(?: |$)/;
const WHO = /^\*\*([A-Za-z0-9-]+)\*\*$/;

/**
 * A person's message text. `> ` lines show as a quote block; a first quoted line of only `**login**` shows as that member's avatar and name
 * (a login that isn't a member shows as the login). React inserts everything as plain characters.
 */
export function MessageText({ text, nameOf }: { text: string; nameOf: (login: string) => string }) {
  const blocks: { quote: boolean; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const quote = QUOTED.test(line);
    const last = blocks.at(-1);
    const content = quote ? line.replace(QUOTED, "") : line;
    if (last?.quote === quote) last.lines.push(content);
    else blocks.push({ quote, lines: [content] });
  }
  return (
    <div className="message-text">
      {blocks.map(({ quote, lines }, i) => {
        if (!quote) {
          const body = lines.join("\n").replace(/^\n+|\n+$/g, "");
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are in text order and never move
          return body && <p key={i}>{body}</p>;
        }
        const who = WHO.exec(lines[0] ?? "")?.[1];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are in text order and never move
          <blockquote key={i} className="quote">
            {who && (
              <span className="quote-who">
                <Avatar name={nameOf(who)} login={who} size={16} />
                {nameOf(who)}
              </span>
            )}
            <p>{(who ? lines.slice(1) : lines).join("\n")}</p>
          </blockquote>
        );
      })}
    </div>
  );
}

/**
 * The floating "Quote Q" button under a text selection inside one `within` element (a channel message, a DM answer), like GitHub's R.
 * The element's `data-login` becomes the quote's `**login**` line. Q quotes too while it shows.
 */
export function SelectionQuote({
  within,
  onQuote,
}: {
  within: string;
  onQuote: (text: string, login?: string) => void;
}) {
  const [shown, setShown] = useState<{ x: number; y: number; text: string; login?: string }>();
  useEffect(() => {
    const sync = () => {
      const selection = document.getSelection();
      const text = selection?.toString().trim();
      const box = (node: Node | null | undefined) =>
        (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(within);
      const from = box(selection?.anchorNode);
      if (!selection || !text || !from || from !== box(selection.focusNode)) {
        setShown(undefined);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setShown({ x: rect.left, y: rect.bottom + 4, text, login: from.dataset.login });
    };
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, [within]);
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "q" || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as Element | null)?.closest("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      onQuote(shown.text, shown.login);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown, onQuote]);
  if (!shown) return null;
  return (
    <button
      type="button"
      className="selection-quote"
      style={{ left: shown.x, top: shown.y }}
      onPointerDown={(event) => event.preventDefault()} // keep the selection
      onClick={() => onQuote(shown.text, shown.login)}
    >
      <TextQuote size={14} aria-hidden />
      {t.conversation.reply.quote}
      <kbd>Q</kbd>
    </button>
  );
}
