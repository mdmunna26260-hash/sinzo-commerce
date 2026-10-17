"use client";

import { useEffect, useRef, useState } from "react";

const SPEED_PX_PER_SECOND = 34;
const INTERACTION_PAUSE_MS = 3_000;
const END_SETTLE_MS = 1_600;

/* Opt-in vertical catalogue browsing, modelled on DECO's Auto Scroll control.
   It deliberately starts OFF, pauses after real user interaction, respects the
   OS reduced-motion preference and waits for an infinite grid to grow before
   deciding that the visitor has reached the end. */
export default function AutoScrollControl({ className = "" }: { className?: string }) {
  const [active, setActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const activeRef = useRef(false);
  const pausedUntil = useRef(0);
  activeRef.current = active;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(media.matches);
      if (media.matches) setActive(false);
    };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const pauseForInteraction = (event: Event) => {
      if (!activeRef.current) return;
      const target = event.target as Element | null;
      if (target?.closest?.(".auto-scroll-btn")) return;
      pausedUntil.current = performance.now() + INTERACTION_PAUSE_MS;
    };
    const keyPause = (event: KeyboardEvent) => {
      if (["Tab", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) pauseForInteraction(event);
    };
    window.addEventListener("wheel", pauseForInteraction, { passive: true });
    window.addEventListener("touchstart", pauseForInteraction, { passive: true });
    document.addEventListener("pointerdown", pauseForInteraction, true);
    document.addEventListener("keydown", keyPause);
    return () => {
      window.removeEventListener("wheel", pauseForInteraction);
      window.removeEventListener("touchstart", pauseForInteraction);
      document.removeEventListener("pointerdown", pauseForInteraction, true);
      document.removeEventListener("keydown", keyPause);
    };
  }, []);

  useEffect(() => {
    if (!active || reducedMotion) return;
    let frame = 0;
    let previous = performance.now();
    let carry = 0;
    let endSeenAt = 0;
    let endHeight = 0;

    const tick = (now: number) => {
      const elapsed = Math.min(100, now - previous);
      previous = now;
      if (document.visibilityState === "visible" && now >= pausedUntil.current) {
        const root = document.documentElement;
        const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
        const atEnd = window.scrollY >= maxScroll - 2;
        if (atEnd) {
          if (!endSeenAt || endHeight !== root.scrollHeight) {
            endSeenAt = now;
            endHeight = root.scrollHeight;
          } else if (now - endSeenAt >= END_SETTLE_MS) {
            setActive(false);
            return;
          }
        } else {
          endSeenAt = 0;
          endHeight = 0;
          carry += SPEED_PX_PER_SECOND * elapsed / 1_000;
          const pixels = Math.floor(carry);
          if (pixels > 0) {
            window.scrollBy(0, pixels);
            carry -= pixels;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, reducedMotion]);

  return (
    <button
      type="button"
      className={`auto-scroll-btn${active ? " is-active" : ""}${className ? ` ${className}` : ""}`}
      aria-pressed={active}
      disabled={reducedMotion}
      title={reducedMotion ? "Auto Scroll is unavailable while reduced motion is enabled" : active ? "Stop automatic scrolling" : "Start automatic scrolling"}
      onClick={() => {
        if (reducedMotion) return;
        pausedUntil.current = 0;
        setActive((value) => !value);
      }}
    >
      <span className="auto-scroll-icon" aria-hidden="true">{active ? "Ⅱ" : "↓"}</span>
      <span className="auto-scroll-wide">{active ? "Stop Auto Scroll" : "Auto Scroll"}</span>
      <span className="auto-scroll-short">{active ? "Stop" : "Auto"}</span>
    </button>
  );
}
