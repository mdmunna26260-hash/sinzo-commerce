"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { imgSrc } from "./img-src";

/* Drag-to-swipe image carousel INSIDE a product card.
   Goal: let a customer see every product photo without opening the product page.

   Design decisions (kept deliberately small + library-free, same style as mobile-gallery.tsx):
   - Track follows the finger/mouse 1:1 (translate3d, GPU composited)
   - Release: momentum decides next/previous, a short drag springs back
   - touch-action: pan-y → vertical page scroll stays natural while we own the horizontal axis
   - Click suppression: a drag must NEVER navigate to the product page. We swallow the click
     that follows a drag (capture phase on the wrapper), so tapping still opens the product.
   - Lazy: only the images the customer has actually reached get a src (index ± 1 preloaded).
     A 6-image card therefore downloads 2 images, not 6 — important on mobile data.
   - Dots show position; they are decorative (not buttons) because the whole card is a link
     and interactive elements may not be nested inside an <a>.
   - No autoplay on purpose (autoplay on cards hurts more than it helps). */

type Props = {
  images: string[];
  alt: string;
  /* classes for the outer wrapper (fills .pcard-img) */
  className?: string;
};

const THRESHOLD = 0.18;   // 18% of the card width decides the slide
const VELOCITY = 0.35;    // px/ms — a quick flick counts even if short

export default function CardGallery({ images, alt, className = "" }: Props) {
  const N = images.length;
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ x: 0, y: 0, dx: 0, t: 0, active: false, axis: "" as "" | "x" | "y", id: -1 });
  const swallowed = useRef(false);        // set for a moment after a drag → kill the click
  const [idx, setIdx] = useState(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [seen, setSeen] = useState<number[]>([0]);

  /* ------------------------------------------------ paint ------------------------------------------------- */
  const paint = useCallback((i: number, offset: number, animate: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 300ms cubic-bezier(.22,.61,.36,1)" : "none";
    el.style.transform = `translate3d(calc(${-i * 100}% + ${offset}px),0,0)`;
  }, []);

  useEffect(() => { if (!dragging) paint(idx, 0, true); }, [idx, dragging, paint]);

  /* which slides are allowed to have a src. Grows as the customer gets closer to them. */
  const remember = (idxs: number[]) =>
    setSeen((s) => {
      const want = idxs.filter((i) => i >= 0 && i < N);
      const missing = want.filter((i) => !s.includes(i));
      return missing.length ? [...s, ...missing].sort((a, b) => a - b) : s;
    });

  useEffect(() => { remember([idx]); }, [idx]);  // eslint-disable-line react-hooks/exhaustive-deps

  /* Intent pre-load. A card nobody touches downloads ONE image, exactly like before —
     neighbours are fetched only once the customer hovers (desktop) or touches (mobile),
     which is the moment a swipe becomes likely. Keeps mobile data usage honest. */
  const warm = () => remember([idx - 1, idx, idx + 1]);

  /* ------------------------------------------------ pointer ---------------------------------------------- */
  const go = (n: number) => setIdx(Math.max(0, Math.min(N - 1, n)));

  const onDown = (e: React.PointerEvent) => {
    if (N < 2) return;
    const d = drag.current;
    d.active = true; d.axis = ""; d.dx = 0; d.x = e.clientX; d.y = e.clientY; d.t = performance.now(); d.id = e.pointerId;
    setDragging(true);
    paint(idx, 0, false);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    /* axis lock: the first meaningful movement decides who owns this gesture */
    if (!d.axis) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      d.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (d.axis === "y") { d.active = false; setDragging(false); return; }   // let the page scroll
    }
    if (d.axis !== "x") return;
    /* rubber-band at both ends so the card feels physical, not broken */
    let m = mx;
    const w = wrapRef.current?.clientWidth || 300;
    if ((idx === 0 && m > 0) || (idx === N - 1 && m < 0)) m *= 0.35;
    d.dx = m;
    setDx(m);
    paint(idx, m, false);
    void w;
  };

  const end = () => {
    const d = drag.current;
    if (!d.active) { setDragging(false); return; }
    const w = wrapRef.current?.clientWidth || 300;
    const dt = Math.max(1, performance.now() - d.t);
    const v = d.dx / dt;
    const far = Math.abs(d.dx) > w * THRESHOLD;
    const flick = Math.abs(v) > VELOCITY;
    let next = idx;
    if (far || flick) next = Math.max(0, Math.min(N - 1, idx + (d.dx < 0 ? 1 : -1)));
    if (Math.abs(d.dx) > 8) {                 // it was a drag, not a tap → don't navigate
      swallowed.current = true;
      window.setTimeout(() => { swallowed.current = false; }, 350);
    }
    d.active = false; d.dx = 0;
    setDragging(false); setDx(0);
    paint(next, 0, true);
    setIdx(next);
    if (next !== idx) remember([next - 1, next, next + 1]);   // the customer is actively browsing photos
  };

  /* the click that follows a drag must not open the product page */
  const onClickCapture = (e: React.MouseEvent) => {
    if (swallowed.current) { e.preventDefault(); e.stopPropagation(); }
  };

  if (!N) return null;

  return (
    <div
      ref={wrapRef}
      className={"cg " + className + (N > 1 ? " cg-swipeable" : "")}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={() => { if (drag.current.active) end(); }}
      onMouseEnter={warm}
      onTouchStart={warm}
      onClickCapture={onClickCapture}
      onDragStart={(e) => e.preventDefault()}
    >
      <div
        className="cg-track"
        ref={trackRef}
        style={{ transform: `translate3d(${-idx * 100}%,0,0)` }}
      >
        {images.map((url, i) => (
          <div className="cg-slide" key={i} aria-hidden={i !== idx}>
            {seen.includes(i) && (
              /* plain <img>, not next/image: these are inside an absolutely-positioned transform
                 track, and next/image's own wrapper fights the translate math */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imgSrc(url, 640)}
                alt={i === 0 ? alt : `${alt} — photo ${i + 1}`}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                draggable={false}
                className={"cg-img" + (dragging ? " nodrag" : "")}
              />
            )}
          </div>
        ))}
      </div>

      {N > 1 && (
        <span className="cg-dots" aria-hidden>
          {images.map((_, i) => (
            <i key={i} className={"cg-dot" + (i === idx ? " on" : "")} />
          ))}
        </span>
      )}
    </div>
  );
}
