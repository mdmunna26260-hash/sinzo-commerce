/* Directional hysteresis prevents tiny touch/trackpad movements from flickering
   the dock. Clamp iOS rubber-band overscroll before deciding direction. */
export type DockScrollState = { lastY: number; travel: number; hidden: boolean };
export function nextDockScroll(state: DockScrollState, scrollY: number, maxY: number): DockScrollState {
  const y = Math.max(0, Math.min(scrollY, Math.max(0, maxY)));
  if (y <= 48) return { lastY: y, travel: 0, hidden: false };
  const delta = y - state.lastY;
  if (!delta) return { ...state, lastY: y };
  const travel = Math.sign(delta) === Math.sign(state.travel) ? state.travel + delta : delta;
  const hidden = travel >= 24 ? true : travel <= -10 ? false : state.hidden;
  return { lastY: y, travel: Math.max(-24, Math.min(24, travel)), hidden };
}
