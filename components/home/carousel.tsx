"use client";
import { useRef, useState, useEffect, Children, isValidElement } from "react";
import { useRailSwipe } from "@/components/swipe-rail";

/* Mobile: swipeable horizontal carousel with snap + arrows + progress dots.
   Desktop (≥900px): renders children in the original grid untouched.

   The swipe itself lives in components/swipe-rail.ts: the browser is not allowed to pan
   this track horizontally (`touch-action: pan-y`), so the rail moves exactly as far as the
   finger moves and always settles on a page. Native scroll-snap was a coin flip on iOS —
   a diagonal thumb swipe scrolled the page and left the rail ("swipe korle change hoy na").
   Arrows and dots keep using scrollTo, so nothing else had to change. */
export default function Carousel({ children, className = "", autoMs = 0, desktopGrid = false }: { children: React.ReactNode; className?: string; autoMs?: number; desktopGrid?: boolean }) {
  const [idx, setIdx] = useState(0);
  const [pages, setPages] = useState(1);
  const [manualPause, setManualPause] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const pagesRef = useRef(1);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  pagesRef.current = pages;

  const pauseAfterInteraction = () => {
    setManualPause(true);
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => setManualPause(false), 12_000);
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    const updateVisibility = () => setVisible(document.visibilityState === "visible");
    updateMotion(); updateVisibility();
    media.addEventListener?.("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      media.removeEventListener?.("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
    };
  }, []);

  /* Auto-slide (opt-in via autoMs): advance one page every autoMs, looping. Pauses on
     manual interaction for 12s, on hidden tab, and for reduced-motion users. */
  useEffect(() => {
    if (!autoMs || pages < 2 || manualPause || reducedMotion || !visible) return;
    const timer = window.setTimeout(() => {
      const el = rail.node.current;
      if (el) el.scrollTo({ left: ((idx + 1) % pages) * el.clientWidth, behavior: reducedMotion ? "auto" : "smooth" });
    }, autoMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, pages, autoMs, manualPause, reducedMotion, visible]);

  const goTo = (i: number) => {
    const el = rail.node.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const rail = useRailSwipe({ pages: () => pagesRef.current, goTo });

  const measure = () => {
    const el = rail.node.current;
    if (!el) return;
    // The same product cards form the desktop grid; its display:contents rail
    // has no box to measure and must not own horizontal touch gestures.
    if (desktopGrid && window.matchMedia("(min-width: 900px)").matches) {
      el.scrollLeft = 0;
      setPages(1);
      setIdx(0);
      return;
    }
    const width = Math.max(1, el.clientWidth);
    setPages(Math.max(1, Math.ceil(el.scrollWidth / width)));
    setIdx(Math.round(el.scrollLeft / width));
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, desktopGrid]);

  const nudge = (dir: number) => {
    if (autoMs) pauseAfterInteraction();
    const el = rail.node.current;
    if (!el) return;
    const max = Math.max(0, pages - 1);
    let cur = Math.round(el.scrollLeft / el.clientWidth);
    cur = Math.min(max, Math.max(0, cur + dir));
    goTo(cur);
  };

  return (
    <div className={"crs " + className} onTouchStart={autoMs ? pauseAfterInteraction : undefined} onPointerDown={autoMs ? pauseAfterInteraction : undefined}>
      <div
        className="crs-track"
        ref={rail.ref}
        onClickCapture={rail.capture.onClickCapture}
        onScroll={() => {
          const el = rail.node.current; if (!el) return;
          setIdx(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {Children.map(children, (child) => (
          <div className="crs-page">{isValidElement(child) ? child : child}</div>
        ))}
      </div>
      <div className="crs-ui">
        <button className="crs-arrow" aria-label="Previous" onClick={() => nudge(-1)}>‹</button>
        <div className="crs-dots" role="tablist">
          {Array.from({ length: pages }).map((_, i) => (
            <button key={i} className={i === idx ? "on" : ""} onClick={() => { if (autoMs) pauseAfterInteraction(); goTo(i); }} aria-label={"Page " + (i + 1)} />
          ))}
        </div>
        <button className="crs-arrow" aria-label="Next" onClick={() => nudge(1)}>›</button>
      </div>
    </div>
  );
}
