import type { Language } from "@omagari/contract";
import { useSyncExternalStore } from "react";
import { en } from "./words/en.ts";
import { ko } from "./words/ko.ts";

/**
 * Screen text, one dictionary per language (ADR-0045). English is the source; every other dictionary is typed
 * `Words`, so a missing or extra key fails `npm run typecheck`. Text that takes a number or a name is a function.
 * Plurals, dates, and relative times go through `Intl` with `language`, not hand-written rules.
 * Contract values that show on screen (importance, check problems, …) are keyed by the contract's own key.
 */
export type Words = typeof en;
const dictionaries: Record<Language, Words> = { en, ko };

/** Each language's name, written in that language. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", ko: "한국어" };

/** The current language and its words. Live bindings: read them while rendering, don't keep a copy. */
export let language: Language = "en";
export let t: Words = en;

const listeners = new Set<() => void>();

/** Switches every screen to `next`. Called with the member's saved choice, and `en` before login. */
export function setLanguage(next: Language) {
  if (next === language) return;
  language = next;
  t = dictionaries[next];
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

/** Re-renders the caller when the language changes. The app root uses it, so every screen redraws. */
export const useLanguage = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => language,
  );

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 24 * 60],
  ["hour", 60],
  ["minute", 1],
];

/** "3 minutes ago" / "3분 전": how long ago `iso` was, in the current language. */
export function ago(iso: string) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return t.justNow;
  const [unit, size] = UNITS.find(([, size]) => minutes >= size) ?? UNITS[2] ?? ["minute", 1];
  return new Intl.RelativeTimeFormat(language, { numeric: "always" }).format(
    -Math.floor(minutes / size),
    unit,
  );
}
