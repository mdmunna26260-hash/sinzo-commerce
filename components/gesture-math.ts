/* The gesture maths behind every swipeable surface — the product-photo card galleries, the home
 * rails and the PDP "you may also like" rail.
 *
 * Pure on purpose, and dependency-free: no DOM, no React, no timers. Every decision a phone makes
 * during a tap / swipe / scroll is a plain function here, so it can be proved outside a device.
 * `node scripts/touch-audit.mjs` (`npm run test:touch`) asserts the three rules the owner tests by
 * thumb on an iPhone:
 *
 *   1. ONE tap opens the product    → lockAxis() stays "" → nothing is a drag → the click lives
 *   2. a swipe changes the photo / turns the rail, and never opens the product
 *                                   → lockAxis() "x"  → isDrag() true → its click dies
 *   3. a vertical drag scrolls the page (the page keeps the vertical axis, untouched)
 *
 * History worth keeping, because both bugs came back twice:
 *
 *   "product e click korle 2 bar lagbe" — a tap was being eaten by the drag that had just
 *   finished. The swallow of a drag's synthesized click must therefore be recognised by PLACE and
 *   TIME (swallowPlan/shouldSwallow): a fresh, deliberate tap is never swallowed, however soon it
 *   follows a swipe, and it can start anywhere on the card — including on the rail that a moment
 *   ago was mid-drag.
 *
 *   "swipe korle change hoy na" — the horizontal axis has to belong to us. lockAxis() decides it
 *   from the first few pixels of raw travel, the machine in use-swipe.ts takes the gesture away
 *   from the browser at that moment, and a release settles towards the page the thumb was heading
 *   for (slideAfter / railTarget) instead of snapping back.
 */

export const AXIS_LOCK_PX = 6;        // movement before the axis is decided
export const TAP_SLOP_PX = 12;        // a gesture inside this is still a tap, never a drag
export const MOVE_RATIO = 0.18;       // travel (of the surface width) that decides the slide/page
export const FLICK_VELOCITY = 0.35;   // px/ms — a quick flick counts even when it is short
export const RESIST = 0.35;           // rubber-band factor past the first/last photo or page
export const RAIL_MIN_PX = 24;        // a rail can be narrower than 18% — never turn it for a nudge
export const FALLBACK_WIDTH = 300;    // a card that has not been measured yet still has to swipe
export const SWALLOW_MS = 300;        // how long after a drag its synthesized click can arrive
export const SWALLOW_RADIUS_PX = 28;  // ...and how near the release point it has to land

export type Axis = "" | "x" | "y";

/* Who owns this gesture? "" = not decided yet (nothing moves), "x" = the surface takes the
   horizontal axis, "y" = the page keeps the vertical one (native scroll, never prevented). */
export function lockAxis(mx: number, my: number, lock = AXIS_LOCK_PX): Axis {
  if (Math.abs(mx) < lock && Math.abs(my) < lock) return "";
  return Math.abs(mx) > Math.abs(my) ? "x" : "y";
}

/* Past the first/last photo or page the finger travel is compressed, so the surface feels
   physical instead of broken. Applied to what is PAINTED, never to what is measured — see
   isDrag(): a 40px drag past the last photo is still a drag even when it paints as ~14px. */
export function resist(dx: number, index: number, count: number, factor = RESIST): number {
  const atStart = index === 0 && dx > 0;
  const atEnd = index === count - 1 && dx < 0;
  return atStart || atEnd ? dx * factor : dx;
}

/* Where should a card gallery settle after a release? Travel past MOVE_RATIO of the card, or a
   quick flick, turns exactly one photo; anything shorter springs back to where it started. */
export function slideAfter(g: {
  dx: number; ms: number; width: number; index: number; count: number;
  ratio?: number; velocity?: number;
}): number {
  const ratio = g.ratio ?? MOVE_RATIO;
  const velocity = g.velocity ?? FLICK_VELOCITY;
  const width = g.width > 0 ? g.width : FALLBACK_WIDTH;
  const ms = Math.max(1, g.ms);
  const far = Math.abs(g.dx) > width * ratio;
  const flick = Math.abs(g.dx / ms) > velocity;
  const next = far || flick ? g.index + (g.dx < 0 ? 1 : -1) : g.index;
  return Math.max(0, Math.min(g.count - 1, next));
}

/* Where should a released rail settle? Same idea on whole pages: 18% of a page (never less than
   RAIL_MIN_PX, so a narrow rail still needs a deliberate drag) or a flick turns one page. */
export function railTarget(g: { dx: number; width: number; ms: number; page: number; pages: number }): number {
  const far = Math.abs(g.dx) > Math.max(RAIL_MIN_PX, g.width * MOVE_RATIO);
  const flick = g.ms > 0 && Math.abs(g.dx / g.ms) > FLICK_VELOCITY;
  const next = far || flick ? g.page + (g.dx < 0 ? 1 : -1) : g.page;
  return Math.max(0, Math.min(Math.max(0, g.pages - 1), next));
}

/* Was this a drag? Only the horizontal axis can be one, and only past the slop a thumb never
   crosses while tapping. `dx` is the RAW travel, not the rubber-banded value: the click of a
   resisted drag past the last photo must still be eaten, or the swipe would open the product. */
export function isDrag(axis: Axis, dx: number, slop = TAP_SLOP_PX): boolean {
  return axis === "x" && Math.abs(dx) > slop;
}

export type SwallowPlan = { until: number; x: number; y: number };

/* Remember the end of a drag so its synthesized click can be recognised — and ONLY that one.
   A blind timer was the original "2 bar tap" bug: any tap landing in the next few hundred ms
   died, which is exactly what a shopper does after swiping a rail (swipe, then tap the photo).
   The plan carries where the finger left the screen, and the click has to come back there. */
export function swallowPlan(g: {
  axis: Axis; rawDx: number; x: number; y: number; now: number;
  slop?: number; window?: number;
}): SwallowPlan | null {
  if (!isDrag(g.axis, g.rawDx, g.slop)) return null;
  return { until: g.now + (g.window ?? SWALLOW_MS), x: g.x, y: g.y };
}

/* Is this click the tail of that drag, or a fresh deliberate tap? Both conditions matter: in time
   (the browser synthesizes it within a frame or two of the release) and in place (a new tap can
   start anywhere, but "anywhere" is usually NOT within a finger-width of where the drag ended).
   Touches are compared in client pixels; the click a synthesizer sends back carries the same. */
export function shouldSwallow(
  plan: SwallowPlan | null,
  click: { x: number; y: number; now: number },
  radius = SWALLOW_RADIUS_PX
): boolean {
  if (!plan) return false;
  if (click.now > plan.until) return false;
  return Math.hypot(click.x - plan.x, click.y - plan.y) <= radius;
}
