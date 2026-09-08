import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import { ProductGridSkeleton, Skeleton } from "@/components/loading-ui";
import { Suspense } from "react";
import ShopLayout from "./shop-layout";
import InfiniteGrid from "./infinite-grid";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SP = { q?: string; category?: string; min?: string; max?: string; size?: string; color?: string; avail?: string; sort?: string; onsale?: string };

export const metadata = { title: "Shop All" };

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
  const catCounts = await db.product.groupBy({ by: ["categoryId"], where: { status: "ACTIVE" }, _count: { _all: true } });
  const countMap = new Map(catCounts.map((c) => [c.categoryId, c._count._all]));
  const activeTotal = catCounts.reduce((a, c) => a + c._count._all, 0);
  // real variant sizes across active products (natural sort: 28…40, then S…XL)
  const vsRows = await db.productVariant.findMany({
    where: { stock: { gt: 0 }, product: { status: "ACTIVE" } },
    select: { size: true }, distinct: ["size"],
  });
  const allSizes = vsRows.map((v) => v.size).filter((s): s is string => !!s)
    .sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b)));

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
          <Link className={"cat-pill" + (!sp.category ? " active" : "")} href={qpill(undefined)}>All{activeTotal ? ` (${activeTotal})` : ""}</Link>
          {cats.map((c) => (
            <Link key={c.slug} className={"cat-pill" + (sp.category === c.slug ? " active" : "")} href={qpill(c.slug)}>{c.name}{countMap.get(c.id) ? ` (${countMap.get(c.id)})` : ""}</Link>
          ))}
        </div>

        {/* Only the RESULTS area enters a loading state when filters/search/sort
            change — header, pills, filter controls all stay mounted (no flash). */}
        <Suspense key={JSON.stringify(sp)} fallback={<ResultsFallback />}>
          <Results sp={sp} cats={cats} sizes={allSizes} />
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

/* The data-dependent part: products query + toolbar/filters + grid */
async function Results({ sp, cats, sizes }: { sp: SP; cats: { id: number; name: string; slug: string }[]; sizes: string[] }) {
  const where: any = { status: "ACTIVE" };
  if (sp.q) {
    const q = sp.q.trim();
    where.OR = [
      { title: { contains: q } }, { description: { contains: q } }, { shortDesc: { contains: q } },
      { tags: { contains: q } }, { sku: { contains: q } },
    ];
  }
  if (sp.category) {
    const c = cats.find((x) => x.slug === sp.category);
    if (c) where.categoryId = c.id;
  }
  if (sp.min || sp.max) {
    where.price = {};
    if (sp.min) where.price.gte = parseFloat(sp.min);
    if (sp.max) where.price.lte = parseFloat(sp.max);
  }
  if (sp.onsale === "1") where.comparePrice = { not: null, gt: 0 };
  if (sp.avail === "1") where.stock = { gt: 0 };

  const orderBy: any =
    sp.sort === "price_asc" ? { price: "asc" } :
    sp.sort === "price_desc" ? { price: "desc" } :
    sp.sort === "popular" ? { views: "desc" } :
    sp.sort === "new" ? { createdAt: "desc" } :
    sp.sort === "oldest" ? { createdAt: "asc" } :
    [{ position: "asc" }, { id: "desc" }]; // default = admin drag&drop order

  const totalMatching = await db.product.count({ where });
  // select only card fields — descriptions/tags/sku stay on the server,
  // keeping the transferred page payload small on mobile connections
  let products = await db.product.findMany({
    where, orderBy,
    select: {
      id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
      badge: true, isNew: true, isBestSeller: true,
      category: { select: { name: true } },
      images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
      variants: { select: { size: true, color: true, stock: true } },
    },
  });

  if (sp.size) {
    products = products.filter((p) => p.variants.some((v) => v.size === sp.size && v.stock > 0));
  }
  if (sp.color) {
    products = products.filter((p) => p.variants.some((v) => (v.color || "").toLowerCase() === sp.color!.toLowerCase() && v.stock > 0));
  }

  const activeChips: { label: string; patch: Record<string, string | undefined> }[] = [];
  if (sp.category && cats.find((c) => c.slug === sp.category)) activeChips.push({ label: cats.find((c) => c.slug === sp.category)!.name, patch: { category: undefined } });
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
    <ShopLayout count={totalMatching} cats={cats.map((c) => ({ name: c.name, slug: c.slug }))} sizes={sizes}>
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
        <InfiniteGrid products={products.map((p) => ({
          id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
          image: p.images?.[0]?.url, categoryName: p.category?.name, stock: Math.max(p.stock, p.variants.reduce((s, v) => s + v.stock, 0)),
          isNew: p.isNew, isBestSeller: p.isBestSeller, badge: p.badge,
          colors: Array.from(new Set(p.variants.filter((v) => v.stock > 0 && v.color).map((v) => v.color!))),
          sizes: [...new Set(p.variants.filter((v) => v.stock > 0 && v.size).map((v) => v.size!))].sort(),
        }))} />
      )}
    </ShopLayout>
  );
}
