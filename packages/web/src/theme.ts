import type { Appearance } from "@omagari/contract";
import { useSyncExternalStore } from "react";

/**
 * The look (#312). The dark screen is the light one with the CSS color variables swapped (DESIGN.md "Dark mode"):
 * this sets `data-theme` on the root, and `app.css` swaps the variables under `[data-theme="dark"]`.
 */
const system = matchMedia("(prefers-color-scheme: dark)");

/** The member's choice. Live binding: read it while rendering. Before login it follows the system. */
export let appearance: Appearance = "system";

/** What the computer shows right now. */
export const systemLook = () => (system.matches ? "dark" : "light");

/** What the screen shows right now. */
export const look = () => (appearance === "system" ? systemLook() : appearance);

const listeners = new Set<() => void>();

const apply = () => {
  document.documentElement.dataset.theme = look();
  for (const listener of listeners) listener();
};

/** Switches the look. Called with the member's saved choice, and `system` before login. */
export function setAppearance(next: Appearance) {
  appearance = next;
  apply();
}

// With "Match system", a change on the computer shows right away.
system.addEventListener("change", apply);
apply();

/** Re-renders the caller when the choice or the computer's look changes. */
export const useLook = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => `${appearance} ${systemLook()}`,
  );
