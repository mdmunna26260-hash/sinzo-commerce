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
export default function Carousel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const [idx, setIdx] = useState(0);
  const [pages, setPages] = useState(1);
  const pagesRef = useRef(1);
  pagesRef.current = pages;

  const goTo = (i: number) => {
    const el = rail.node.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const rail = useRailSwipe({ pages: () => pagesRef.current, goTo });

  const measure = () => {
    const el = rail.node.current;
    if (!el) return;
    setPages(Math.max(1, Math.ceil(el.scrollWidth / el.clientWidth)));
    setIdx(Math.round(el.scrollLeft / el.clientWidth));
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  const nudge = (dir: number) => {
    const el = rail.node.current;
    if (!el) return;
    const max = Math.max(0, pages - 1);
    let cur = Math.round(el.scrollLeft / el.clientWidth);
    cur = Math.min(max, Math.max(0, cur + dir));
    goTo(cur);
  };

  return (
    <div className={"crs " + className}>
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
            <button key={i} className={i === idx ? "on" : ""} onClick={() => goTo(i)} aria-label={"Page " + (i + 1)} />
          ))}
        </div>
        <button className="crs-arrow" aria-label="Next" onClick={() => nudge(1)}>›</button>
      </div>
    </div>
  );
}
