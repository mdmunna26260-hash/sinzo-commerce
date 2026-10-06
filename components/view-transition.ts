"use client";
/* Shared-element page transition: product card photo  ⇄  product page hero photo.

   Built on the browser's View Transitions API (document.startViewTransition) — no library.
   Where the API is missing (older browsers) or the visitor asked for reduced motion, every
   helper here is a no-op and navigation behaves exactly as before.

   How a morph works
   1. Exactly ONE element on the old page gets `view-transition-name: product-hero`
      (the tapped card's photo box, or the hero when leaving a product page).
   2. startViewTransition snapshots the old page, then runs our update callback, which
      navigates and waits until the new page's hero is on screen (bounded, see HERO_WAIT_MS).
   3. Exactly ONE element on the new page gets the same name; the browser animates the box
      from the old rect to the new one (CSS in globals.css, "§ View Transition API").

   Names are set from JS only for the length of a transition, never permanently in CSS: two
   elements with the same name on one page make the browser skip the whole transition — which
   is what happened with a permanent name on the PDP hero when a "you may also like" card on
   that same page was tapped.

   Markup contract
   - card photo box:     data-vt-slug="<product slug>"   (components/card-media.tsx)
   - product page hero:  data-vt-hero                     (desktop .pdp-main-img + mobile .mgal-viewport;
                                                           only the visible one is used) */

export const VT_NAME = "product-hero";

/** Longest we hold the old page frozen waiting for the new hero. After that we animate
 *  anyway (the card photo simply fades out) — a slow network must never feel like a hang.
 *  (Chrome itself aborts a transition whose update takes longer than 4s.) */
export const HERO_WAIT_MS = 900;
/** Extra time we allow the hero <img> to finish decoding once the hero is mounted. */
const IMG_WAIT_MS = 320;

type Router = { push: (href: string) => void };
type VTDocument = Document & {
  startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<void>; ready: Promise<void>; skipTransition?: () => void };
};

export function vtSupported(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (typeof (document as VTDocument).startViewTransition !== "function") return false;
  try { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false; } catch {}
  return true;
}

export function startVT(update: () => Promise<void>) {
  return (document as VTDocument).startViewTransition!(update);
}

export function setVTName(el: HTMLElement | null | undefined, on: boolean) {
  if (!el) return;
  try {
    el.style.setProperty("view-transition-name", on ? VT_NAME : "");
    if (on) forceRendered(el);
  } catch {}
}

/* Home sections use `content-visibility: auto` (globals.css, .section). Right after a navigation a
   section's visibility hasn't been determined yet, its contents count as "skipped", and the browser
   silently leaves a named element inside it out of the transition (seen on the back navigation:
   card named, on screen, never captured). So while a transition runs, the named element's
   auto-ancestors are forced visible; clearVTNames() puts them back. */
function forceRendered(el: HTMLElement) {
  for (let a: HTMLElement | null = el.parentElement; a; a = a.parentElement) {
    if (getComputedStyle(a).contentVisibility === "auto") {
      a.style.setProperty("content-visibility", "visible");
      a.setAttribute("data-vt-cv", "");
    }
    /* A card that has not scrolled-revealed yet (.reveal = opacity 0, 0.6s fade — components/reveal.tsx)
       would be half transparent when the morph lands on it and visibly dim the photo. Reveal it now,
       without its fade. */
    if (a.classList.contains("reveal") && !a.classList.contains("in")) {
      a.style.setProperty("transition", "none");
      a.classList.add("in");
      a.setAttribute("data-vt-rv", "");
    }
  }
}

export function clearVTNames() {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLElement>("[data-vt-slug], [data-vt-hero]").forEach((el) => {
    if (el.style.getPropertyValue("view-transition-name")) el.style.removeProperty("view-transition-name");
  });
  document.querySelectorAll<HTMLElement>("[data-vt-cv]").forEach((el) => {
    el.style.removeProperty("content-visibility");
    el.removeAttribute("data-vt-cv");
  });
  document.querySelectorAll<HTMLElement>("[data-vt-rv]").forEach((el) => {
    el.style.removeProperty("transition"); // stays .in (revealed) — only the suppressed fade is restored
    el.removeAttribute("data-vt-rv");
  });
}

const rendered = (el: HTMLElement) => el.getClientRects().length > 0 && el.offsetWidth > 0;
const onScreen = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
};

/** The product page hero that is actually displayed (mobile gallery OR desktop main image). */
export function visibleHero(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>("[data-vt-hero]"));
  return all.find(rendered) || null;
}

/** First on-screen card photo for a product (a product can sit in several home rails). */
export function visibleCard(slug: string): HTMLElement | null {
  const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(slug) : slug.replace(/"/g, '\\"');
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-vt-slug="${esc}"]`));
  return all.find((el) => rendered(el) && onScreen(el)) || null;
}

/** "/products/abc" → "abc"; anything else → null. */
export function pdpSlug(pathname: string | null | undefined): string | null {
  const m = /^\/products\/([^/?#]+)\/?$/.exec(pathname || "");
  return m ? decodeURIComponent(m[1]) : null;
}

/** Resolve once the hero's photo has decoded (or after IMG_WAIT_MS — never blocks longer). */
export function heroSettled(hero: HTMLElement): Promise<void> {
  const img = Array.from(hero.querySelectorAll("img")).find((i) => rendered(i as HTMLElement)) as HTMLImageElement | undefined;
  if (!img || (img.complete && img.naturalWidth > 0)) return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, IMG_WAIT_MS);
    const done = () => { clearTimeout(t); res(); };
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
}

/* ---- forward: card tap → product page ---------------------------------------------------- */

let heroWaiter: ((hero: HTMLElement) => void) | null = null;
let busy = false;

/** Called by the product page once its hero is mounted (useLayoutEffect). */
export function notifyHeroMounted() {
  if (!heroWaiter) return;
  const hero = visibleHero();
  if (hero) heroWaiter(hero);
}

/** Navigate to a product page with the card photo morphing into the hero.
 *  Returns false when the morph isn't available — the caller then lets the link navigate normally. */
export function morphToProduct(router: Router, href: string, card: HTMLElement | null): boolean {
  if (!card || !vtSupported()) return false;
  if (busy) return true; // a second tap during the morph must not queue another navigation
  busy = true;
  clearVTNames(); // e.g. the hero of the product page we're leaving ("you may also like")
  setVTName(card, true);
  try {
    const vt = startVT(() => new Promise<void>((resolve) => {
      let done = false;
      const finish = (hero: HTMLElement | null) => {
        if (done) return;
        done = true;
        heroWaiter = null;
        setVTName(card, false); // the old card may survive into the new DOM (same rail) — never two names
        if (hero) setVTName(hero, true);
        resolve();
      };
      heroWaiter = (hero) => { heroSettled(hero).then(() => finish(hero)); };
      setTimeout(() => finish(visibleHero()), HERO_WAIT_MS);
      router.push(href);
    }));
    vt.finished.catch(() => {}).finally(() => { busy = false; clearVTNames(); });
  } catch {
    busy = false;
    clearVTNames();
    return false;
  }
  return true;
}
