import { Header, Footer } from "@/components/chrome";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { db } from "@/lib/db";
import CompareClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare Products", robots: { index: false } };

export default async function ComparePage({ searchParams }: { searchParams: { ids?: string } }) {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  const ids = (searchParams.ids || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 4);

  let products: any[] = [];
  if (ids.length) {
    const rows = await db.product.findMany({
      where: { id: { in: ids }, status: "ACTIVE" },
      select: {
        id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
        sku: true, shortDesc: true, badge: true, isNew: true, isBestSeller: true,
        category: { select: { name: true } },
        images: { select: { url: true }, orderBy: { position: "asc" }, take: 4 },
        variants: { select: { size: true, color: true, stock: true } },
        reviews: { where: { status: "APPROVED" }, select: { rating: true } },
      },
    });
    // preserve the user's chosen order
    const byId = new Map(rows.map((r) => [r.id, r]));
    products = ids.map((id) => byId.get(id)).filter(Boolean).map((p: any) => {
      const ratings = p.reviews.map((r: any) => r.rating);
      return {
        id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
        stock: Math.max(p.stock, p.variants.reduce((sum: number, v: any) => sum + v.stock, 0)),
        sku: p.sku, shortDesc: p.shortDesc, badge: p.badge, isNew: p.isNew, isBestSeller: p.isBestSeller,
        categoryName: p.category?.name || null,
        image: p.images?.[0]?.url || null,
        sizes: [...new Set(p.variants.map((v: any) => v.size).filter(Boolean))],
        colors: [...new Set(p.variants.map((v: any) => v.color).filter(Boolean))],
        rating: ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : null,
        reviewCount: ratings.length,
      };
    });
  }

  return (
    <>
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <CompareClient products={products} />
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
