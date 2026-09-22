"use client";
import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react";

/* ---------------------------------------------------------------------------
   ONE drag machine for every "swipe the photo / swipe the rail" surface
   (product card galleries + the home rails + the "you may also like" rail).

   Owner's report on a real iPhone (2026-09-22, second pass):

     "product image/item swipe korle change hoy na"
     "product page open korte single tap er bodole 2 bar tap korte hoy"

   Both are the SAME bug seen from two sides: the gesture under the finger was
   being arbitrated by the browser instead of by us. Three separate mechanisms:

   1. `pointermove` is not a promise on WebKit. iOS Safari ends the pointer
      stream of a horizontal drag as soon as the thumb wanders a few degrees off
      horizontal — described by a WebKit engineer in w3c/pointerevents#303
      ("the interactive area will get a pointercancel event during a horizontal
      panning gesture unless the user is careful not to stray from a very straight
      horizontal panning gesture"). Chrome locks the axis, WebKit cancels it, and
      the previous code answered that cancel with "put it back where it started",
      which is exactly the reported "swipe korle change hoy na".
      → The gesture is driven by TOUCH EVENTS with a non-passive `touchmove`
        listener. The moment a drag is known to be horizontal we take it away from
        the browser (`preventDefault`), so there is nothing left to cancel; and a
        cancel that still happens (call, notification, pinch, system gesture)
        releases the gesture with the distance already travelled instead of
        rewinding it. (React attaches `touchmove` passively at the root, so this
        has to be a real listener on the element — a React `onTouchMove` cannot
        cancel a scroll.)

   2. `setPointerCapture()` during `pointerdown` retargets the click that follows
      a tap to the capture element (WebKit is the touchy engine here, and iOS
      13–15.4 ignored touch capture entirely). `swipe-rail.ts` already carried a
      warning about it while `card-gallery.tsx` still did it.
      → No pointer capture anywhere. Touch events are implicitly targeted at the
        element the finger landed on for the whole gesture, and the mouse drag
        listens on `window` instead of capturing.

   3. Anything that moves the DOM out from under the finger between `touchstart`
      and `touchend` can cost the tap (WebKit only delivers the click when the tap
      target is still what it was when the finger landed — the same rule the
      `.reveal` entrance-animation fix in globals.css §J2 is about).
      → Nothing here re-renders while a finger is down, and the callers were
        changed the same way: no `setState`, no `<img>` mounting, no class swaps
        before the axis has been decided.

   Desktop is deliberately unchanged: hover affordances live in CSS, the mouse
   keeps the same drag-to-see-the-next-photo behaviour (window `pointermove`, so
   leaving the element mid-drag still works), and a click without movement always
   navigates.

   The contract every caller relies on:

   - a gesture that never leaves the LOCK_PX box is a TAP → `axis: ""`, the click
     goes through untouched (single tap opens the product page);
   - a horizontal drag past DRAG_PX is a DRAG → `drag: true` and the click the
     browser fires afterwards is swallowed, so a swipe can never navigate;
   - vertical intent hands the gesture straight back to the browser at once
     (`axis: "y"`), we never `preventDefault` that axis, so normal page scrolling
     over a product photo keeps working;
   - `cancelled` releases still report `dx`, so the callers can settle on the
     page/slide the customer actually dragged towards.
   --------------------------------------------------------------------------- */

const LOCK_PX = 6;      // movement before the axis is decided
const DRAG_PX = 8;      // a horizontal drag past this is a drag, not a tap
const SWALLOW_MS = 350; // how long after a drag a stray click is still ignored

export type SwipeRelease = {
  dx: number; dy: number; ms: number;
  axis: "" | "x" | "y";
  cancelled: boolean;
  drag: boolean;
};

export type SwipeOpts = {
  /** Can this surface take a gesture right now? (rail: at least two pages) */
  enabled?: () => boolean;
  /** A nested surface owns the gesture it starts in (arrow buttons, inner gallery). */
  skip?: (target: Element | null) => boolean;
  /** Track mouse drags too. Rails keep `false`: a desktop drag on a rail means "select text". */
  mouse?: boolean;
  /**
   * A finger/mouse just went down on the surface. FOR REFS ONLY — no `setState`, no DOM
   * writes: on WebKit a tap is lost when the element under the finger changes before
   * `touchend` (that is the whole "2 bar tap korte hoy" report).
   */
  onStart?: () => void;
  /** Live horizontal movement, in pixels (positive = finger moved right). */
  onDrag?: (dx: number, dy: number) => void;
  /** Gesture finished: finger up, mouse up, or the browser stole it. */
  onEnd?: (r: SwipeRelease) => void;
};

type Gesture = {
  active: boolean;
  kind: "" | "touch" | "mouse";
  x0: number; y0: number;
  dx: number; dy: number;
  axis: "" | "x" | "y";
  t0: number;
};

export function useSwipe(opts: SwipeOpts, external?: MutableRefObject<HTMLDivElement | null>) {
  /* The node the listeners live on. A callback ref (not an effect) so a surface that
     mounts later — a rail that only appears once it has items — is still wired up.
     `external` lets a caller keep its own handle on the same element (the card gallery
     measures it), so there is never a second, competing ref. */
  const own = useRef<HTMLDivElement | null>(null);
  const node = external || own;
  const detach = useRef<(() => void) | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const swallowed = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const g = useRef<Gesture>({ active: false, kind: "", x0: 0, y0: 0, dx: 0, dy: 0, axis: "", t0: 0 });

  /* The click that follows a drag belongs to the drag. Capture phase, so neither the
     card's <Link> nor the shop grid's "updating" listener ever sees it. */
  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!swallowed.current) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const ref = useCallback((el: HTMLDivElement | null) => {
    node.current = el;
    detach.current?.();
    detach.current = null;
    if (!el) return;

    const d = g.current;
    const cfg = () => latest.current;

    const clearSwallow = () => { swallowed.current = false; };
    const restoreSelect = () => {
      document.body.style.userSelect = "";
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "";
    };

    const begin = (x: number, y: number, kind: "touch" | "mouse", target: EventTarget | null) => {
      const c = cfg();
      if (c.enabled && !c.enabled()) return;
      if (c.skip && c.skip(target instanceof Element ? target : null)) return;
      d.active = true; d.kind = kind; d.axis = ""; d.dx = 0; d.dy = 0;
      d.x0 = x; d.y0 = y; d.t0 = performance.now();
      /* A fresh gesture is never the tail of the previous drag: the click the browser
         synthesizes after a drag is dispatched before this touchstart, so clearing here
         means "swipe the rail, then tap a product" still opens it on the FIRST tap. */
      swallowed.current = false;
      c.onStart?.();
    };

    /** Decide the axis. Returns "x" while the horizontal axis is ours. */
    const move = (x: number, y: number): "" | "x" | "y" => {
      if (!d.active) return "";
      const dx = x - d.x0;
      const dy = y - d.y0;
      d.dx = dx; d.dy = dy;
      if (!d.axis) {
        if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return "";
        d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (d.axis === "y") { d.active = false; return "y"; }   // the page owns it from here
        if (d.kind === "mouse") {
          /* a mouse drag must not select the card text it started on */
          document.body.style.userSelect = "none";
          (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
        }
      }
      if (d.axis !== "x") return "";
      cfg().onDrag?.(dx, dy);
      return "x";
    };

    const finish = (cancelled: boolean) => {
      if (!d.active) return;
      d.active = false;
      const ms = Math.max(1, performance.now() - d.t0);
      const drag = d.axis === "x" && Math.abs(d.dx) > DRAG_PX;
      if (d.kind === "mouse") restoreSelect();
      /* A drag's click is not a tap: swallow the one the browser is about to fire so a
         swipe can never open the product page. A tap is never swallowed. */
      if (drag) {
        swallowed.current = true;
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(clearSwallow, SWALLOW_MS);
      }
      const r: SwipeRelease = { dx: d.dx, dy: d.dy, ms, axis: d.axis, cancelled, drag };
      d.axis = ""; d.kind = ""; d.dx = 0; d.dy = 0;
      cfg().onEnd?.(r);
    };

    /* ---------------------------------------------------------------- touch */
    const point = (e: TouchEvent) => e.touches[0] || e.changedTouches[0];

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) { d.active = false; return; }   // pinch-zoom → not ours
      const t = point(e);
      if (!t) return;
      begin(t.clientX, t.clientY, "touch", e.target);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) { d.active = false; return; }
      const t = point(e);
      if (!t) return;
      /* `preventDefault` here is what makes a horizontal drag uncompromisable: the
         browser stops treating the gesture as a scroll, so it cannot cancel it. */
      if (move(t.clientX, t.clientY) === "x") e.preventDefault();
    };

    const onTouchEnd = () => { if (d.active) finish(false); };
    const onTouchCancel = () => { if (d.active) finish(true); };

    /* ---------------------------------------------------------------- mouse
       Window listeners instead of setPointerCapture: the drag keeps working when the
       cursor leaves the element, and no engine has to retarget anything. */
    const onWinMove = (e: PointerEvent) => { if (e.pointerType === "mouse") move(e.clientX, e.clientY); };
    const onWinUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      detachMouse();
      finish(false);
    };
    const onWinCancel = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      detachMouse();
      finish(true);
    };
    const detachMouse = () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinCancel);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (cfg().mouse === false) return;
      begin(e.clientX, e.clientY, "mouse", e.target);
      if (!d.active) return;
      window.addEventListener("pointermove", onWinMove);
      window.addEventListener("pointerup", onWinUp);
      window.addEventListener("pointercancel", onWinCancel);
    };

    /* the native link / image drag is the browser's, not ours */
    const onDragStart = (e: Event) => e.preventDefault();

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("dragstart", onDragStart);

    detach.current = () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("dragstart", onDragStart);
      detachMouse();
      if (timer.current) window.clearTimeout(timer.current);
      restoreSelect();
    };
  }, []);

  /* `ref` goes on the gesture surface; `capture` on the same element (it has to sit on a
     React-rendered element; the swallow itself runs in the capture phase). */
  return { ref, node, capture: { onClickCapture } };
}
