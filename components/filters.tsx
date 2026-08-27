"use client";
import { useRouter, useSearchParams } from "next/navigation";

export default function Filters({ cats }: { cats: { name: string; slug: string }[] }) {
  const sp = useSearchParams();
  const router = useRouter();
  const get = (k: string) => sp.get(k) || undefined;
  const setKv = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v); else params.delete(k);
    }
    router.push("/products?" + params.toString());
  };
  const activeCat = get("category");
  const allSizes = ["S", "M", "L", "XL"];
  return (
    <aside className="filters">
      <h3>Categories</h3>
      <label><input type="radio" name="fcat" checked={!activeCat} onChange={() => setKv({ category: undefined })} />All</label>
      {cats.map((c) => (
        <label key={c.slug}>
          <input type="radio" name="fcat" checked={activeCat === c.slug} onChange={() => setKv({ category: c.slug })} />
          {c.name}
        </label>
      ))}
      <h3>Price (৳)</h3>
      <form className="price-row" onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setKv({ min: (fd.get("min") as string) || undefined, max: (fd.get("max") as string) || undefined });
      }}>
        <input type="number" name="min" placeholder="Min" defaultValue={get("min")} />
        <span>—</span>
        <input type="number" name="max" placeholder="Max" defaultValue={get("max")} />
        <button className="abtn sm" type="submit">Go</button>
      </form>
      <h3>Size</h3>
      {allSizes.map((sz) => (
        <label key={sz}>
          <input type="radio" name="fsize" checked={get("size") === sz} onChange={() => setKv({ size: get("size") === sz ? undefined : sz })} />
          {sz}
        </label>
      ))}
      <h3>Availability</h3>
      <label><input type="checkbox" checked={get("avail") === "1"} onChange={() => setKv({ avail: get("avail") === "1" ? undefined : "1" })} />In stock only</label>
      <label><input type="checkbox" checked={get("onsale") === "1"} onChange={() => setKv({ onsale: get("onsale") === "1" ? undefined : "1" })} />On sale</label>
    </aside>
  );
}

export function SortSelect({ value }: { value: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  return (
    <select value={value} onChange={(e) => {
      const params = new URLSearchParams(sp.toString());
      if (e.target.value === "custom") params.delete("sort"); else params.set("sort", e.target.value);
      router.push("/products?" + params.toString());
    }} aria-label="Sort products">
      <option value="custom">Featured order</option>
      <option value="new">Newest first</option>
      <option value="popular">Most viewed</option>
      <option value="price_asc">Price: low to high</option>
      <option value="price_desc">Price: high to low</option>
    </select>
  );
}
