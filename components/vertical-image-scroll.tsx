"use client";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { imgSrc, imgSrcSet } from "@/components/parts";

/**
 * Vertical Image Scroll — pinned 3D card-stack gallery (PDP, all devices).
 *
 * Adapted from the Kexsio "Vertical Image Scroll" reference (3D card deck:
 * center card + dimmed/scaled/rotated peek cards, 1200px perspective,
 * wheel/drag navigation) for use inside a product page:
 *
 *  - The reference hijacks the wheel on a standalone full-screen gallery. On a
 *    PDP that would trap the user (description/details/CTA live below), so the
 *    deck is driven by PAGE SCROLL: a tall section (N × viewport) with a sticky
 *    window. Scroll progress is SNAPPED to whole cards — one wheel/finger
 *    scroll advances the deck one card, and the deck eases to that card (the
 *    reference's discrete "single card at a time" feel) instead of following
 *    the scroll continuously.
 *  - Cards never overlap: the peek offset is derived from the live card height
 *    (half card + gap), so no matter the viewport the next/prev photo sits
 *    beside the center card, not on top of it. Peek cards carry a light blur.
 *  - Drag on the center card (mouse/pen) works like the reference: 50px
 *    threshold → smooth-scrolls to the next/previous image.
 *  - No framer-motion: per-frame rAF interpolation keeps it dependency-free.
 *
 * Rendered by the PDP only when not prefers-reduced-motion and the product has
 * more than one image — otherwise the classic gallery shows.
 */

export default function VerticalImageScroll({
  images,
  title,
  initialIndex,
  onIndexChange,
  soldOut,
  onZoom,
}: {
  images: { url: string; alt: string }[];
  title: string;
  initialIndex: number;
  onIndexChange: (i: number) => void;
  soldOut: boolean;
  onZoom?: () => void;
}) {
  const N = images.length;
  const [active, setActive] = useState(Math.min(initialIndex, N - 1));
  const secRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const cbRef = useRef(onIndexChange);
  cbRef.current = onIndexChange;
  const dragRef = useRef<{ id: number; startY: number; offset: number } | null>(null);
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    // displayed progress eases toward the snapped target (whole card index)
    const disp = { p: -1, target: 0 };
    let raf = 0;
    let last = 0;

    const tick = (now: number) => {
      const sec = secRef.current, pin = pinRef.current;
      if (!sec || !pin) { raf = 0; return; }
      const r = sec.getBoundingClientRect();
      const travel = r.height - pin.offsetHeight;
      const t = travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 0;
      const target = Math.round(t * (N - 1));
      disp.target = target;
      if (disp.p < 0) disp.p = t * (N - 1);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      disp.p += (target - disp.p) * Math.min(1, dt * 9);
      if (Math.abs(target - disp.p) < 0.001) disp.p = target;
      const p = disp.p;

      // No-overlap full-screen pager: the card is 88% of the pin (width-
      // limited on narrow screens, published as --cardh) and each step is
      // 90% of the pin — bigger than the card — so a card fully clears the
      // stage before the next one enters: zero overlap at rest AND mid-
      // scroll. A ~4% sliver of the next/prev photo stays visible at the
      // stage edges as the "more photos" indicator.
      const pinH = pin.offsetHeight;
      const cardH = Math.min(pinH * 0.88, pin.clientWidth / 0.75);
      pin.style.setProperty("--cardh", cardH.toFixed(1) + "px");
      const step1 = pinH * 0.9;
      const step2 = step1 + cardH;
      const drag = dragRef.current;
      for (let i = 0; i < N; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const d = i - p;
        const ad = Math.abs(d);
        const s = d >= 0 ? 1 : -1;
        const y = ad <= 1 ? d * step1 : s * (step1 + (step2 - step1) * Math.min(ad - 1, 1.667));
        const scale = ad <= 1 ? 1 - 0.18 * ad : 0.82 - 0.12 * Math.min(ad - 1, 1);
        const opacity = Math.max(0, Math.min(1, ad <= 1 ? 1 - 0.4 * ad : ad <= 2 ? 0.6 - 0.3 * (ad - 1) : 0));
        const rotateX = -d * 8;
        const dy = drag && target === i ? drag.offset : 0;
        el.style.transform = `translate(-50%, -50%) translate3d(0, ${(y + dy).toFixed(2)}px, 0) scale(${scale.toFixed(4)}) rotateX(${rotateX.toFixed(2)}deg)`;
        el.style.opacity = opacity.toFixed(3);
        el.style.zIndex = String(10 - Math.min(8, Math.round(ad * 2)) - (d > 0 ? 0.5 : 0));
      }
      if (target !== activeRef.current) {
        activeRef.current = target;
        setActive(target);
        cbRef.current(target);
      }
      raf = disp.p !== target ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } };
    kickRef.current = kick;
    kick();
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick, { passive: true });
    return () => {
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", kick);
      if (raf) cancelAnimationFrame(raf);
      kickRef.current = () => {};
    };
  }, [N]);

  const jumpTo = (i: number) => {
    const sec = secRef.current, pin = pinRef.current;
    if (!sec || !pin || N < 2) return;
    const clamped = Math.min(N - 1, Math.max(0, i));
    const r = sec.getBoundingClientRect();
    const travel = r.height - pin.offsetHeight;
    window.scrollTo({ top: window.scrollY + r.top - (clamped / (N - 1)) * travel, behavior: "smooth" });
  };

  /* drag on the center card (reference behavior) — mouse/pen only; touch
     drives the native page scroll which already snaps the deck */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    if (!e.currentTarget.classList.contains("on")) return;
    const el = e.currentTarget as HTMLDivElement;
    el.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, startY: e.clientY, offset: 0 };
    el.classList.add("dragging");
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    d.offset = Math.max(-140, Math.min(140, d.startY - e.clientY));
    kickRef.current();
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    (e.currentTarget as HTMLDivElement).classList.remove("dragging");
    if (!cancelled && Math.abs(d.offset) > 50) jumpTo(activeRef.current + (d.offset > 0 ? 1 : -1));
    kickRef.current();
  };

  return (
    <section
      className="viscroll"
      ref={secRef}
      style={{ "--n": N } as CSSProperties}
      aria-label={title + " — image gallery"}
    >
      <div className="viscroll-pin" ref={pinRef}>
        <div className="viscroll-stage">
          <div className="viscroll-deck">
            {images.map((im, i) => (
              <div
                key={i}
                ref={(el) => { cardRefs.current[i] = el; }}
                className={"viscroll-card" + (i === active ? " on" : "")}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => endDrag(e, false)}
                onPointerCancel={(e) => endDrag(e, true)}
              >
                <img
                  src={imgSrc(im.url, 1200) || im.url}
                  srcSet={imgSrcSet(im.url, [800, 1200, 1600])}
                  sizes="(min-width: 901px) 50vw, 92vw"
                  alt={im.alt}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  fetchPriority={i === 0 ? "high" : undefined}
                  draggable={false}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }}
                />
              </div>
            ))}
          </div>
          {onZoom && (
            <button className="viscroll-zoom" title="Zoom" aria-label="Zoom image" onClick={onZoom}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
            </button>
          )}
          {N > 1 && (
            <div className="viscroll-counter" aria-hidden="true">
              <span className="cur">{String(active + 1).padStart(2, "0")}</span>
              <span className="line" />
              <span className="tot">{String(N).padStart(2, "0")}</span>
            </div>
          )}
          {N > 1 && (
            <div className="viscroll-dots">
              {images.map((_, i) => (
                <button key={i} className={i === active ? "on" : ""} onClick={() => jumpTo(i)} aria-label={"Go to image " + (i + 1)} />
              ))}
            </div>
          )}
          {N > 1 && (
            <div className="viscroll-hint">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              <span>Scroll or drag</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
            </div>
          )}
          {soldOut && <div className="soldout-overlay viscroll-soldout"><span>Sold Out</span></div>}
        </div>
      </div>
    </section>
  );
}
