import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import RelatedCarousel from "@/components/related-carousel";
import { imgSrc } from "@/components/img-src";
import ProductPageClient from "./client";
import ProductPageReviewForm from "./review-form";
import Link from "next/link";

export const dynamic = "force-dynamic";
// runtime caching via CDN keeps fast; skip build-time prerender (small VPS RAM)

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const p = await db.product.findUnique({ where: { slug: params.slug }, include: { images: true } });
  if (!p) return { title: "Product not found" };
  return {
    title: p.title,
    description: p.shortDesc || p.description?.slice(0, 150),
    openGraph: { title: p.title, description: p.shortDesc || "", images: p.images?.[0]?.url ? [p.images[0].url] : [] },
  };
}

export default async function PDP({ params, searchParams }: { params: { slug: string }; searchParams?: any }) {
  const p = await db.product.findUnique({
    where: { slug: params.slug },
    include: { images: { orderBy: { position: "asc" }, select: { url: true, alt: true, position: true } }, variants: true, category: true,
      reviews: { where: { status: "APPROVED" }, orderBy: { createdAt: "desc" } } },
  });
  if (!p || p.status === "ARCHIVED") notFound();

  await db.product.update({ where: { id: p.id }, data: { views: { increment: 1 } } }).catch(() => {});

  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  const relSelect = { id: true, title: true, slug: true, price: true, comparePrice: true, stock: true, badge: true, isNew: true, isBestSeller: true, categoryId: true, images: { select: { url: true, alt: true }, take: 1 } } as const;
  const related = await db.product.findMany({
    where: { status: "ACTIVE", categoryId: p.categoryId, id: { not: p.id } },
    select: relSelect, take: 40,
  });
  if (related.length < 4) {
    const extra = await db.product.findMany({ where: { status: "ACTIVE", id: { notIn: [p.id, ...related.map((r) => r.id)] } }, select: relSelect, take: 40 - related.length });
    related.push(...extra);
  }
  const avgRating = p.reviews.length ? p.reviews.reduce((a, r) => a + r.rating, 0) / p.reviews.length : 0;
  const variantStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
  const totalStock = Math.max(p.stock, variantStock);

  const first = p.images?.[0]?.url;
  const pv = (u: string, w: number) => imgSrc(u, w) || u;
  return (
    <>
      {first && (
        <link
          rel="preload"
          as="image"
          href={pv(first, 1000)}
          /* must match the gallery's srcset/sizes exactly, or the preload is wasted bandwidth */
          imageSrcSet={[600, 1000, 1200].map((w) => `${pv(first, w)} ${w}w`).join(", ")}
          imageSizes="(max-width: 900px) 100vw, 45vw"
          fetchPriority="high"
        />
      )}
      <Announcement text={s.homepage?.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container">
        <div style={{ padding: "22px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
          <Link href="/">Home</Link> / <Link href="/products">Shop</Link> {(p as any).category && <>/ <Link href={"/products?category=" + (p as any).category.slug}>{(p as any).category.name}</Link></>} / <span style={{ color: "var(--text)" }}>{p.title}</span>
        </div>
        <ProductPageClient
          sizeChartImage={p.sizeChartImage || null}
          product={{
            id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
            shortDesc: p.shortDesc, description: p.description, sku: p.sku, stock: totalStock, lowStock: p.lowStock,
            images: p.images.map((i) => ({ url: i.url, alt: i.alt || p.title })),
            variants: p.variants.filter((v) => v.stock > 0).map((v) => ({ id: v.id, size: v.size, color: v.color, stock: v.stock, price: v.price })),
            categoryName: (p as any).category?.name,
          }}
          sizeChartHtml={(p as any).category?.sizeChart || null}
        />
        {/* Reviews */}
        <section className="reviews">
          <div className="section-head">
            <div><div className="eyebrow">Customer feedback</div><h2>Reviews ({p.reviews.length})</h2></div>
            {avgRating > 0 && <div style={{ fontSize: 15 }}>{"★".repeat(Math.round(avgRating))}<span style={{ color: "var(--muted)" }}> {avgRating.toFixed(1)} / 5</span></div>}
          </div>
          {p.reviews.length === 0 && <p style={{ color: "var(--muted)" }}>No reviews yet — be the first to review this product.</p>}
          {p.reviews.map((r) => (
            <div className="review" key={r.id}>
              <span className="stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
              {r.verified && <span className="verified">Verified purchase</span>}
              <div className="who">{r.name} · {new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
              <p>{r.text}</p>
            </div>
          ))}
          <ProductPageReviewForm productId={p.id} />
        </section>

        {/* Related */}
        <section className="section" style={{ paddingTop: 20 }}>
          <div className="section-head"><div><div className="eyebrow">Keep browsing</div><h2>You may also like</h2></div></div>
          <RelatedCarousel items={related.slice(0, 40)} />

          {/* DESKTOP: 4-col grid */}
          <div className="grid grid-4 desktop-only">
            {related.map((r) => (
              <ProductCard key={r.id} p={{ id: r.id, title: r.title, slug: r.slug, price: r.price, comparePrice: r.comparePrice, image: r.images?.[0]?.url, stock: r.stock, badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller }} />
            ))}
          </div>
        </section>
      </div>
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}

