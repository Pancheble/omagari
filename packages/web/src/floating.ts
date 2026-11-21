type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Where a fixed popover goes: right-aligned to its anchor, below it if it fits, else above, and always inside the window (`margin` from each edge).
 * The anchor can sit anywhere, so right-aligning alone pushes the popover off the left edge (a reaction button at the end of a pill row is near the left).
 * If it fits neither below nor above, it slides along the anchor until it fits (and may cover the anchor).
 */
export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  win: { width: number; height: number },
  gap = 4,
  margin = 8,
) {
  const left = Math.max(
    margin,
    Math.min(anchor.right - size.width, win.width - size.width - margin),
  );
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const top =
    below + size.height <= win.height - margin
      ? below
      : above >= margin
        ? above
        : win.height - size.height - margin;
  return { left, top: Math.max(margin, top) };
}
