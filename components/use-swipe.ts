"use client";
import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react";
import { isDrag, lockAxis, shouldSwallow, swallowPlan } from "./gesture-math";
import type { Axis, SwallowPlan } from "./gesture-math";

/* ---------------------------------------------------------------------------
   ONE drag machine for every "swipe the photo / swipe the rail" surface:
   the card galleries (components/card-gallery.tsx) and the paged rails
   (components/swipe-rail.ts — home rails + the PDP "you may also like" rail).

   The decisions (axis, drag-or-tap, where to settle, which click to swallow) are pure and live in
   components/gesture-math.ts; this file is only the part that has to touch the DOM.

   Why touch events, not pointer events (owner's report, on a real iPhone: "product image swipe
   korle change hoy na" + "product page open korte single bar tap korte hoy"):

   1. `pointermove` is not a promise on WebKit. iOS Safari cancels the pointer stream of a
      horizontal drag on a `touch-action: pan-y` surface as soon as the thumb wanders a few degrees
      off horizontal (a WebKit engineer describes it in w3c/pointerevents#303; Chrome locks the
      axis, WebKit cancels it), and an `onPointerCancel → snap back` handler turns that into
      "swipe korle change hoy na". So: touch events with a NON-PASSIVE `touchmove`, and the gesture
      is taken away from the browser (`preventDefault`) the moment the axis is known to be
      horizontal — there is then nothing left to cancel. (React attaches `touchmove` passively at
      the root, so this has to be a real listener on the element; a React `onTouchMove` cannot
      cancel a scroll.)
   2. A cancel that still happens (call, notification, pinch, system gesture) releases the gesture
      with the distance already travelled, so the caller settles towards where the thumb was going
      instead of rewinding.
   3. No `setPointerCapture` anywhere: capturing on `pointerdown` retargets the click that follows
      a tap (WebKit is the touchy engine; iOS 13–15.4 ignored touch capture entirely). Touch events
      are implicitly targeted at the element the finger landed on for the whole gesture, and the
      mouse drag listens on `window` so leaving the element mid-drag still works.
   4. The click that follows a DRAG is swallowed, the click of a TAP never is — and "the click that
      follows a drag" is recognised by place AND time (`shouldSwallow`), not by a blind timer: a
      shopper who swipes a rail and then taps the photo of a card must open that product on the
      FIRST tap, even though it lands a few hundred milliseconds after the swipe.
   5. Nothing here re-renders on `touchstart`: the callers keep every state write and every <img>
      mount out of the touch task, because WebKit drops the tap's click when the tree under the
      finger changes before `touchend`.

   Desktop is deliberately unchanged: hover affordances live in CSS, the mouse keeps the same
   drag-to-see-the-next-photo behaviour (window `pointermove`), and a click without movement always
   navigates.
   --------------------------------------------------------------------------- */

export type SwipeRelease = {
  dx: number; dy: number; ms: number;
  axis: Axis;
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
   * `touchend`, which is the whole "2 bar tap korte hoy" report.
   */
  onStart?: () => void;
  /** Live horizontal movement, in pixels (positive = finger moved right). */
  onDrag?: (dx: number, dy: number) => void;
  /** Gesture finished: finger up, mouse up, or the browser stole it. */
  onEnd?: (r: SwipeRelease) => void;
  /** A mouse drag actually started / ended — the callers use it for the grabbing cursor. */
  onMouseDrag?: (active: boolean) => void;
};

type Gesture = {
  active: boolean;
  kind: "" | "touch" | "mouse";
  x0: number; y0: number;
  x: number; y: number;
  dx: number; dy: number;
  axis: Axis;
  t0: number;
};

export function useSwipe(opts: SwipeOpts, external?: MutableRefObject<HTMLDivElement | null>) {
  /* The node the listeners live on. `external` lets a caller keep its own handle on the same
     element (the card gallery measures it, the rail drives its scrollLeft), so there is never a
     second, competing ref. */
  const own = useRef<HTMLDivElement | null>(null);
  const node = external || own;
  const latest = useRef(opts);
  latest.current = opts;
  const plan = useRef<SwallowPlan | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const g = useRef<Gesture>({ active: false, kind: "", x0: 0, y0: 0, x: 0, y: 0, dx: 0, dy: 0, axis: "", t0: 0 });

  /* The click that follows a drag belongs to the drag. Capture phase, so neither the card's <Link>
     nor the shop grid's "updating" listener ever sees it — and a tap is never touched. */
  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!shouldSwallow(plan.current, { x: e.clientX, y: e.clientY, now: performance.now() })) return;
    plan.current = null;                 // the drag's own click comes back exactly once
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /* A callback ref, not an effect: a surface that mounts later (a rail that only appears once it
     has items) is still wired up, and the previous element is detached first. */
  const setNode = useCallback((el: HTMLDivElement | null) => {
    detach.current?.();
    detach.current = null;
    node.current = el;
    if (!el) return;

    const o = () => latest.current;
    const d = g.current;

    const restoreSelect = () => {
      document.body.style.userSelect = "";
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "";
    };

    const begin = (x: number, y: number, kind: "touch" | "mouse", target: EventTarget | null) => {
      const c = o();
      if (c.enabled && !c.enabled()) return;
      if (c.skip && c.skip(target instanceof Element ? target : null)) return;
      d.active = true; d.kind = kind; d.axis = ""; d.dx = 0; d.dy = 0;
      d.x0 = x; d.y0 = y; d.x = x; d.y = y; d.t0 = performance.now();
      /* A fresh gesture is never the tail of the previous one: the click the browser
         synthesizes after a drag is dispatched before this touchstart — so a shopper who
         swipes a rail and then taps a product opens it on the FIRST tap. */
      plan.current = null;
      c.onStart?.();
    };

    /** Decide the axis. Returns "x" while the horizontal axis is ours (the caller preventDefaults). */
    const move = (x: number, y: number) => {
      if (!d.active) return "" as Axis;
      d.x = x; d.y = y;
      const dx = x - d.x0;
      const dy = y - d.y0;
      d.dx = dx; d.dy = dy;
      if (!d.axis) {
        const axis = lockAxis(dx, dy);
        if (!axis) return "" as Axis;
        d.axis = axis;
        if (axis === "y") { d.active = false; return axis; }   // the page owns it from here
        if (d.kind === "mouse") {
          /* a mouse drag must not select the card text it started on */
          document.body.style.userSelect = "none";
          (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
          o().onMouseDrag?.(true);
        }
      }
      if (d.axis !== "x") return "" as Axis;
      o().onDrag?.(dx, dy);
      return d.axis;
    };

    const finish = (cancelled: boolean, x?: number, y?: number) => {
      if (!d.active) return;
      d.active = false;
      const ms = Math.max(1, performance.now() - d.t0);
      const axis = d.axis;
      const drag = isDrag(axis, d.dx);
      /* Where the finger left the screen — the drag's own click has to come back near here. */
      const px = x ?? d.x;
      const py = y ?? d.y;
      if (d.kind === "mouse") { restoreSelect(); o().onMouseDrag?.(false); }
      plan.current = swallowPlan({ axis, rawDx: d.dx, x: px, y: py, now: performance.now() });
      const r: SwipeRelease = { dx: d.dx, dy: d.dy, ms, axis, cancelled, drag };
      d.axis = ""; d.kind = ""; d.dx = 0; d.dy = 0;
      o().onEnd?.(r);
    };

    const firstTouch = (e: TouchEvent) => e.touches[0] || e.changedTouches[0];

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) { d.active = false; return; }   // pinch-zoom → not ours
      const t = firstTouch(e);
      if (!t) return;
      begin(t.clientX, t.clientY, "touch", e.target);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) { d.active = false; return; }
      const t = firstTouch(e);
      if (!t) return;
      /* `preventDefault` here is what makes a horizontal drag uncompromisable: the browser stops
         treating the gesture as a scroll, so there is nothing left to cancel it. */
      if (move(t.clientX, t.clientY) === "x") e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      finish(false, t?.clientX, t?.clientY);
    };
    const onTouchCancel = (e: TouchEvent) => {
      /* A stolen gesture is still a gesture: the callers settle on what the thumb dragged
         towards, and the distance already travelled is what decides it. */
      const t = e.changedTouches[0];
      finish(true, t?.clientX, t?.clientY);
    };

    /* ---------------------------------------------------------------- mouse
       Window listeners instead of setPointerCapture: the drag keeps working when the cursor
       leaves the element, and no engine has to retarget anything. */
    const onWinMove = (e: PointerEvent) => { if (e.pointerType === "mouse") move(e.clientX, e.clientY); };
    const detachMouse = () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinCancel);
    };
    const onWinUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      detachMouse();
      finish(false, e.clientX, e.clientY);
    };
    const onWinCancel = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      detachMouse();
      finish(true, e.clientX, e.clientY);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (o().mouse === false) return;
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
      restoreSelect();
      plan.current = null;
    };
  }, []);

  /* `ref` goes on the gesture surface; `capture` goes on the same element — it has to sit on a
     React-rendered node, while the swallow itself runs in the capture phase. */
  return { ref: setNode, node, capture: { onClickCapture } };
}
