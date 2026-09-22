/* The gesture maths behind the product-photo gallery (components/card-gallery.tsx).
 *
 * Pure on purpose. Every decision a phone makes during a tap / swipe / scroll is a plain
 * function here, with no DOM and no React, so it can be proved outside a device:
 * `node scripts/touch-audit.mjs` asserts the three rules the owner tests by hand —
 *
 *   1. one tap opens the product        → lockAxis() stays ""  → isDrag() false → the click lives
 *   2. a swipe changes the photo, never opens the page
 *                                       → lockAxis() "x"       → isDrag() true  → its click dies
 *   3. a vertical drag scrolls the page → lockAxis() "y"       → the gallery lets go
 *
 * History worth keeping: the first iPhone report was "product e click korle 2 bar lagbe" —
 * the swallow window was eating real taps. Two things caused it and both are encoded below:
 * a drag is only ever a drag past TAP_SLOP_PX, and the click we eat must come back at (almost)
 * the exact spot the finger left the screen, moments later. A fresh, deliberate tap is never
 * swallowed, however soon it follows a swipe. */

export const AXIS_LOCK_PX = 6;        // movement before the axis is decided
export const TAP_SLOP_PX = 12;        // a gesture inside this is still a tap, never a drag
export const MOVE_RATIO = 0.18;       // travel (of the card width) that decides the slide
export const FLICK_VELOCITY = 0.35;   // px/ms — a quick flick counts even when it is short
export const RESIST = 0.35;           // rubber-band factor past the first/last photo
export const SWALLOW_MS = 300;        // how long after a drag its synthesized click can arrive
export const SWALLOW_RADIUS_PX = 28;  // ...and how near the release point it has to land

export type Axis = "" | "x" | "y";

/* Who owns this gesture? "" = not decided yet (nothing moves), "x" = the gallery takes the
   horizontal axis, "y" = the page keeps the vertical one (native scroll, untouched). */
export function lockAxis(mx: number, my: number, lock = AXIS_LOCK_PX): Axis {
  if (Math.abs(mx) < lock && Math.abs(my) < lock) return "";
  return Math.abs(mx) > Math.abs(my) ? "x" : "y";
}

/* Past the first/last photo the finger travel is compressed, so the card feels physical
   instead of broken. Applied to what is PAINTED, never to what is measured — see isDrag(). */
export function resist(dx: number, index: number, count: number, factor = RESIST): number {
  const atStart = index === 0 && dx > 0;
  const atEnd = index === count - 1 && dx < 0;
  return atStart || atEnd ? dx * factor : dx;
}

/* Where should the gallery settle after a release? Distance (MOVE_RATIO of the card) or a
   quick flick turns one page; anything shorter springs back to the photo it started on. */
export function slideAfter(g: {
  dx: number; ms: number; width: number; index: number; count: number;
  ratio?: number; velocity?: number;
}): number {
  const ratio = g.ratio ?? MOVE_RATIO;
  const velocity = g.velocity ?? FLICK_VELOCITY;
  const width = g.width > 0 ? g.width : 300;
  const ms = Math.max(1, g.ms);
  const far = Math.abs(g.dx) > width * ratio;
  const flick = Math.abs(g.dx / ms) > velocity;
  const next = far || flick ? g.index + (g.dx < 0 ? 1 : -1) : g.index;
  return Math.max(0, Math.min(g.count - 1, next));
}

/* Was this a drag? Only the horizontal axis can be one, and only past the slop a thumb never
   crosses while tapping. `dx` here is the RAW finger travel, not the rubber-banded value:
   a 40px drag past the last photo is still a drag (it compresses to ~14px when painted) and
   its click must still be eaten, or the swipe would open the product. */
export function isDrag(axis: Axis, dx: number, slop = TAP_SLOP_PX): boolean {
  return axis === "x" && Math.abs(dx) > slop;
}

export type SwallowPlan = { until: number; x: number; y: number };

/* Remember the end of a drag so its synthesized click can be recognised — and ONLY that one.
   A blind timer was the original bug: any tap landing in the next few hundred ms died,
   which is exactly "click korle 2 bar lagbe". The plan carries where the finger left the
   screen, and the click has to come back there. */
export function swallowPlan(g: {
  axis: Axis; rawDx: number; x: number; y: number; now: number;
  slop?: number; window?: number;
}): SwallowPlan | null {
  if (!isDrag(g.axis, g.rawDx, g.slop)) return null;
  return { until: g.now + (g.window ?? SWALLOW_MS), x: g.x, y: g.y };
}

/* Is this click the tail of that drag, or a fresh deliberate tap? Both conditions matter:
   in time (the browser synthesizes it within a frame or two of the release) and in place
   (a new tap can start anywhere, but "anywhere" is usually NOT within a finger-width of
   where the last drag ended). */
export function shouldSwallow(
  plan: SwallowPlan | null,
  click: { x: number; y: number; now: number },
  radius = SWALLOW_RADIUS_PX
): boolean {
  if (!plan) return false;
  if (click.now > plan.until) return false;
  return Math.hypot(click.x - plan.x, click.y - plan.y) <= radius;
}
