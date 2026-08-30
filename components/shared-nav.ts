/* Shared-element navigation: product card image → PDP hero.
   ⚠️ The OLD page snapshot is captured the moment startViewTransition() is
   called — BEFORE the callback runs. So the "product-hero" name MUST be put
   on the clicked card (and stripped from any current hero/skeleton to avoid
   duplicate-name skipping) BEFORE calling it. Setting names inside the
   callback (a previous version) left the old snapshot with no product-hero
   element → no pair → only the root fade played and the morph never showed.
   Inside the callback we only push the route and wait for the PDP shell
   (rAF poll, 700ms safety cap — no artificial delay). */
export function sharedProductNav(
  e: React.MouseEvent,
  router: { push: (url: string) => void },
  href: string
) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const doc = document as any;
  if (typeof doc.startViewTransition !== "function") return; // Firefox/old Safari → normal nav + CSS fade

  const card = e.currentTarget as HTMLElement | null;
  const imgWrap = card?.querySelector(".pcard-img") as HTMLElement | null;
  if (!imgWrap) return;
  e.preventDefault(); // take over from <Link>

  // ---- name the moving elements BEFORE the snapshot ----
  // (any current PDP hero / PDP skeleton box would otherwise duplicate the
  //  name on PDP→PDP navigation and make the browser skip the transition)
  const current = Array.from(document.querySelectorAll<HTMLElement>(".pdp-main-img, .pdp-sk .sk-img"));
  const prev = current.map((h) => h.style.viewTransitionName);
  current.forEach((h) => (h.style.viewTransitionName = "none"));
  imgWrap.style.viewTransitionName = "product-hero";

  const cleanup = () => {
    imgWrap.style.viewTransitionName = "";
    current.forEach((h, i) => (h.style.viewTransitionName = prev[i] ?? ""));
  };

  let vt: any;
  try {
    vt = doc.startViewTransition(() => new Promise<void>((resolve) => {
      router.push(href);
      const start = performance.now();
      const tick = () => {
        // resolve as soon as the new page's hero (or its skeleton box) exists
        if (document.querySelector(".pdp-main-img, .pdp-sk .sk-img") || performance.now() - start > 700) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
  } catch {
    cleanup();
    router.push(href);
    return;
  }
  try { vt?.finished?.finally?.(cleanup); } catch { cleanup(); }
}
