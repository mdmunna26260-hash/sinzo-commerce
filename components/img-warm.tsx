"use client";
import { imgSrc } from "./img-src";

/* Background image warmer: quietly downloads the PDP-size image into the
   browser cache so clicking a product feels instant.

   Strategy (mobile-data safe):
   - Card visible in viewport  → warm once, in idle time, staggered
   - Hover / finger-down intent → warm immediately (user is heading to the PDP)
   - Respects Save-Data; skips idle warming on 2G; each image warms at most once */
const warmed = new Set<string>();

/* Mirror the browser's srcset pick so we warm exactly the file the PDP will request */
function pickWarmWidth(): number {
  try {
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth <= 900 ? window.innerWidth : Math.min(window.innerWidth * 0.45, 360);
    const need = vw * dpr;
    for (const w of [600, 1000, 1200]) if (w >= need) return w;
    return 1200;
  } catch { return 1000; }
}

function connOK(idle: boolean): boolean {
  try {
    const c = (navigator as any).connection;
    if (c?.saveData) return false; // user asked to save data — never pre-warm
    const t = String(c?.effectiveType || "").toLowerCase();
    if (idle && t.includes("2g")) return false; // idle warming off on slow networks
    return true;
  } catch { return true; }
}

export function warmImage(url?: string | null, opts?: { idle?: boolean }) {
  try {
    if (!url) return;
    if (!connOK(!!opts?.idle)) return;
    const src = imgSrc(url, pickWarmWidth());
    if (!src || warmed.has(src)) return;
    warmed.add(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  } catch {}
}

/* Warm when the browser is idle (after the visible stuff has loaded) */
export function warmWhenIdle(url?: string | null, delay = 0) {
  if (!url) return;
  const go = () => warmImage(url, { idle: true });
  setTimeout(() => {
    try {
      if ("requestIdleCallback" in window) (window as any).requestIdleCallback(go, { timeout: 3000 });
      else setTimeout(go, 200);
    } catch { go(); }
  }, delay);
}
