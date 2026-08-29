import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import { notFound } from "next/navigation";

export const revalidate = 60;

export default async function CollectionPage({ params }: { params: { slug: string } }) {
  const col = await db.collection.findUnique({
    where: { slug: params.slug },
    include: {
      products: {
        include: {
          product: {
            select: {
              id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
              badge: true, isNew: true, isBestSeller: true, position: true, status: true,
              category: { select: { name: true } },
              images: { select: { url: true }, orderBy: { position: "asc" as const }, take: 1 },
              // BUGFIX: variants were never loaded here → sizes & variant stock were silently ignored
              variants: { select: { size: true, color: true, stock: true } },
            },
          },
        },
      },
    },
  });
  if (!col) notFound();
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await db.category.findMany({ orderBy: { id: "asc" } });
  const items = col.products.filter((x: any) => x.product.status === "ACTIVE").map((x: any) => ({
    id: x.product.id, title: x.product.title, slug: x.product.slug, price: x.product.price,
    comparePrice: x.product.comparePrice, image: x.product.images?.[0]?.url,
    categoryName: x.product.category?.name, stock: Math.max(x.product.stock, (x.product.variants || []).reduce((s: number, v: any) => s + v.stock, 0)),
    isNew: x.product.isNew, isBestSeller: x.product.isBestSeller, badge: x.product.badge,
    sizes: Array.from(new Set((x.product.variants || []).filter((v: any) => v.stock > 0 && v.size).map((v: any) => v.size))).sort(),
  }));
  return (
    <>
      <Announcement text={s.homepage?.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container" style={{ padding: "38px 24px 100px" }}>
        <div className="eyebrow">Collection</div>
        <h1 style={{ fontSize: "clamp(28px,3.4vw,40px)", margin: "8px 0 6px" }}>{col.title}</h1>
        {col.subtitle && <p style={{ color: "var(--muted)", marginBottom: 30 }}>{col.subtitle}</p>}
        <div className="shop-grid">
          {items.map((p: any) => <ProductCard key={p.id} p={p} />)}
        </div>
      </div>
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
