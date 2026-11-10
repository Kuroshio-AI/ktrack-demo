"use client";

import { useLayoutEffect, useRef } from "react";

// Two columns side by side, each scrolling inside the screen, so the page itself never moves: reading down the right one
// keeps the list, header and sidebar where they are. --pane-top is where the columns start, measured because the intro line
// above wraps at some widths; 2.25rem is the page's bottom padding. relative keeps sr-only labels inside the pane; outside
// it they would stretch the page and scroll it again.
export const PANE = "xl:relative xl:max-h-[calc(100dvh-var(--pane-top,13rem)-2.25rem)] xl:overflow-y-auto";

export function usePanes() {
  const panes = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = () => panes.current?.style.setProperty("--pane-top", `${panes.current.getBoundingClientRect().top + window.scrollY}px`);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return panes;
}
