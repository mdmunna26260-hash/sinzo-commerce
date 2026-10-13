"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRailSwipe } from "@/components/swipe-rail";
import SmartImg from "@/components/smart-img";

export type HeroSlide = { image: string; href?: string; alt?: string };

/* Image-only hero slideshow.

   The swipe is the SAME rail machine the product carousels use
   (components/swipe-rail.ts): the browser is not allowed to pan the track
   horizontally, so a thumb drag always settles on a slide instead of
   sometimes scrolling the page. Reusing it keeps one gesture contract on the
   site and keeps the touch audit meaningful.

   Autoplay is deliberately conservative: it stops while a pointer is over the
   hero, while anything inside has keyboard focus, when the tab is hidden, and
   entirely when the visitor asked for reduced motion. A single slide renders
   as a plain banner — no timer, no dots, no arrows. */
export default function HeroSlider({
  slides,
  intervalMs = 5500,
  label = "Promotions",
}: {
  slides: HeroSlide[];
  intervalMs?: number;
  label?: string;
}) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  const countRef = useRef(count);
  countRef.current = count;

  const goTo = (i: number) => {
    const el = rail.node.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const rail = useRailSwipe({ pages: () => countRef.current, goTo });

  const nudge = (dir: number) => {
    const el = rail.node.current;
    if (!el) return;
    const max = Math.max(0, countRef.current - 1);
    const cur = Math.round(el.scrollLeft / el.clientWidth);
    goTo(Math.min(max, Math.max(0, cur + dir)));
  };

  /* autoplay */
  useEffect(() => {
    if (count < 2 || paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const tick = () => {
      const el = rail.node.current;
      if (!el || document.hidden) return;
      const cur = Math.round(el.scrollLeft / el.clientWidth);
      const next = (cur + 1) % countRef.current;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    };
    const t = setInterval(tick, Math.max(2000, intervalMs));
    return () => clearInterval(t);
  }, [count, paused, intervalMs, rail.node]);

  /* a resize changes page width — keep the active dot honest */
  useEffect(() => {
    const onResize = () => {
      const el = rail.node.current;
      if (el) setIdx(Math.round(el.scrollLeft / el.clientWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [rail.node]);

  if (count === 0) return null;

  const Slide = ({ s, i }: { s: HeroSlide; i: number }) => {
    const img = (
      <SmartImg
        className="hero-img"
        priority={i === 0}
        src={s.image}
        alt={s.alt || ""}
        sizes="100vw"
        widths={[600, 1000]}
      />
    );
    return (
      <div className="hero-slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`}>
        {s.href ? (
          <Link href={s.href} className="hero-slide-link" aria-label={s.alt || `Banner ${i + 1}`} prefetch={false}>
            {img}
          </Link>
        ) : (
          img
        )}
      </div>
    );
  };

  return (
    <div
      className={"hero-slider" + (count < 2 ? " single" : "")}
      aria-roledescription="carousel"
      aria-label={label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        className="hero-track"
        ref={rail.ref}
        onClickCapture={rail.capture.onClickCapture}
        onScroll={() => {
          const el = rail.node.current;
          if (!el) return;
          setIdx(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {slides.map((s, i) => (
          <Slide key={(s.image || "") + i} s={s} i={i} />
        ))}
      </div>

      {count > 1 && (
        <>
          <button type="button" className="hero-arrow prev" aria-label="Previous slide" onClick={() => nudge(-1)}>
            ‹
          </button>
          <button type="button" className="hero-arrow next" aria-label="Next slide" onClick={() => nudge(1)}>
            ›
          </button>
          <div className="hero-dots" role="tablist" aria-label="Choose slide">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`Slide ${i + 1}`}
                className={i === idx ? "on" : ""}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
