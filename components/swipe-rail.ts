"use client";
import { useRef } from "react";
import { useSwipe } from "./use-swipe";
import { railTarget, resist } from "./gesture-math";

/* ---------------------------------------------------------------------------
   Drag-to-swipe for the PAGED carousels (home rails + the "related products"
   rail on a product page). A thin layer on top of components/use-swipe.ts.

   Why the rails exist (reported from an iPhone): "mobile e product swipe korle
   change hoy na". Both rails used to depend on native horizontal scrolling with
   `scroll-snap-type: x mandatory` and left BOTH axes to the browser
   (`touch-action: pan-x pan-y`). On a phone the first few pixels of a thumb
   swipe decide which axis the browser thinks the gesture is for: a slightly
   diagonal start is read as a page scroll, the page moves, the rail never does.

   So the horizontal axis is ours: `touch-action: pan-y` in globals.css keeps the
   vertical axis native (a vertical drag still scrolls the page normally) and the
   gesture machine in `use-swipe.ts` drives `scrollLeft` 1:1 with the finger.

   What the 2026-09-22 second pass changed (owner's phone, same two symptoms):

   - The machine no longer listens to pointer events (see use-swipe.ts): iOS
     Safari ends a horizontal pointer drag mid-gesture (w3c/pointerevents#303:
     "the interactive area will get a pointercancel event during a horizontal
     panning gesture unless the user is careful not to stray from a very straight
     horizontal panning gesture"), and the old `pointercancel → put the page back`
     answer is exactly the "swipe korle change hoy na" the owner kept seeing.
   - A cancelled gesture now settles on the page the user dragged towards instead
     of rewinding — a stolen swipe is still a swipe.
   - `mouse: false` — a desktop drag on a rail means "select text", not "turn the
     page". Desktop turns pages with the arrows and the dots, exactly as before.
   - The rail keeps its native scroll container, so the arrows / dots / `onScroll`
     maths in the callers stay exactly as they were: this only drives `scrollLeft`.
   --------------------------------------------------------------------------- */

/* The turn maths is pure and shared with the card galleries: components/gesture-math.ts
   (18% of a page or a 0.35 px/ms flick, never a nudge under 24px), asserted by
   `npm run test:touch` without a browser. */
export { railTarget } from "./gesture-math";

export function useRailSwipe(opts: {
  pages: () => number;
  goTo: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);   // the rail element (also handed to useSwipe)
  const latest = useRef(opts);
  latest.current = opts;

  /* Where the gesture started. Refs, never state: nothing may re-render while a
     finger is down (that is what costs the tap on WebKit — see use-swipe.ts). */
  const base = useRef(0);
  const page = useRef(0);

  const swipe = useSwipe({
    mouse: false,
    enabled: () => latest.current.pages() > 1,
    /* A photo gallery inside a card owns the gesture it starts (card-gallery.tsx). Without
       this both would move at once: the photo sliding while the whole rail slides under it. */
    skip: (target) => !!target?.closest?.(".cg-swipeable"),
    onStart: () => {
      const el = ref.current;
      if (!el) return;
      const width = el.clientWidth || 1;
      base.current = el.scrollLeft;
      page.current = Math.round(el.scrollLeft / width);
    },
    onDrag: (dx) => {
      const el = ref.current;
      if (!el) return;
      const last = Math.max(0, latest.current.pages() - 1);
      /* resistance past either end so the rail feels physical, not broken */
      const pull = resist(dx, page.current, last + 1);
      el.scrollLeft = base.current - pull;
    },
    onEnd: (r) => {
      const el = ref.current;
      if (!el) return;
      const width = el.clientWidth || 1;
      if (r.axis !== "x") {
        /* a tap or a vertical drag: the rail never moved */
        base.current = el.scrollLeft;
        page.current = Math.round(el.scrollLeft / width);
        return;
      }
      const target = railTarget({ dx: r.dx, width, ms: r.ms, page: page.current, pages: latest.current.pages() });
      base.current = target * width;
      page.current = target;
      latest.current.goTo(target);
    },
  }, ref);

  return { ref: swipe.ref, node: ref, capture: swipe.capture };
}
