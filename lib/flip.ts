/* Shared element transition — product card image → PDP hero image (FLIP).
   Pure DOM, zero dependencies, transform-only (compositor friendly, no layout
   thrash). Designed for low-end Android + 3G: one fixed overlay element,
   300ms, no libraries, reduced-motion aware.

   Flow:
     1. beginFlip(id, img)   — on card click, BEFORE navigation.
        Measures the card image rect, spawns a fixed overlay that exactly
        covers it (seamless handoff), locks page scroll.
     2. hasPendingFlip(id)   — PDP first render checks this synchronously so
        the page shell can start hidden (no content flash under the overlay).
     3. finishFlip(id, target) — PDP mount, with the visible gallery box.
        FLIP: overlay is re-placed at the target geometry, inverted with a
        transform back to the source rect, then animated to identity.
        300ms cubic-bezier(.22,.61,.36,1) — same easing as the swipe gallery.

   Safety / fallbacks (any failure = plain page navigation):
     - prefers-reduced-motion → no overlay at all
     - image not loaded (skeleton) → skip
     - hidden/offscreen source (< 60px) → skip
     - wrong product / stale state (> 1.5s) → skip
     - hard 1.5s self-cleanup even if PDP never mounts
     - scroll lock always released in cleanup()

   The overlay is attached to document.body (not the RSC tree) so it survives
   the App Router route swap. Client-side navigation keeps the JS heap, so
   the module-level state survives the route change. */

type Rect = { x: number; y: number; w: number; h: number };

type FlipState = {
  id: number;
  rect: Rect;
  radius: number;
  src: string;
  srcSet?: string;
  t: number;
};

const ANIM_MS = 300;
const STALE_MS = 1500;

let state: FlipState | null = null;
let overlay: HTMLDivElement | null = null;
let safeTimer: ReturnType<typeof setTimeout> | null = null;

function cleanup() {
  if (safeTimer) {
    clearTimeout(safeTimer);
    safeTimer = null;
  }
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  if (typeof document !== "undefined") document.body.style.overflow = "";
  state = null;
}

export function beginFlip(id: number, img: HTMLImageElement): boolean {
  if (typeof window === "undefined" || !img) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (!img.complete || !img.naturalWidth) return false; // skeleton → plain nav
  const r = img.getBoundingClientRect();
  if (r.width < 60 || r.height < 60) return false; // hidden / offscreen

  cleanup(); // kill any previous in-flight flip first
  const parent = img.parentElement;
  const radius = parent ? parseFloat(getComputedStyle(parent).borderTopLeftRadius) || 0 : 0;

  state = {
    id,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    radius,
    src: img.currentSrc || img.src,
    srcSet: img.getAttribute("srcset") || undefined,
    t: Date.now(),
  };

  const el = document.createElement("div");
  el.className = "flip-overlay";
  el.style.left = r.x + "px";
  el.style.top = r.y + "px";
  el.style.width = r.width + "px";
  el.style.height = r.height + "px";
  el.style.borderRadius = radius + "px";
  const im = document.createElement("img");
  im.src = state.src;
  if (state.srcSet) im.setAttribute("srcset", state.srcSet);
  im.alt = "";
  im.draggable = false;
  el.appendChild(im);
  document.body.appendChild(el);
  overlay = el;

  document.body.style.overflow = "hidden";
  safeTimer = setTimeout(cleanup, STALE_MS); // hard safety: never leak
  return true;
}

export function hasPendingFlip(id: number): boolean {
  return !!(state && state.id === id && Date.now() - state.t < STALE_MS);
}

export function finishFlip(id: number, target: HTMLElement | null): boolean {
  const ok =
    !!(state && state.id === id && Date.now() - state.t < STALE_MS) &&
    !!target &&
    (() => {
      const w = target!.getBoundingClientRect().width;
      return w >= 60;
    })();
  if (!ok) {
    cleanup();
    return false;
  }

  const o = overlay!;
  const s = state!.rect;
  const tr = target!.getBoundingClientRect();

  // 1) place overlay at FINAL geometry
  o.style.left = tr.x + "px";
  o.style.top = tr.y + "px";
  o.style.width = tr.width + "px";
  o.style.height = tr.height + "px";
  o.style.borderRadius = "2px"; // PDP --radius
  // 2) invert: transform back to the source rect (no transition yet)
  o.style.transformOrigin = "0 0";
  o.style.transform = `translate(${s.x - tr.x}px, ${s.y - tr.y}px) scale(${s.w / tr.width}, ${s.h / tr.height})`;

  // 3) play to identity (double rAF = style commit, then animate)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (overlay !== o) return; // cancelled in the meantime
      o.style.transition = `transform ${ANIM_MS}ms cubic-bezier(.22,.61,.36,1), border-radius ${ANIM_MS}ms cubic-bezier(.22,.61,.36,1)`;
      o.style.transform = "none";
    });
  });
  setTimeout(cleanup, ANIM_MS + 120); // transitionend can be missed; timer is the source of truth
  return true;
}
