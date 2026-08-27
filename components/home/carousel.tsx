"use client";
import { useRef, useState, useEffect, Children, cloneElement, isValidElement } from "react";

/* Mobile: swipeable horizontal carousel with snap + arrows + progress dots.
   Desktop (≥900px): renders children in the original grid untouched. */
export default function Carousel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [pages, setPages] = useState(1);

  const measure = () => {
    const el = track.current;
    if (!el) return;
    setPages(Math.max(1, Math.ceil(el.scrollWidth / el.clientWidth)));
    setIdx(Math.round(el.scrollLeft / el.clientWidth));
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [children]);

  const scrollTo = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const nudge = (dir: number) => {
    const el = track.current;
    if (!el) return;
    const max = Math.max(0, pages - 1);
    let cur = Math.round(el.scrollLeft / el.clientWidth);
    cur = Math.min(max, Math.max(0, cur + dir));
    scrollTo(cur);
  };

  return (
    <div className={"crs " + className}>
      <div className="crs-track" ref={track} onScroll={() => {
        const el = track.current; if (!el) return;
        setIdx(Math.round(el.scrollLeft / el.clientWidth));
      }}>
        {Children.map(children, (child) => (
          <div className="crs-page">{isValidElement(child) ? child : child}</div>
        ))}
      </div>
      <div className="crs-ui">
        <button className="crs-arrow" aria-label="Previous" onClick={() => nudge(-1)}>‹</button>
        <div className="crs-dots" role="tablist">
          {Array.from({ length: pages }).map((_, i) => (
            <button key={i} className={i === idx ? "on" : ""} onClick={() => scrollTo(i)} aria-label={"Page " + (i + 1)} />
          ))}
        </div>
        <button className="crs-arrow" aria-label="Next" onClick={() => nudge(1)}>›</button>
      </div>
    </div>
  );
}
