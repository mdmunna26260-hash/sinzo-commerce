import { db } from "@/lib/db";
import { seoKeywords } from "@/lib/seo";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { navCats } from "@/lib/category-tree";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import Link from "next/link";
import { clean } from "@/lib/search";

/* Combo department: every ACTIVE product flagged comboEligible (admin product form →
   "Combo offer" checkbox). Hero CTA / nav can link here (/combo). */
export const revalidate = 60;

export async function generateMetadata() {
  return {
    title: "Combo Offers",
    description: "Combo department — buy 2 or 3 of the same piece and save automatically. Cash on delivery all over Bangladesh.",
    keywords: seoKeywords(["combo offer", "combo deals", "buy 2 get discount", "buy 3", "SINZO"]),
    alternates: { canonical: "/combo" },
    openGraph: { type: "website", title: "Combo Offers — SINZO", description: "Buy 2 or 3, save automatically." },
  };
}

export default async function ComboPage() {
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const [products, s, cats] = await Promise.all([
    db.product.findMany({
      where: { status: "ACTIVE", comboEligible: true },
      orderBy: { position: "asc" },
      select: {
        id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
        badge: true, isNew: true, isBestSeller: true, position: true, preorder: true, comboOffers: true,
        category: { select: { name: true } },
        images: { select: { url: true }, orderBy: { position: "asc" as const }, take: 6 },
        variants: { select: { size: true, color: true, stock: true } },
      },
    }),
    getSettings(),
    getCategories(),
  ]);
  const cfg = publicSettings(s);
  const items = products.map((p: any) => ({
    id: p.id, title: clean(p.title), slug: p.slug, price: p.price,
    comparePrice: p.comparePrice, image: p.images?.[0]?.url,
    images: (p.images || []).map((im: any) => im.url),
    categoryName: p.category?.name, stock: Math.max(p.stock, (p.variants || []).reduce((s: number, v: any) => s + v.stock, 0)),
    isNew: p.isNew, isBestSeller: p.isBestSeller, badge: p.badge || "Combo", preorder: !!p.preorder,
    sizes: Array.from(new Set((p.variants || []).filter((v: any) => (p.preorder || v.stock > 0) && v.size).map((v: any) => v.size))).sort(),
  }));
  return (
    <>
      <Announcement text={s.homepage?.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={navCats(cats)} />
      <div className="container" style={{ padding: "38px 24px 100px" }}>
        <div className="eyebrow">Combo Department</div>
        <h1 style={{ fontSize: "clamp(28px,3.4vw,40px)", margin: "8px 0 6px" }}>Combo Offers</h1>
        <p style={{ color: "var(--muted)", marginBottom: 22, maxWidth: 560 }}>
          Buy 2 or 3 of the same piece and the discount applies automatically at checkout — no code needed.
        </p>
        {items.length > 0 && (
          <div className="collection-browse-toolbar">
            <span>{items.length} {items.length === 1 ? "Product" : "Products"}</span>
          </div>
        )}
        {items.length === 0 ? (
          <div className="empty">
            <h3>No combo offers right now</h3>
            <p>Browse the full catalogue instead.</p>
            <br /><Link className="btn btn-outline" href="/products">See all products</Link>
          </div>
        ) : (
          <div className="shop-grid">
            {items.map((p: any) => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
      <Footer cfg={{ ...cfg, _nav: { categories: navCats(cats) } }} />
    </>
  );
}
