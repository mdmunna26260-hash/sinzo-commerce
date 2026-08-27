"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Filters, { SortSelect } from "@/components/filters";

/* Compact toolbar: [count] [Filter] [Sort] — Filter opens the mobile drawer. */
export default function ProductsToolbar({ count, cats, colors }: { count: number; cats: { name: string; slug: string }[]; colors?: string[] }) {
  const [open, setOpen] = useState(false);
  const sp = useSearchParams();
  const activeCount = ["category", "min", "max", "size", "avail", "onsale"].filter((k) => sp.get(k)).length;

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
      {/* SINGLE Filters instance: desktop sidebar + mobile drawer */}
      <div className="filters-side-wrap">
        <Filters cats={cats} colors={colors} mobileOpen={open} onClose={() => setOpen(false)} />
      </div>
    </>
  );
}
