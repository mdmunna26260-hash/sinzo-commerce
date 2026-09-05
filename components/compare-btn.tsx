"use client";
import { useCompare, toast } from "./store";

/* Compare toggle overlay for product cards (stops link navigation).
   Sits top-left, mirrors .pcard-heart behaviour.
   Also remembers a small thumbnail for the compare bar. */
export function rememberCompareMeta(id: number, img?: string | null) {
  try {
    const map = JSON.parse(localStorage.getItem("sz_compare_meta") || "{}");
    if (img) map[id] = img; else delete map[id];
    localStorage.setItem("sz_compare_meta", JSON.stringify(map));
  } catch {}
}

export default function CompareBtn({ id, img }: { id: number; img?: string | null }) {
  const cmp = useCompare();
  const on = cmp.has(id);
  return (
    <button
      className={"pcard-cmp" + (on ? " on" : "")}
      aria-label={on ? "Remove from compare" : "Add to compare"}
      title={on ? "Remove from compare" : "Add to compare"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!on) rememberCompareMeta(id, img);
        const ok = cmp.toggle(id);
        if (ok) toast(on ? "Removed from compare" : "Added to compare ✓");
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" />
        <path d="M12 6v13" />
        <path d="M6 9l-3 6h6z" />
        <path d="M18 9l-3 6h6z" />
      </svg>
    </button>
  );
}
