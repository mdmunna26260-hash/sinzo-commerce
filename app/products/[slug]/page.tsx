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
import RecentlyViewedServer from "@/components/recently-viewed-server";
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
  // ensure newer columns (colorGroupId, soldCount, variant image etc.) exist before querying
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const p = await db.product.findUnique({
    where: { slug: params.slug },
    include: { images: { orderBy: { position: "asc" }, select: { url: true, alt: true, position: true } }, variants: true, category: true,
      reviews: { where: { status: "APPROVED" }, orderBy: { createdAt: "desc" } } },
  });
  if (!p || p.status === "ARCHIVED") notFound();

  // TASK: color family — DB-side query on indexed colorGroupId, selector fields only
  let colorFamily: { id: number; slug: string; colorName: string | null; colorImage: string | null }[] = [];
  if (p.colorGroupId) {
    const fam = await db.product.findMany({
      where: { colorGroupId: p.colorGroupId, status: "ACTIVE", id: { not: p.id } },
      select: {
        id: true, slug: true, colorName: true, colorImage: true,
        // cover image + linked variant images → warmed on the CURRENT color's
        // page so switching colors feels instant (all in this same indexed query)
        images: { orderBy: { position: "asc" }, take: 3, select: { url: true } },
        variants: { where: { image: { not: null } }, select: { image: true }, take: 3 },
      },
      orderBy: { id: "asc" },
      take: 12,
    });
    colorFamily = fam.map((f) => ({
      id: f.id,
      slug: f.slug,
      colorName: f.colorName,
      colorImage: f.colorImage,
      warmImages: [
        ...f.images.map((i) => i.url),
        ...f.variants.map((v) => v.image!).filter(Boolean),
      ].slice(0, 4),
    }));
  }

  await db.product.update({ where: { id: p.id }, data: { views: { increment: 1 } } }).catch(() => {});

  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  const relSelect = { id: true, title: true, slug: true, price: true, comparePrice: true, stock: true, badge: true, isNew: true, isBestSeller: true, categoryId: true, images: { select: { url: true, alt: true }, take: 1 }, variants: { select: { size: true, stock: true } } } as const;
  const sizesOf = (r: typeof related[number]) => Array.from(new Set((r.variants || []).filter((v) => v.stock > 0 && v.size).map((v) => v.size!))).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return 0;
  });
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

  // JSON-LD (schema.org Product) → price/stock/review stars in Google results
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com").replace(/\/$/, "");
  const absImg = (u?: string) => (u ? (u.startsWith("http") ? u : siteBase + u) : undefined);
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    description: p.shortDesc || (p.description ? p.description.slice(0, 300) : undefined),
    image: p.images?.[0]?.url ? [absImg(p.images[0].url)] : [],
    url: siteBase + "/products/" + p.slug,
    brand: { "@type": "Brand", name: s.store?.name || "SINZO" },
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: String(p.price),
      availability: totalStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: siteBase + "/products/" + p.slug,
    },
  };
  if (p.sku) jsonLd.sku = p.sku;
  if (avgRating > 0 && p.reviews.length) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: String(Math.round(avgRating * 10) / 10),
      reviewCount: String(p.reviews.length),
      bestRating: "5",
      worstRating: "1",
    };
  }

  const first = p.images?.[0]?.url;
  const pv = (u: string, w: number) => imgSrc(u, w) || u;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
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
          soldCount={p.soldCount ?? null}
          saleEnds={p.saleEnds ? p.saleEnds.toISOString() : null}
          preorder={!!p.preorder}
          preorderDate={p.preorderDate ? p.preorderDate.toISOString() : null}
          product={{
            id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
            shortDesc: p.shortDesc, description: p.description, sku: p.sku, stock: totalStock, lowStock: p.lowStock,
            // gallery = product images + any linked variant (color) images appended
            images: [
              ...p.images.map((i) => ({ url: i.url, alt: i.alt || p.title })),
              ...Array.from(new Set(p.variants.filter((v) => v.stock > 0 && v.image && !p.images.some((i) => i.url === v.image)).map((v) => v.image!)))
                .filter(Boolean)
                .map((u) => ({ url: u, alt: `${p.title}` })),
            ],
            variants: p.variants.filter((v) => v.stock > 0).map((v) => ({ id: v.id, size: v.size, color: v.color, stock: v.stock, price: v.price, image: v.image || null })),
            categoryName: p.category?.name,
            colorName: p.colorName,
            colorImage: p.colorImage,
          }}
          sizeChartHtml={p.category?.sizeChart || null}
          colorFamily={colorFamily}
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
              {(() => {
                let photos: string[] = [];
                try { photos = JSON.parse((r as any).photos || "[]"); } catch {}
                if (!photos.length) return null;
                return (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {photos.map((u) => (
                      <img key={u} src={u} alt={`Photo from ${r.name}`} loading="lazy" decoding="async" style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
                    ))}
                  </div>
                );
              })()}
            </div>
          ))}
          <ProductPageReviewForm productId={p.id} />
        </section>

        {/* Related */}
        <section className="section" style={{ paddingTop: 20 }}>
          <div className="section-head"><div><div className="eyebrow">Keep browsing</div><h2>You may also like</h2></div></div>
          {/* MOBILE: 2×2 swipeable carousel */}
          <div className="rel-carousel mobile-only">
            <div className="rel-scroll">
              {Array.from({ length: Math.ceil(Math.min(related.length, 40) / 4) }, (_, pi) => (
                <div className="rel-page" key={pi}>
                  {related.slice(pi * 4, pi * 4 + 4).map((r) => (
                    <ProductCard key={r.id} p={{ id: r.id, title: r.title, slug: r.slug, price: r.price, comparePrice: r.comparePrice, image: r.images?.[0]?.url, stock: r.stock, badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller, sizes: sizesOf(r) }} />
                  ))}
                </div>
              ))}
            </div>
            {Math.ceil(Math.min(related.length, 40) / 4) > 1 && (
              <div className="rel-dots">
                {Array.from({ length: Math.ceil(Math.min(related.length, 40) / 4) }, (_, pi) => (
                  <span key={pi} className={"rel-dot" + (pi === 0 ? " on" : "")} />
                ))}
              </div>
            )}
          </div>

          {/* DESKTOP: compact 4-col grid (normal product card size) */}
          <div className="grid grid-4 desktop-only">
            {related.map((r) => (
              <ProductCard key={r.id} p={{ id: r.id, title: r.title, slug: r.slug, price: r.price, comparePrice: r.comparePrice, image: r.images?.[0]?.url, stock: r.stock, badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller, sizes: sizesOf(r) }} />
            ))}
          </div>
        </section>
      </div>
      <RecentlyViewedServer currentId={p.id} />

      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}

