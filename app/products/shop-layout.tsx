"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Filters, { SortSelect } from "@/components/filters";

/* ONE owner of the shop filtering UI:
   toolbar (count · Filter btn [mobile] · Sort) + single Filters instance
   (desktop sticky sidebar / mobile full-screen drawer) + main column. */
export default function ShopLayout({ count, cats, children }: {
  count: number; cats: { name: string; slug: string }[]; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sp = useSearchParams();
  const activeCount = ["category", "min", "max", "size", "color", "avail", "onsale"].filter((k) => sp.get(k)).length;

  return (
    <>
      <div className="shop-toolbar">
        <div className="st-left">
          <span className="st-count">{count} Products</span>
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
          <Filters cats={cats} mobileOpen={open} onClose={() => setOpen(false)} />
        </div>
        <main className="shop-main">{children}</main>
      </div>
    </>
  );
}
