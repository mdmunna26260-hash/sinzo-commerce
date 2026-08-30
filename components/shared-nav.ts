/* Shared-element navigation: product card image → PDP hero.
   - Right before the navigation snapshot, the clicked card's image gets the
     "product-hero" transition name (any existing PDP hero is temporarily
     unnamed so there is never a duplicate — duplicates would skip the whole
     transition).
   - Inside the View Transition callback we push the route and resolve as soon
     as the PDP shell renders (rAF polling, 700ms safety cap — never a fixed
     artificial delay).
   - Browsers without the API / reduced-motion users: normal Link navigation
     (the CSS pageIn fade still plays). */
export function sharedProductNav(
  e: React.MouseEvent,
  router: { push: (url: string) => void },
  href: string
) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const doc = document as any;
  if (typeof doc.startViewTransition !== "function") return; // graceful: normal navigation
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch {}

  const card = e.currentTarget as HTMLElement | null;
  const imgWrap = card?.querySelector(".pcard-img") as HTMLElement | null;
  if (!imgWrap) return;
  e.preventDefault();

  const heroes = Array.from(document.querySelectorAll<HTMLElement>(".pdp-main-img"));
  const cleanup = () => {
    imgWrap.style.viewTransitionName = "";
    heroes.forEach((h) => (h.style.viewTransitionName = ""));
  };
  try {
    const vt = doc.startViewTransition(() => new Promise<void>((resolve) => {
      heroes.forEach((h) => (h.style.viewTransitionName = "none"));
      imgWrap.style.viewTransitionName = "product-hero";
      router.push(href);
      const start = performance.now();
      const tick = () => {
        if (document.querySelector(".pdp-main-img") || performance.now() - start > 700) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    vt?.finished?.finally?.(cleanup);
  } catch {
    cleanup();
    router.push(href);
  }
}
