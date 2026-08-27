import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import Filters, { SortSelect } from "@/components/filters";
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

  // size filter (variant-based)
  if (searchParams.size) {
    products = products.filter((p) => p.variants.some((v) => v.size === searchParams.size && v.stock > 0));
  }

  const activeCat = cats.find((c) => c.slug === searchParams.category);

  return (
    <>
      <Announcement text={s.homepage?.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container" style={{ padding: "38px 24px 90px" }}>
        <div className="eyebrow">{activeCat ? "Category" : searchParams.q ? "Search" : "Shop"}</div>
        <h1 style={{ fontSize: "clamp(28px,3.4vw,40px)", margin: "8px 0 30px" }}>
          {activeCat ? activeCat.name : searchParams.q ? `Results for “${searchParams.q}”` : "All Products"}
        </h1>
        <div className="listing">
          <Filters cats={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
          <main>
            <div className="toolbar">
              <span style={{ color: "var(--muted)", fontSize: 13 }}>{products.length} product{products.length !== 1 ? "s" : ""}</span>
              <SortSelect value={searchParams.sort || "custom"} />
            </div>
            {products.length === 0 ? (
              <div className="empty">
                <h3>Nothing here yet</h3>
                <p>Try different filters or browse all products.</p>
                <br /><Link className="btn btn-outline" href="/products">Clear filters</Link>
              </div>
            ) : (
              <div className="grid grid-3">
                {products.map((p) => (
                  <ProductCard key={p.id} p={{
                    id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
                    image: p.images?.[0]?.url, categoryName: p.category?.name, stock: p.stock,
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
