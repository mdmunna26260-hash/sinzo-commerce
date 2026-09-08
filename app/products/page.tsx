import { db } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductGridSkeleton, Skeleton } from "@/components/loading-ui";
import { Suspense } from "react";
import ShopLayout from "./shop-layout";
import InfiniteGrid from "./infinite-grid";
import Link from "next/link";
import { PAGE_SIZE, listProducts } from "@/lib/product-listing";

export const dynamic = "force-dynamic";

type SP = { q?: string; category?: string; min?: string; max?: string; size?: string; color?: string; avail?: string; sort?: string; onsale?: string };

export const metadata = { title: "Shop All" };

/* TASK 01: filter-independent aggregates (category counts + size facets) are
   cached for 60s instead of two DB scans on every visit. Auto-refreshes;
   admin product saves also revalidate the tag (see /api/admin/products). */
const getListingAggregates = unstable_cache(
  async () => {
    const catCounts = await db.product.groupBy({ by: ["categoryId"], where: { status: "ACTIVE" }, _count: { _all: true } });
    const vsRows = await db.productVariant.findMany({
      where: { stock: { gt: 0 }, product: { status: "ACTIVE" } },
      select: { size: true }, distinct: ["size"],
    });
    const allSizes = vsRows.map((v) => v.size).filter((s): s is string => !!s)
      .sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b)));
    const countMap = new Map(catCounts.map((c) => [c.categoryId, c._count._all]));
    return {
      countMap: Array.from(countMap.entries()) as [number, number][],
      activeTotal: catCounts.reduce((a, c) => a + c._count._all, 0),
      allSizes,
    };
  },
  ["listing-aggregates-v1"],
  { revalidate: 60, tags: ["listing-aggregates"] }
);

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  const sp = searchParams;

  const activeCat = cats.find((c) => c.slug === sp.category);
  const qpill = (slug?: string) => {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (slug) params.set("category", slug);
    return "/products" + (params.toString() ? "?" + params.toString() : "");
  };
  const agg = await getListingAggregates();
  const countMap = new Map(agg.countMap);

  return (
    <>
      <Announcement text={s.homepage?.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container shop-wrap">
        <div className="eyebrow">{activeCat ? "Category" : sp.q ? "Search" : "Shop"}</div>
        <h1 className="shop-title">
          {activeCat ? activeCat.name : sp.q ? `Results for “${sp.q}”` : "All Products"}
        </h1>

        {/* quick category pills — always visible, never re-loads */}
        <div className="cat-pills">
          <Link className={"cat-pill" + (!sp.category ? " active" : "")} href={qpill(undefined)}>All{agg.activeTotal ? ` (${agg.activeTotal})` : ""}</Link>
          {cats.map((c) => (
            <Link key={c.slug} className={"cat-pill" + (sp.category === c.slug ? " active" : "")} href={qpill(c.slug)}>{c.name}{countMap.get(c.id) ? ` (${countMap.get(c.id)})` : ""}</Link>
          ))}
        </div>

        {/* Only the RESULTS area enters a loading state when filters/search/sort
            change — header, pills, filter controls all stay mounted (no flash). */}
        <Suspense key={JSON.stringify(sp)} fallback={<ResultsFallback />}>
          <Results sp={sp} cats={cats} sizes={agg.allSizes} />
        </Suspense>
      </div>
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}

/* Results skeleton: toolbar line + grid — same space the real results take */
function ResultsFallback() {
  return (
    <div aria-busy="true">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 20px", gap: 12 }}>
        <Skeleton className="sk-line" style={{ width: 90, margin: 0 }} />
        <Skeleton className="sk-line" style={{ width: 96, height: 38, margin: 0, borderRadius: 4 }} />
      </div>
      <ProductGridSkeleton count={8} />
    </div>
  );
}

/* The data-dependent part: one indexed DB query (filter + sort + paginate in
   the DATABASE, take PAGE_SIZE) + toolbar/filters + grid.
  TASK 01: previously this loaded the ENTIRE matching catalog into Node and
   filtered size/color in memory — now the database does all of it. */
async function Results({ sp, cats, sizes }: { sp: SP; cats: { id: number; name: string; slug: string }[]; sizes: string[] }) {
  const activeCat = cats.find((x) => x.slug === sp.category);
  const { total, products, hasMore } = await listProducts(sp, 1, activeCat?.id);

  const activeChips: { label: string; patch: Record<string, string | undefined> }[] = [];
  if (sp.category && activeCat) activeChips.push({ label: activeCat.name, patch: { category: undefined } });
  if (sp.size) activeChips.push({ label: "Size " + sp.size, patch: { size: undefined } });
  if (sp.min) activeChips.push({ label: "৳" + sp.min + "+", patch: { min: undefined } });
  if (sp.max) activeChips.push({ label: "≤ ৳" + sp.max, patch: { max: undefined } });
  if (sp.avail === "1") activeChips.push({ label: "In stock", patch: { avail: undefined } });
  if (sp.color) activeChips.push({ label: sp.color, patch: { color: undefined } });
  if (sp.onsale === "1") activeChips.push({ label: "On sale", patch: { onsale: undefined } });
  const chipQs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, String(v));
    return "/products" + (params.toString() ? "?" + params.toString() : "");
  };

  return (
    <ShopLayout count={total} cats={cats.map((c) => ({ name: c.name, slug: c.slug }))} sizes={sizes}>
      {activeChips.length > 0 && (
        <div className="chips">
          {activeChips.map((c) => (
            <Link key={c.label} className="chip removable" href={chipQs(c.patch)} scroll={false}>
              {c.label} <span aria-hidden>×</span>
            </Link>
          ))}
        </div>
      )}
      {products.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          <p>Try different filters or browse all products.</p>
          <br /><Link className="btn btn-outline" href="/products">Clear filters</Link>
        </div>
      ) : (
        <InfiniteGrid
          products={products}
          total={total}
          hasMore={hasMore}
          sp={{ q: sp.q, category: sp.category, min: sp.min, max: sp.max, size: sp.size, color: sp.color, avail: sp.avail, sort: sp.sort, onsale: sp.onsale }}
          pageSize={PAGE_SIZE}
        />
      )}
    </ShopLayout>
  );
}
