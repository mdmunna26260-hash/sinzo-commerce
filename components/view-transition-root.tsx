"use client";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  vtSupported, startVT, clearVTNames, setVTName, visibleHero, visibleCard, pdpSlug, heroSettled, HERO_WAIT_MS,
} from "./view-transition";

/* Back / forward buttons for the card ⇄ product-page morph (the tap direction lives in
   components/card-link.tsx + components/view-transition.ts).

   The problem with popstate: Next.js handles it itself and — the page usually being in the
   router cache — can commit the new route BEFORE the browser takes the "old page" snapshot,
   which would animate new → new (nothing). So on popstate we start the transition and
   suspend this component's render of the new pathname until the snapshot callback has run.
   Navigations are React transitions, so suspending keeps the old page on screen instead of
   showing a fallback. Once the new route has committed, the effect below names the matching
   element on the new page and lets the browser capture it.

   Only runs when a product page is on one side (list → product or product → list); every other
   back/forward stays an instant, untouched navigation. Every wait is bounded, so a missing
   element or a skipped transition can never hold navigation up. */

type Gate = { promise: Promise<void>; open: boolean };
type Pending = { gate: Gate; finish: () => void; from: string };

const reactUse = (React as unknown as { use?: (p: Promise<unknown>) => unknown }).use;

export default function ViewTransitionRoot() {
  const pathname = usePathname();
  const shown = useRef(pathname);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const onPop = () => {
      if (!vtSupported()) return;
      const from = shown.current;
      const to = location.pathname;
      if (from === to) return;
      const fromSlug = pdpSlug(from);
      const toSlug = pdpSlug(to);
      if (!fromSlug && !toSlug) return;

      // name the element on the page we're leaving: the hero (product → list) or the card (list → product)
      clearVTNames();
      if (fromSlug) setVTName(visibleHero(), true);
      else if (toSlug) setVTName(visibleCard(toSlug), true);

      let openGate!: () => void;
      const gate: Gate = { open: false, promise: new Promise<void>((r) => { openGate = () => { gate.open = true; r(); }; }) };
      let finish!: () => void;
      const updated = new Promise<void>((r) => { finish = r; });
      const gateSafety = setTimeout(() => openGate(), 300);
      const updateSafety = setTimeout(() => finish(), HERO_WAIT_MS + 300);
      try {
        const vt = startVT(() => { clearTimeout(gateSafety); openGate(); return updated; });
        vt.finished.catch(() => {}).finally(() => { clearTimeout(updateSafety); clearVTNames(); });
      } catch {
        clearTimeout(gateSafety); clearTimeout(updateSafety);
        openGate(); finish(); clearVTNames();
        return;
      }
      setPending({ gate, finish, from });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // hold the new route until the old page has been snapshotted (see note above)
  if (pending && !pending.gate.open && pathname !== shown.current) {
    if (reactUse) reactUse(pending.gate.promise);
    else throw pending.gate.promise;
  }

  useEffect(() => {
    shown.current = pathname;
    if (!pending) return;
    const p = pending;
    setPending(null);
    clearVTNames(); // the old page's element is gone; never leave a second name around
    const toSlug = pdpSlug(pathname);
    const fromSlug = pdpSlug(p.from);
    if (toSlug) {
      const hero = visibleHero();
      if (!hero) { p.finish(); return; }
      heroSettled(hero).then(() => { setVTName(hero, true); p.finish(); });
    } else if (fromSlug) {
      setVTName(visibleCard(fromSlug), true); // null (card scrolled away) → plain cross-fade
      p.finish();
    } else {
      p.finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
