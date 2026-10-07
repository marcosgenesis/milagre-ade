import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PromptSkillPart } from "../lib/prompt-skills";
import { TooltipBubble, TOOLTIP_SHOW_DELAY } from "./primitives/Tooltip";

/** A visual copy under the native textarea, which still owns editing and selection. */
export function PromptHighlights({
  inputRef,
  parts,
  descriptions,
  className,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  parts: PromptSkillPart[];
  descriptions: ReadonlyMap<string, string>;
  className: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ label: string; rect: DOMRect } | null>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!input || !viewport || !text) return;
    let target: HTMLElement | null = null;
    let timer: number | null = null;
    const hide = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      target = null;
      setHovered(null);
    };
    const sync = () => {
      hide();
      // clientWidth excludes the native scrollbar so both copies wrap at the same point.
      viewport.style.width = `${input.clientWidth}px`;
      viewport.style.height = `${input.clientHeight}px`;
      text.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    };
    const move = (event: PointerEvent) => {
      if (event.buttons) {
        hide();
        return;
      }
      const contains = (rect: DOMRect) => event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom;
      // The input remains the pointer target. Hit-test the painted text, including wrapped spans.
      let next: HTMLElement | null = null;
      let bounds: DOMRect | undefined;
      if (contains(viewport.getBoundingClientRect())) {
        for (const span of text.querySelectorAll<HTMLElement>("[data-prompt-skill]")) {
          bounds = Array.from(span.getClientRects()).find(contains);
          if (bounds) {
            next = span;
            break;
          }
        }
      }
      if (next === target) return;
      hide();
      if (!next || !bounds) return;
      target = next;
      const name = next.textContent ?? "";
      const description = descriptions.get(name.toLowerCase());
      if (!description) return;
      const rect = bounds;
      timer = window.setTimeout(() => {
        timer = null;
        setHovered({ label: `${name}: ${description}`, rect });
      }, TOOLTIP_SHOW_DELAY);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(input);
    input.addEventListener("scroll", sync);
    input.addEventListener("pointermove", move);
    input.addEventListener("pointerleave", hide);
    input.addEventListener("pointerdown", hide);
    input.addEventListener("keydown", hide);
    input.addEventListener("blur", hide);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
      input.removeEventListener("scroll", sync);
      input.removeEventListener("pointermove", move);
      input.removeEventListener("pointerleave", hide);
      input.removeEventListener("pointerdown", hide);
      input.removeEventListener("keydown", hide);
      input.removeEventListener("blur", hide);
    };
  }, [inputRef, parts, descriptions, className]);

  return (
    <>
      <div ref={viewportRef} data-prompt-highlights aria-hidden="true" className="pointer-events-none absolute top-0 left-0 overflow-hidden">
        <div ref={textRef} className={`${className} whitespace-pre-wrap text-ink [overflow-wrap:anywhere]`}>
          {parts.map((part, index) =>
            part.skill ? (
              <span key={index} data-prompt-skill className="text-accent-ink">
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )}
          {"\u200b"}
        </div>
      </div>
      {hovered && (
        <TooltipBubble
          label={hovered.label}
          rect={hovered.rect}
          wrap
          align={hovered.rect.left > window.innerWidth - 280 ? "end" : "start"}
          side={hovered.rect.top < 96 ? "bottom" : "top"}
        />
      )}
    </>
  );
}
