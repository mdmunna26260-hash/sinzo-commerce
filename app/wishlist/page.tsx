import { Header, Footer } from "@/components/chrome";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { db } from "@/lib/db";
import WishlistClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wishlist" };

export default async function WishlistPage() {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  // only the fields ProductCard renders (badge included) — nothing heavy is shipped to the client
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
      badge: true, isNew: true, isBestSeller: true,
      category: { select: { name: true } },
      images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
      variants: { select: { size: true, stock: true } },
    },
  });
  const data = products.map((p) => ({
    id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
    image: p.images?.[0]?.url, categoryName: p.category?.name,
    stock: Math.max(p.stock, p.variants.reduce((sum, v) => sum + v.stock, 0)),
    sizes: Array.from(new Set(p.variants.filter((v) => v.stock > 0 && v.size).map((v) => v.size!))),
    isNew: p.isNew, isBestSeller: p.isBestSeller, badge: p.badge,
  }));
  return (
    <>
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <WishlistClient products={data} />
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
