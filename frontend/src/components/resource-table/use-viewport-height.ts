"use client";

import { useEffect, useRef } from "react";

// Derive available space from the actual page, not an assumed header height.
export function useResourceTableViewportHeight(enabled?: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    const main = root?.closest<HTMLElement>(".app-content");
    const surface = root?.closest<HTMLElement>(".ops-surface--panel");
    if (!enabled || !root || !main || !surface) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const body = root.querySelector<HTMLElement>(".ant-table-body");
      if (!body || !body.getClientRects().length) {
        root.style.removeProperty("--resource-table-body-height");
        return;
      }
      const bodyRect = body.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const mainPadding = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      const footer = rootRect.bottom - bodyRect.bottom;
      const surfacePadding = Math.max(0, surfaceRect.bottom - rootRect.bottom);
      const height = Math.floor(Math.max(240,
        Math.min(window.innerHeight, mainRect.bottom) - mainPadding - bodyRect.top - footer - surfacePadding,
      ));
      const value = `${height}px`;
      if (root.style.getPropertyValue("--resource-table-body-height") !== value) {
        root.style.setProperty("--resource-table-body-height", value);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(main);
    observer.observe(surface);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      root.style.removeProperty("--resource-table-body-height");
    };
  }, [enabled]);
  return ref;
}
