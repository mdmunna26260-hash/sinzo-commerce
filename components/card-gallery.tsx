"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSwipe } from "./use-swipe";
import { resist, slideAfter } from "./gesture-math";
import { warmImage } from "./img-warm";
import { imgSrc, imgSrcSet, CARD_WIDTHS, CARD_SIZES } from "./img-src";

/* Drag-to-swipe image carousel INSIDE a product card.
   Goal: let a customer see every product photo without opening the product page.

   Design decisions (kept deliberately small + library-free; the gesture machine is
   components/use-swipe.ts, the same one the home rails and the "you may also like"
   rail use):
   - Track follows the finger/mouse 1:1 (translate3d, GPU composited)
   - Release: momentum decides next/previous, a short drag springs back
   - `touch-action: pan-y` → vertical page scroll stays natural while the horizontal
     axis is driven here
   - Click suppression: a DRAG must never navigate to the product page, a TAP always
     must. `use-swipe.ts` swallows the click only after a real drag.
   - Lazy: only the images the customer has actually reached get a src (index ± 1).

   Fixed in the 2026-09-22 second pass (owner's iPhone, same two symptoms):

   1. `setPointerCapture()` used to run in `pointerdown`. WebKit retargets the click of
      the tap that follows to the capture element, and iOS 13–15.4 ignored touch capture
      altogether — both are ways to lose a single tap ("2 bar tap korte hoy"). The
      machine now captures nothing at all.
   2. Nothing renders while the finger is on the card. The `dragging` state that used to
      be set in `pointerdown` (it added `pointer-events: none` to the photo under the
      finger) plus the neighbour `<img>` mounting both changed the element under the tap
      mid-gesture, and WebKit drops the click when that happens. No state write on start
      any more, and neighbours are mounted on the next frame once the drag is already
      locked to the horizontal axis (a locked drag swallows its click anyway, so nothing
      can be lost).
   3. A cancelled gesture (`touchcancel`, system gesture) now settles on the photo the
      customer dragged towards instead of snapping back — iOS cancels horizontal drags
      far more eagerly than Chrome does.
   4. The release decision is a pure function (`slideAfter` in components/gesture-math.ts),
      asserted by `npm run test:touch` without a browser.

   IMPORTANT (bug fix 2026-09-20): the track offset is written in PIXELS, never as
   `translate3d(calc(-100% + 0px))`. Percentage + calc() inside a transform function is
   dropped by some WebKit/Safari builds → the gallery state advanced while the image itself
   never moved. Pixels are width-independent, so every engine renders them identically.
   The step width is re-measured on mount + on resize (ResizeObserver) and immediately
   before every release, so a rotated phone / resized window can never desync. */

type Props = {
  images: string[];
  alt: string;
  /* classes for the outer wrapper (fills .pcard-img) */
  className?: string;
  /* Reports the visible photo upwards — the progress bar is drawn by the card (components/card-media.tsx),
     because this component lives inside `.pcard-img`, which clips anything below the image. */
  onIndexChange?: (i: number) => void;
};

/* The thresholds and the release maths live in components/gesture-math.ts (pure, shared with the
   rails, asserted by `npm run test:touch`). */
export { slideAfter as galleryTarget } from "./gesture-math";

export default function CardGallery({ images, alt, className = "", onIndexChange }: Props) {
  const N = images.length;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const painted = useRef({ i: -1, offset: 0 });   // what the track already shows
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);                // latest slide, readable from callbacks
  idxRef.current = idx;
  const onIdx = useRef(onIndexChange);
  onIdx.current = onIndexChange;
  const [seen, setSeen] = useState<number[]>([0]);
  const warmed = useRef(false);            // neighbours already asked for

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

  /* which slides are allowed to have a src. Grows as the customer gets closer to them. */
  const remember = useCallback((idxs: number[]) => {
    setSeen((s) => {
      const want = idxs.filter((i) => i >= 0 && i < N);
      const missing = want.filter((i) => !s.includes(i));
      return missing.length ? [...s, ...missing].sort((a, b) => a - b) : s;
    });
  }, [N]);

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

  useEffect(() => { remember([idx]); }, [idx, remember]);

  /* Intent pre-load. A card nobody touches downloads ONE image, exactly like before —
     neighbours are fetched only once the customer hovers (desktop) or actually starts
     swiping (mobile), which is the moment a swipe becomes a fact. Keeps mobile data honest.

     Two steps on purpose since the touch fix: `warmNet` only creates detached `Image()`
     objects (zero DOM), the `<img>` mounting happens on the next frame and only after the
     drag is locked to the horizontal axis. Mounting synchronously at touchstart moved the
     DOM out from under the finger, and WebKit answered by dropping the tap. */
  const warmNet = useCallback(() => {
    const i = idxRef.current;
    for (const k of [i - 1, i, i + 1]) if (k >= 0 && k < N) warmImage(images[k]);
  }, [N, images]);

  const mountNeighbours = useCallback(() => {
    const i = idxRef.current;
    remember([i - 1, i, i + 1]);
  }, [remember]);

  /* desktop hover: mounting here is safe (no touch cascade to disturb) and keeps the
     old "hover then drag/arrow" feel */
  const warmOnHover = useCallback(() => {
    warmNet();
    mountNeighbours();
  }, [warmNet, mountNeighbours]);

  /* ------------------------------------------------ gesture --------------------------------------------- */
  const go = (n: number) => {
    const t = Math.max(0, Math.min(N - 1, n));
    if (t === idx) return;
    paint(t, 0, true);            // slide it, don't jump
    setIdx(t);
    onIdx.current?.(t);
    remember([t - 1, t, t + 1]);
  };

  const swipe = useSwipe({
    enabled: () => N > 1,
    /* a press on an arrow belongs to that arrow, never to a drag */
    skip: (target) => !!target?.closest?.(".cg-arrow"),
    onDrag: (dx) => {
      const i = idxRef.current;
      if (!warmed.current) {
        warmed.current = true;
        warmNet();                                          // network only — no DOM in the touch task
        requestAnimationFrame(mountNeighbours);             // the incoming photo is there next frame
      }
      /* rubber-band at both ends so the card feels physical, not broken */
      paint(i, resist(dx, i, N), false);
    },
    onEnd: (r) => {
      const i = idxRef.current;
      if (r.axis !== "x") {
        /* a tap, or a vertical drag the page took over: the track must sit still */
        if (r.axis === "y") paint(i, 0, false);
        return;
      }
      const next = slideAfter({ dx: r.dx, ms: r.ms, width: stepPx(), index: i, count: N });
      paint(next, 0, true);
      if (next !== i) {
        setIdx(next);
        onIdx.current?.(next);
        remember([next - 1, next, next + 1]);   // the customer is actively browsing photos
      }
    },
  }, wrapRef);

  /* ------------------------------------------------- desktop arrows -------------------------------------
     They sit inside the card's <a>, so a press must not start a drag (the `skip` above) and
     the click must not follow the link (preventDefault kills the navigation, stopPropagation
     keeps our own handlers out). */
  const arrowClick = (e: React.MouseEvent, delta: number) => {
    e.preventDefault();
    e.stopPropagation();
    go(idx + delta);
  };
  const prev = (e: React.MouseEvent) => arrowClick(e, -1);
  const next = (e: React.MouseEvent) => arrowClick(e, 1);

  if (!N) return null;

  return (
    <div
      ref={swipe.ref}
      className={"cg " + className + (N > 1 ? " cg-swipeable" : "")}
      onMouseEnter={warmOnHover}
      onClickCapture={swipe.capture.onClickCapture}
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
                className="cg-img"
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
            onClick={next}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>
        </>
      )}
    </div>
  );
}
