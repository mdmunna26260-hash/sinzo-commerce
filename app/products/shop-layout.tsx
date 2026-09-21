"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Filters, { SortSelect } from "@/components/filters";
import { Spinner } from "@/components/loading-ui";

/* ONE owner of the shop filtering UI:
   toolbar (count · Filter btn [mobile] · Sort) + single Filters instance
   (desktop sticky sidebar / mobile full-screen drawer) + main column.

   Loading state for filter/sort/search changes:
   Next runs these navigations as React transitions → the previous results
   stay visible (no flash). While the server re-render is in flight we mark
   the results area as "updating": subtle dim + toolbar spinner. Everything
   else (header, pills, filters) stays fully interactive. The state clears
   the moment the fresh results commit. */
export default function ShopLayout({ count, cats, sizes, children }: {
  count: number; cats: { name: string; slug: string }[]; sizes?: string[]; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const sp = useSearchParams();
  const path = usePathname();
  const kids = useRef(children);

  // fresh results committed → loading done
  useEffect(() => { kids.current = children; setUpdating(false); }, [children]);

  useEffect(() => {
    const start = () => setUpdating(true);
    // programmatic pushes (sort select, filter drawer, chips-less controls)
    window.addEventListener("sz_nav_start", start);
    // Link clicks (category pills, removable chips, header category links).
    // BUBBLE phase on purpose: a click that another component cancelled (e.g. a swipe on a
    // product card's photo gallery, or its arrows) navigates nowhere, so nothing is "updating".
    // In the capture phase this used to fire first for those clicks too and — because the
    // navigation never happened — the results area stayed dimmed and unclickable forever.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("a[href*='/products']")) setUpdating(true);
    };
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("sz_nav_start", start);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // leaving the page or changing the base path → reset
  useEffect(() => { setUpdating(false); }, [path]);

  const activeCount = ["category", "min", "max", "size", "color", "avail", "onsale"].filter((k) => sp.get(k)).length;

  return (
    <>
      <div className="shop-toolbar">
        <div className="st-left">
          <span className="st-count">
            {updating && <Spinner size={13} className="st-spin" />}
            {count} Products
          </span>
          <button className="st-btn" onClick={() => setOpen(true)} aria-label="Open filters">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
            Filter{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        </div>
        <div className="st-right">
          <SortSelect value={sp.get("sort") || "custom"} />
        </div>
      </div>

      <div className="shop-layout">
        <div className="shop-side">
          <Filters cats={cats} sizes={sizes} mobileOpen={open} onClose={() => setOpen(false)} />
        </div>
        <main className={"shop-main" + (updating ? " updating" : "")} aria-busy={updating || undefined}>
          {children}
        </main>
      </div>
    </>
  );
}
