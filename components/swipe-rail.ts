"use client";
import { useCallback, useRef } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/* ---------------------------------------------------------------------------
   Drag-to-swipe for the PAGED carousels (home rails + the "related products"
   rail on a product page). One implementation, two callers.

   Why this exists (reported from an iPhone): "mobile e product swipe korle
   change hoy na". Both rails used to depend on native horizontal scrolling with
   `scroll-snap-type: x mandatory` and left BOTH axes to the browser
   (`touch-action: pan-x pan-y`). On a phone the first few pixels of a thumb
   swipe decide which axis the browser thinks the gesture is for: a slightly
   diagonal start is read as a page scroll, the page moves, the rail never does.
   When the browser does take the rail it may also land between snap points and
   bounce back to the page it started on — same result, "swipe korle change hoy na".

   So the horizontal axis is taken away from the browser (`touch-action: pan-y`
   in globals.css) and given to this code, while the vertical axis stays native
   (a vertical drag still scrolls the page normally — the common case).

   Shape deliberately mirrors components/card-gallery.tsx, which is the same
   gesture machine that is already proven on the device:
   - axis lock after 6px — the first direction decides who owns the gesture
   - the rail follows the finger 1:1, with resistance past either end
   - release: distance (18% of a page) OR velocity (0.35 px/ms) advances one page,
     otherwise the rail settles back where it was
   - a drag must never navigate: the click that follows a drag is swallowed once

   The rails keep their native scroll container, so the arrows / dots / onScroll
   maths in the callers stay exactly as they were — this only drives scrollLeft.
   `mouse` pointers are ignored: a desktop swipe means "select text", not "page".
   ------------------------------------------------------------------------- */

const LOCK_PX = 6;      // movement before the axis is decided
const DRAG_PX = 8;      // released past this = a drag, so the following click is not a tap
const MOVE_RATIO = 0.18;
const FLICK = 0.35;     // px/ms

/** Where should a released rail settle? Pure so it can be tested without a browser. */
export function railTarget(g: { dx: number; width: number; ms: number; page: number; pages: number }) {
  const far = Math.abs(g.dx) > Math.max(24, g.width * MOVE_RATIO);
  const flick = g.ms > 0 && Math.abs(g.dx / g.ms) > FLICK;
  const next = far || flick ? g.page + (g.dx < 0 ? 1 : -1) : g.page;
  return Math.max(0, Math.min(Math.max(0, g.pages - 1), next));
}

type Gesture = {
  on: boolean; id: number; captured: boolean;
  x: number; y: number; dx: number; axis: "" | "x" | "y";
  base: number; basePage: number; t: number;
};

export function useRailSwipe(opts: {
  pages: () => number;
  goTo: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const swallowed = useRef(false);
  const g = useRef<Gesture>({ on: false, id: -1, captured: false, x: 0, y: 0, dx: 0, axis: "", base: 0, basePage: 0, t: 0 });
  const latest = useRef(opts);
  latest.current = opts;

  const end = useCallback((commit: boolean) => {
    const el = ref.current;
    const d = g.current;
    if (!d.on && !d.captured) return;
    d.on = false;
    if (d.captured && el) {
      try { el.releasePointerCapture(d.id); } catch { /* already gone */ }
      d.captured = false;
    }
    if (!el || d.axis !== "x") { d.axis = ""; return; }
    const width = el.clientWidth || 1;
    const ms = Math.max(1, performance.now() - d.t);
    if (Math.abs(d.dx) > DRAG_PX) {
      /* the click WebKit is about to synthesize belongs to the drag, not to the card */
      swallowed.current = true;
      window.setTimeout(() => { swallowed.current = false; }, 350);
    }
    d.axis = "";
    const target = commit
      ? railTarget({ dx: d.dx, width, ms, page: d.basePage, pages: latest.current.pages() })
      : d.basePage;                       // pointercancel / gesture stolen → put it back
    d.dx = 0;
    latest.current.goTo(target);
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType === "mouse") return;
    if (latest.current.pages() < 2) return;
    /* A photo gallery inside a card owns the gesture it starts (card-gallery.tsx). Without this
       both would move at once: the photo sliding while the whole rail slides under it. */
    if ((e.target as HTMLElement | null)?.closest?.(".cg-swipeable")) return;
    const d = g.current;
    const width = el.clientWidth || 1;
    d.on = true; d.captured = false; d.id = e.pointerId;
    d.x = e.clientX; d.y = e.clientY; d.dx = 0; d.axis = "";
    /* a settle animation still running from the previous drag must not fight this one */
    el.scrollTo({ left: el.scrollLeft, behavior: "auto" });
    d.base = el.scrollLeft;
    d.basePage = Math.round(el.scrollLeft / width);
    d.t = performance.now();
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const el = ref.current;
    const d = g.current;
    if (!el || !d.on || e.pointerId !== d.id) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(mx) < LOCK_PX && Math.abs(my) < LOCK_PX) return;
      d.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (d.axis === "y") {                      // vertical intent → the page owns it
        d.on = false;
        return;
      }
      /* Only claim the pointer once this is definitely a drag. Capturing on
         pointerdown would retarget the synthesized click to the rail and the
         card under the finger would stop opening — the exact bug we are fixing. */
      try { el.setPointerCapture(d.id); d.captured = true; } catch { /* not supported */ }
    }
    if (d.axis !== "x") return;
    const last = Math.max(0, latest.current.pages() - 1);
    let dx = mx;
    if ((d.basePage === 0 && dx > 0) || (d.basePage === last && dx < 0)) dx *= 0.35;   // resistance
    d.dx = dx;
    el.scrollLeft = d.base - dx;
  };

  const onPointerUp = (e: ReactPointerEvent) => { if (e.pointerId === g.current.id) end(true); };
  const onPointerCancel = (e: ReactPointerEvent) => { if (e.pointerId === g.current.id) end(false); };

  /* the click that follows a drag must not open the product page */
  const onClickCapture = (e: ReactMouseEvent) => {
    if (!swallowed.current) return;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    ref,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
      onDragStart: (e: ReactDragEvent) => e.preventDefault(),
    },
  };
}
