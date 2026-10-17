"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SmartImg from "@/components/smart-img";
import { useRailSwipe } from "@/components/swipe-rail";
import { imgSrc } from "@/components/img-src";
import type { HomeHeroSlide } from "@/lib/home-hero";

function mobileSrcSet(src: string): string | undefined {
  if (!src) return undefined;
  const seen = new Set<string>();
  const candidates = [480, 720, 1000]
    .map((width) => ({ width, url: imgSrc(src, width) }))
    .filter(({ url }) => { if (!url || seen.has(url)) return false; seen.add(url); return true; });
  return candidates.length > 1 ? candidates.map(({ width, url }) => `${url} ${width}w`).join(", ") : src;
}

export default function HeroCarousel({ slides, intervalMs = 6_000 }: { slides: HomeHeroSlide[]; intervalMs?: number }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const indexRef = useRef(0);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  indexRef.current = index;

  const goTo = (next: number, behavior: ScrollBehavior = reducedMotion ? "auto" : "smooth") => {
    const railElement = rail.node.current;
    if (!railElement || !slides.length) return;
    const bounded = Math.min(slides.length - 1, Math.max(0, next));
    railElement.scrollTo({ left: bounded * railElement.clientWidth, behavior });
    setIndex(bounded);
  };
  const rail = useRailSwipe({ pages: () => slides.length, goTo });

  const pauseAfterInteraction = () => {
    setManualPause(true);
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => setManualPause(false), 12_000);
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    const updateVisibility = () => setVisible(document.visibilityState === "visible");
    updateMotion();
    updateVisibility();
    media.addEventListener?.("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      media.removeEventListener?.("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
    };
  }, []);

  useEffect(() => {
    if (slides.length < 2 || hovered || focused || manualPause || reducedMotion || !visible) return;
    const timer = window.setTimeout(() => goTo((indexRef.current + 1) % slides.length), intervalMs);
    return () => window.clearTimeout(timer);
    // goTo intentionally reads the current rail and motion preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, slides.length, hovered, focused, manualPause, reducedMotion, visible, intervalMs]);

  if (!slides.length) return null;

  return (
    <section
      className="hero hero-carousel"
      aria-roledescription="carousel"
      aria-label="Featured collections"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
      onTouchStart={pauseAfterInteraction}
    >
      <div
        className="hero-rail"
        ref={rail.ref}
        onClickCapture={rail.capture.onClickCapture}
        onScroll={() => {
          const element = rail.node.current;
          if (!element) return;
          setIndex(Math.min(slides.length - 1, Math.max(0, Math.round(element.scrollLeft / Math.max(1, element.clientWidth)))));
        }}
      >
        {slides.map((slide, slideIndex) => {
          const active = slideIndex === index;
          const mobileSet = mobileSrcSet(slide.mobileImage);
          return (
            <article
              className={`hero-slide${active ? " is-active" : ""}`}
              key={slide.id}
              aria-roledescription="slide"
              aria-label={`${slideIndex + 1} of ${slides.length}`}
              aria-hidden={!active}
            >
              <div className="hero-media">
                <picture>
                  {mobileSet && <source media="(max-width: 700px)" srcSet={mobileSet} sizes="100vw" />}
                  <SmartImg
                    src={slide.image}
                    alt=""
                    className="hero-img"
                    priority={slideIndex === 0}
                    sizes="100vw"
                    widths={[600, 1000, 1600]}
                  />
                </picture>
              </div>
              <div className="hero-overlay">
                <div className="container" style={{ width: "100%" }}>
                  <div className="hero-content">
                    {slide.eyebrow && <div className="eyebrow">{slide.eyebrow}</div>}
                    <h1>{slide.title}</h1>
                    {slide.subtitle && <p>{slide.subtitle}</p>}
                    <div className="hero-actions">
                      <Link className="btn" href={slide.href} prefetch tabIndex={active ? undefined : -1}>{slide.cta}</Link>
                      <Link className="btn btn-ghost" href="/track" prefetch tabIndex={active ? undefined : -1}>Track Order</Link>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {slides.length > 1 && (
        <div className="hero-controls" aria-label="Hero slide controls">
          <button type="button" className="hero-arrow" aria-label="Previous slide" onClick={() => { pauseAfterInteraction(); goTo((index - 1 + slides.length) % slides.length); }}>‹</button>
          <div className="hero-dots" role="tablist" aria-label="Choose hero slide">
            {slides.map((slide, slideIndex) => (
              <button
                type="button"
                role="tab"
                aria-selected={slideIndex === index}
                aria-label={`Show slide ${slideIndex + 1}: ${slide.title}`}
                key={slide.id}
                className={slideIndex === index ? "is-active" : ""}
                onClick={() => { pauseAfterInteraction(); goTo(slideIndex); }}
              />
            ))}
          </div>
          <button type="button" className="hero-arrow" aria-label="Next slide" onClick={() => { pauseAfterInteraction(); goTo((index + 1) % slides.length); }}>›</button>
        </div>
      )}
      {slides.length > 1 && <div className="hero-count" aria-hidden="true"><b>{String(index + 1).padStart(2, "0")}</b><span />{String(slides.length).padStart(2, "0")}</div>}
    </section>
  );
}
