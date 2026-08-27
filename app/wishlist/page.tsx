import { Header, Footer } from "@/components/chrome";
import { getSettings, publicSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import WishlistClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wishlist" };

export default async function WishlistPage() {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await db.category.findMany({ orderBy: { id: "asc" } });
  const products = await db.product.findMany({ where: { status: "ACTIVE" }, include: { images: true, category: true } });
  const data = products.map((p) => ({ id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice, image: p.images?.[0]?.url, categoryName: p.category?.name, stock: p.stock }));
  return (
    <>
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <WishlistClient products={data} />
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
