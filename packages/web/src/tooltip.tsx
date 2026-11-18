import { useEffect, useRef } from "react";

/** 툴팁 글. `data-tip`이 있으면 그것, 없으면 글자 없이 아이콘만 있는 버튼·링크의 `aria-label`이다. */
export function tipOf(element: Element): string | undefined {
  if (!(element instanceof HTMLElement)) return undefined;
  if (element.dataset.tip) return element.dataset.tip;
  if (!element.matches("button, a")) return undefined;
  if (element.textContent?.trim()) return undefined;
  return element.getAttribute("aria-label") ?? undefined;
}

/**
 * `app-tooltip`(DESIGN.md "떠 있는 층"): 아이콘만 있는 버튼에 마우스가 0.5초 머물거나 키보드로 오면 아래에 뜬다.
 * 버튼마다 달지 않고 문서 하나에 하나를 둔다. 대화 상자 위에도 보이게 `popover`로 맨 위 층에 올린다.
 */
export function Tooltip() {
  const tip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = tip.current;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let target: Element | undefined;
    const hide = () => {
      clearTimeout(timer);
      target = undefined;
      if (node.matches(":popover-open")) node.hidePopover();
    };
    const show = (element: Element, text: string) => {
      node.textContent = text;
      node.showPopover();
      const box = element.getBoundingClientRect();
      const { width, height } = node.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, box.left + box.width / 2 - width / 2),
        innerWidth - width - 8,
      );
      const below = box.bottom + 6 + height <= innerHeight - 8;
      node.style.left = `${left}px`;
      node.style.top = `${below ? box.bottom + 6 : box.top - 6 - height}px`;
    };
    const enter = (event: Event) => {
      const element = (event.target as Element | null)?.closest?.("button, a, [data-tip]");
      if (!element || element === target) return;
      hide();
      const text = tipOf(element);
      if (!text) return;
      if (event.type === "focusin" && !element.matches(":focus-visible")) return;
      target = element;
      timer = setTimeout(() => show(element, text), event.type === "focusin" ? 0 : 500);
    };
    const leave = (event: PointerEvent) => {
      if (target && !target.contains(event.relatedTarget as Node | null)) hide();
    };
    const onEscape = (event: KeyboardEvent) => event.key === "Escape" && hide();
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("keydown", onEscape);
    addEventListener("scroll", hide, true);
    return () => {
      hide();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("keydown", onEscape);
      removeEventListener("scroll", hide, true);
    };
  }, []);
  return <div ref={tip} className="tooltip" role="tooltip" popover="manual" />;
}
