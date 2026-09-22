"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { imgSrc, imgSrcSet, CARD_WIDTHS, CARD_SIZES } from "./img-src";

/* Drag-to-swipe image carousel INSIDE a product card.
   Goal: let a customer see every product photo without opening the product page.

   Design decisions (kept deliberately small + library-free, same style as mobile-gallery.tsx):
   - Track follows the finger/mouse 1:1 (translate3d, GPU composited)
   - Release: momentum decides next/previous, a short drag springs back
   - touch-action: pan-y → vertical page scroll stays natural while we own the horizontal axis
   - Click suppression: a drag must NEVER navigate to the product page. We swallow the click
     that follows a drag (capture phase on the wrapper), so tapping still opens the product.
   - Lazy: only the images the customer has actually reached get a src (index ± 1 preloaded).
   - Dots show position; they are decorative (not buttons) because the whole card is a link
     and interactive elements may not be nested inside an <a>.

   IMPORTANT (bug fix 2026-09-20): the track offset is written in PIXELS, never as
   `translate3d(calc(-100% + 0px))`. Percentage + calc() inside a transform function is
   dropped by some WebKit/Safari builds → the state (dots) advanced while the image itself
   never moved. Pixels are width-independent, so every engine renders them identically.
   The step width is re-measured on mount + on resize (ResizeObserver) and immediately
   before every release, so a rotated phone / resized window can never desync. */

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
  const painted = useRef({ i: -1, offset: 0 });   // what the track already shows
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);                // latest slide, readable from callbacks
  idxRef.current = idx;
  const [dragging, setDragging] = useState(false);
  const [seen, setSeen] = useState<number[]>([0]);

  /* one slide === one wrapper width (pixels) */
  const stepPx = useCallback(() => wrapRef.current?.clientWidth || 0, []);

  /* ------------------------------------------------ paint ------------------------------------------------- */
  const paint = useCallback((i: number, offset: number, animate: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    const x = offset - i * stepPx();
    el.style.transition = animate ? "transform 300ms cubic-bezier(.22,.61,.36,1)" : "none";
    el.style.transform = `translate3d(${Math.round(x)}px, 0px, 0px)`;
    painted.current = { i, offset };
  }, [stepPx]);

  /* First paint + realignment (mount, resize, rotation). Skipped when the track already shows the
     requested position — otherwise this would re-paint with transition:none and kill the settle
     animation right after a release or an arrow click. */
  useLayoutEffect(() => {
    const p = painted.current;
    if (p.i === idx && p.offset === 0) return;
    paint(idx, 0, false);
  }, [idx, paint]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    /* One observer for the lifetime of the card. Re-creating it on every slide change made it
       fire its initial callback, which re-painted the track with transition:none and killed the
       settle animation — the photo appeared to teleport. */
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return; }   // that initial call is not a real resize
      paint(idxRef.current, 0, false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [paint]);

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
  const go = (n: number) => {
    const t = Math.max(0, Math.min(N - 1, n));
    if (t === idx) return;
    paint(t, 0, true);            // slide it, don't jump
    setIdx(t);
    remember([t - 1, t, t + 1]);
  };

  const onDown = (e: React.PointerEvent) => {
    if (N < 2) return;
    const d = drag.current;
    d.active = true; d.axis = ""; d.dx = 0; d.x = e.clientX; d.y = e.clientY; d.t = performance.now(); d.id = e.pointerId;
    setDragging(true);
    paint(idx, 0, false);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  /* shared by the pointer path and the touch fallback */
  const move = (clientX: number, clientY: number) => {
    const d = drag.current;
    if (!d.active) return;
    const mx = clientX - d.x;
    const my = clientY - d.y;
    /* axis lock: the first meaningful movement decides who owns this gesture */
    if (!d.axis) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      d.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (d.axis === "y") { d.active = false; setDragging(false); return; }   // let the page scroll
    }
    if (d.axis !== "x") return;
    /* rubber-band at both ends so the card feels physical, not broken */
    let m = mx;
    if ((idx === 0 && m > 0) || (idx === N - 1 && m < 0)) m *= 0.35;
    d.dx = m;
    paint(idx, m, false);
  };

  const onMove = (e: React.PointerEvent) => move(e.clientX, e.clientY);

  const end = () => {
    const d = drag.current;
    if (!d.active) { setDragging(false); return; }
    const w = stepPx() || 300;
    const dt = Math.max(1, performance.now() - d.t);
    const v = d.dx / dt;
    const far = Math.abs(d.dx) > w * THRESHOLD;
    const flick = Math.abs(v) > VELOCITY;
    let next = idx;
    if (far || flick) next = Math.max(0, Math.min(N - 1, idx + (d.dx < 0 ? 1 : -1)));
    /* Only a real horizontal drag may kill the click that follows it. `d.dx` is written by the
       axis-locked move handler, and the 12px floor keeps the small wobble every tap has on a
       phone from swallowing the tap itself (iPhone report: "product e click korle 2 bar lagbe"). */
    if (d.axis === "x" && Math.abs(d.dx) > 12) {
      swallowed.current = true;
      window.setTimeout(() => { swallowed.current = false; }, 350);
    }
    d.active = false; d.dx = 0;
    setDragging(false);
    paint(next, 0, true);
    setIdx(next);
    if (next !== idx) remember([next - 1, next, next + 1]);   // the customer is actively browsing photos
  };

  /* the click that follows a drag must not open the product page */
  const onClickCapture = (e: React.MouseEvent) => {
    if (!swallowed.current) return;
    /* ...but a click on an arrow is a deliberate press on that arrow, never the tail of a drag
       (a gesture starting on an arrow can't become a drag — its pointerdown is stopped) */
    if ((e.target as HTMLElement)?.closest?.(".cg-arrow")) return;
    e.preventDefault();
    e.stopPropagation();
  };

  /* ------------------------------------------------- desktop arrows -------------------------------------
     They sit inside the card's <a>, so a press must not start a drag and the click must not follow
     the link (preventDefault kills the navigation, stopPropagation keeps our own handlers out). */
  const stop = (e: React.SyntheticEvent) => {
    /* a press on an arrow is a fresh, deliberate interaction: a drag that ended a moment
       ago must not swallow this click (a gesture starting here can never be a drag) */
    swallowed.current = false;
    e.stopPropagation();
  };
  const arrowClick = (e: React.MouseEvent, delta: number) => {
    e.preventDefault();
    e.stopPropagation();
    go(idx + delta);
  };
  const prev = (e: React.MouseEvent) => arrowClick(e, -1);
  const next = (e: React.MouseEvent) => arrowClick(e, 1);

  /* ------------------------------------------------ touch fallback ---------------------------------------
     Some in-app webviews (older iOS/Android) ship no PointerEvent. There we drive the exact same state
     machine from touch events instead — never both, otherwise one gesture would be handled twice. */
  const hasPointer = useRef(typeof window !== "undefined" && "PointerEvent" in window);
  const coord = (e: React.TouchEvent) => {
    const t = e.touches[0] || e.changedTouches[0];
    return { clientX: t?.clientX ?? 0, clientY: t?.clientY ?? 0 };
  };
  const touchStart = (e: React.TouchEvent) => {
    warm();
    if (N < 2 || e.touches.length > 1) return;
    const { clientX, clientY } = coord(e);
    const d = drag.current;
    d.active = true; d.axis = ""; d.dx = 0; d.x = clientX; d.y = clientY; d.t = performance.now();
    setDragging(true);
    paint(idx, 0, false);
  };
  const touchMove = (e: React.TouchEvent) => {
    if (!drag.current.active) return;
    const { clientX, clientY } = coord(e);
    move(clientX, clientY);
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
      onTouchStart={hasPointer.current ? warm : touchStart}
      onTouchMove={hasPointer.current ? undefined : touchMove}
      onTouchEnd={hasPointer.current ? undefined : end}
      onTouchCancel={hasPointer.current ? undefined : end}
      onClickCapture={onClickCapture}
      onDragStart={(e) => e.preventDefault()}
      aria-label={N > 1 ? `${alt} — ${N} photos, swipe to see more` : alt}
    >
      {/* no inline transform here on purpose: paint() owns it in pixels */}
      <div className="cg-track" ref={trackRef}>
        {images.map((url, i) => (
          <div className="cg-slide" key={i} aria-hidden={i !== idx}>
            {seen.includes(i) && (
              /* plain <img>, not next/image: these are inside a transformed track
                 and next/image's own wrapper fights the translate math */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={imgSrc(url, 400)}
                srcSet={imgSrcSet(url, CARD_WIDTHS)}
                sizes={CARD_SIZES}
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
        <>
          {/* desktop arrows — appear on hover, like a lightbox. They live inside the card's <a>,
              so the click must be swallowed explicitly (preventDefault stops the navigation). */}
          <span
            className={"cg-arrow left" + (idx === 0 ? " off" : "")}
            role="button"
            aria-label="Previous photo"
            tabIndex={-1}
            onPointerDown={stop}
            onTouchStart={stop}
            onClick={prev}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18 9 12l6-6" />
            </svg>
          </span>
          <span
            className={"cg-arrow right" + (idx === N - 1 ? " off" : "")}
            role="button"
            aria-label="Next photo"
            tabIndex={-1}
            onPointerDown={stop}
            onTouchStart={stop}
            onClick={next}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>

          {/* dots only — no counter chip */}
          <span className="cg-dots" aria-hidden>
            {images.map((_, i) => (
              <i key={i} className={"cg-dot" + (i === idx ? " on" : "")} />
            ))}
          </span>
        </>
      )}
    </div>
  );
}
