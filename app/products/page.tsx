import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import Filters, { SortSelect } from "@/components/filters";
import ProductsToolbar from "./toolbar";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SP = { q?: string; category?: string; min?: string; max?: string; size?: string; avail?: string; sort?: string; onsale?: string };

export const metadata = { title: "Shop All" };

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await db.category.findMany({ orderBy: { id: "asc" } });

  const where: any = { status: "ACTIVE" };
  if (searchParams.q) {
    const q = searchParams.q.trim();
    where.OR = [
      { title: { contains: q } }, { description: { contains: q } }, { shortDesc: { contains: q } },
      { tags: { contains: q } }, { sku: { contains: q } },
    ];
  }
  if (searchParams.category) {
    const c = cats.find((x) => x.slug === searchParams.category);
    if (c) where.categoryId = c.id;
  }
  if (searchParams.min || searchParams.max) {
    where.price = {};
    if (searchParams.min) where.price.gte = parseFloat(searchParams.min);
    if (searchParams.max) where.price.lte = parseFloat(searchParams.max);
  }
  if (searchParams.onsale === "1") where.comparePrice = { not: null, gt: 0 };
  if (searchParams.avail === "1") where.stock = { gt: 0 };

  const orderBy: any =
    searchParams.sort === "price_asc" ? { price: "asc" } :
    searchParams.sort === "price_desc" ? { price: "desc" } :
    searchParams.sort === "popular" ? { views: "desc" } :
    searchParams.sort === "new" ? { createdAt: "desc" } :
    [{ position: "asc" }, { id: "desc" }]; // default = admin drag&drop order

  let products = await db.product.findMany({
    where, orderBy, include: { images: true, category: true, variants: true },
  });
  if (searchParams.size) {
    products = products.filter((p) => p.variants.some((v) => v.size === searchParams.size && v.stock > 0));
  }

  const activeCat = cats.find((c) => c.slug === searchParams.category);
  const activeChips: { label: string; patch: Record<string, string | undefined> }[] = [];
  if (searchParams.category && activeCat) activeChips.push({ label: activeCat.name, patch: { category: undefined } });
  if (searchParams.size) activeChips.push({ label: "Size " + searchParams.size, patch: { size: undefined } });
  if (searchParams.min) activeChips.push({ label: "৳" + searchParams.min + "+", patch: { min: undefined } });
  if (searchParams.max) activeChips.push({ label: "≤ ৳" + searchParams.max, patch: { max: undefined } });
  if (searchParams.avail === "1") activeChips.push({ label: "In stock", patch: { avail: undefined } });
  if (searchParams.onsale === "1") activeChips.push({ label: "On sale", patch: { onsale: undefined } });
  const chipQs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...searchParams, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, String(v));
    return "/products" + (params.toString() ? "?" + params.toString() : "");
  };

  return (
    <>
      <Announcement text={s.homepage?.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container shop-wrap">
        <div className="eyebrow">{activeCat ? "Category" : searchParams.q ? "Search" : "Shop"}</div>
        <h1 className="shop-title">
          {activeCat ? activeCat.name : searchParams.q ? `Results for “${searchParams.q}”` : "All Products"}
        </h1>

        {/* toolbar: mobile shows Filter button; desktop shows count + sort right */}
        <ProductsToolbar count={products.length} cats={cats.map((c) => ({ name: c.name, slug: c.slug }))} />

        {/* active filter chips */}
        {activeChips.length > 0 && (
          <div className="chips">
            {activeChips.map((c) => (
              <Link key={c.label} className="chip removable" href={chipQs(c.patch)} scroll={false}>
                {c.label} <span aria-hidden>×</span>
              </Link>
            ))}
          </div>
        )}

        <div className="shop-layout">
          <Filters cats={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
          <main>
            {products.length === 0 ? (
              <div className="empty">
                <h3>Nothing here yet</h3>
                <p>Try different filters or browse all products.</p>
                <br /><Link className="btn btn-outline" href="/products">Clear filters</Link>
              </div>
            ) : (
              <div className="shop-grid">
                {products.map((p) => (
                  <ProductCard key={p.id} p={{
                    id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
                    image: p.images?.[0]?.url, categoryName: p.category?.name, stock: p.stock,
                    isNew: p.isNew, isBestSeller: p.isBestSeller,
                  }} />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
