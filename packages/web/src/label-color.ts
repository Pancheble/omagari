/** Relative luminance (WCAG) of a `rrggbb` color. */
const luminance = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((at) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio of two `rrggbb` colors. */
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const toHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};

const fromHsl = (h: number, s: number, l: number) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r, g, b]
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
};

/** The dark panel (DESIGN.md `dark-panel`). */
const DARK_PANEL = "272729";

/**
 * A label dot's color on the dark screen (DESIGN.md "Dark mode", draft 109-A): keep hue and saturation and raise
 * HSL lightness 1% at a time until the dot is 3:1 against the dark panel. Colors that already pass stay as they are.
 */
export function onDark(hex: string) {
  const [h, s, l] = toHsl(hex);
  let out = hex.toLowerCase();
  for (let step = Math.round(l * 100); contrast(out, DARK_PANEL) < 3 && step < 100; step++) {
    out = fromHsl((h + 360) % 360, s, (step + 1) / 100);
  }
  return out;
}
