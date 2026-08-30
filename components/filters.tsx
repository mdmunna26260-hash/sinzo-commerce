"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* Mobile filter drawer + desktop sidebar — one component, spec-exact.
   Sizes come from the DB (real variant sizes), never hardcoded. */
export default function Filters({ cats, sizes = [], mobileOpen, onClose }: {
  cats: { name: string; slug: string }[]; sizes?: string[]; mobileOpen?: boolean; onClose?: () => void;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const get = (k: string) => sp.get(k) || undefined;
  const [min, setMin] = useState(get("min") || "");
  const [max, setMax] = useState(get("max") || "");

  useEffect(() => { setMin(get("min") || ""); setMax(get("max") || ""); /* eslint-disable-next-line */ }, [sp]);

  const push = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v); else params.delete(k);
    }
    window.dispatchEvent(new Event("sz_nav_start")); // results area → updating state
    router.push("/products?" + params.toString(), { scroll: false });
    onClose?.();
  };

  const activeCount = ["category", "min", "max", "size", "avail", "onsale"].filter((k) => get(k)).length;

  const body = (
    <>
      <h3>Categories</h3>
      <label><input type="radio" name="fcat" checked={!get("category")} onChange={() => push({ category: undefined })} />All</label>
      {cats.map((c) => (
        <label key={c.slug}>
          <input type="radio" name="fcat" checked={get("category") === c.slug} onChange={() => push({ category: c.slug })} />
          {c.name}
        </label>
      ))}
      <h3>Price (৳)</h3>
      <form className="price-row" onSubmit={(e) => {
        e.preventDefault();
        push({ min: min || undefined, max: max || undefined });
      }}>
        <input type="number" name="min" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric" />
        <span>—</span>
        <input type="number" name="max" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value)} inputMode="numeric" />
      </form>
      {sizes.length > 0 && (
        <>
          <h3>Size</h3>
          {sizes.map((sz) => (
            <label key={sz}>
              <input type="checkbox" checked={get("size") === sz} onChange={() => push({ size: get("size") === sz ? undefined : sz })} />
              {sz}
            </label>
          ))}
        </>
      )}
      <h3>Availability</h3>
      <label><input type="checkbox" checked={get("avail") === "1"} onChange={() => push({ avail: get("avail") === "1" ? undefined : "1" })} />In stock only</label>
      <label><input type="checkbox" checked={get("onsale") === "1"} onChange={() => push({ onsale: get("onsale") === "1" ? undefined : "1" })} />On sale</label>
    </>
  );

  return (
    <>
      {/* ---------- DESKTOP: compact sticky sidebar ---------- */}
      <aside className="filters side">{body}</aside>

      {/* ---------- MOBILE: full-screen drawer ---------- */}
      <div className={"fdrawer-bg" + (mobileOpen ? " open" : "")} onClick={onClose}>
        <div className={"fdrawer" + (mobileOpen ? " open" : "")} onClick={(e) => e.stopPropagation()}>
          <div className="fdrawer-head">
            <b>Filter</b>
            <button onClick={onClose} aria-label="Close filters">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="fdrawer-body">{body}</div>
          <div className="fdrawer-foot">
            <button
              className="abtn"
              onClick={() => { setMin(""); setMax(""); router.push("/products" + (get("q") ? "?q=" + encodeURIComponent(get("q")!) : ""), { scroll: false }); onClose?.(); }}
              disabled={activeCount === 0}
            >Clear All</button>
            <button className="abtn primary" onClick={onClose}>Apply Filters{activeCount > 0 ? ` (${activeCount})` : ""}</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* Sort dropdown — shared desktop + mobile toolbar */
export function SortSelect({ value }: { value: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  return (
    <select className="sort-select" value={value} onChange={(e) => {
      const params = new URLSearchParams(sp.toString());
      if (e.target.value === "custom") params.delete("sort"); else params.set("sort", e.target.value);
      window.dispatchEvent(new Event("sz_nav_start")); // results area → updating state
      router.push("/products?" + params.toString(), { scroll: false });
    }} aria-label="Sort products">
      <option value="custom">Sort</option>
      <option value="custom2" disabled>—</option>
      <option value="new">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="popular">Most viewed</option>
      <option value="price_asc">Price ↑</option>
      <option value="price_desc">Price ↓</option>
    </select>
  );
}
