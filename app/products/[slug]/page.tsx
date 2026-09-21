import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clean } from "@/lib/search";
import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";

import { imgSrc, PDP_WIDTHS, PDP_SIZES, PDP_SRC_WIDTH } from "@/components/img-src";
import ProductPageClient from "./client";
import ProductPageReviewForm from "./review-form";
import RecentlyViewedServer from "@/components/recently-viewed-server";
import Link from "next/link";

export const dynamic = "force-dynamic";
// runtime caching via CDN keeps fast; skip build-time prerender (small VPS RAM)

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await db.product.findUnique({ where: { slug: params.slug }, include: { images: { orderBy: { position: "asc" }, take: 1 } } });
  if (!p) return { title: "Product not found" };
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com").replace(/\/$/, "");
  const url = `${base}/products/${p.slug}`;
  // DB titles carry trailing spaces ("LATHER JACKET ") → they leaked into <title> as a
  // double space and into og:title; and the share image must be the w1200 variant,
  // not the full-resolution original (Facebook crops, mobile users download ~1 MB).
  const title = clean(p.title);
  const desc = clean(p.shortDesc || p.description || "").slice(0, 155) || `${title} — SINZO. Cash on delivery all over Bangladesh.`;
  const img = p.images?.[0]?.url;
  const share = img ? (/^\/api\/media\/[a-z0-9]+$/i.test(img) ? `${img}/w1200` : img) : undefined;
  return {
    title,
    description: desc,
    alternates: { canonical: `/products/${p.slug}` },
    openGraph: {
      type: "website",
      title,
      description: desc,
      url,
      ...(share ? { images: [{ url: share.startsWith("http") ? share : base + share, width: 1200, height: 1200, alt: title }] } : {}),
    },
    twitter: { card: "summary_large_image", title, description: desc, ...(share ? { image: share.startsWith("http") ? share : base + share } : {}) },
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
  const relSelect = { id: true, title: true, slug: true, price: true, comparePrice: true, stock: true, badge: true, isNew: true, isBestSeller: true, categoryId: true, preorder: true, images: { select: { url: true, alt: true }, take: 1 }, variants: { select: { size: true, stock: true } } } as const;
  const sizesOf = (r: typeof related[number]) => Array.from(new Set((r.variants || []).filter((v) => (r.preorder ? !!v.size : v.stock > 0 && v.size)).map((v) => v.size!))).sort((a, b) => {
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
    // clean(): the raw DB string has trailing whitespace and newlines, which show up
    // verbatim in Google's snippet and in the JSON-LD preview tool
    description: clean(p.shortDesc || (p.description ? p.description.slice(0, 300) : "")) || clean(p.title),
    image: p.images?.[0]?.url ? [absImg(p.images[0].url)] : [],
    sku: p.sku || undefined,
    url: siteBase + "/products/" + p.slug,
    brand: { "@type": "Brand", name: s.store?.name || "SINZO" },
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: String(p.price),
      availability: p.preorder
        ? "https://schema.org/PreOrder"
        : totalStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: siteBase + "/products/" + p.slug,
      priceValidUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString().slice(0, 10),
      ...(p.comparePrice && p.comparePrice > p.price ? {
        priceSpecification: {
          "@type": "PriceSpecification",
          price: String(p.price), priceCurrency: "BDT",
          previousPrice: String(p.comparePrice),
          valueAddedTaxIncluded: false,
        },
        ...(p.saleEnds ? { validFor: { "@type": "QuantitativeValue", maxValue: Math.max(0, Math.round((new Date(p.saleEnds).getTime() - Date.now()) / 86400000)) }, unitText: "DAY" } : {}),
      } : {}),
      ...(p.preorder && p.preorderDate ? { availabilityStarts: new Date(p.preorderDate).toISOString().slice(0, 10) } : {}),
    },
    ...(s.shipping?.estimateInside || s.shipping?.insideDhaka != null ? {
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "BD" },
        shippingRate: { "@type": "ShippingRateSettings", shippingRateCurrency: "BDT", label: "BDT" },
      },
    } : {}),
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "BD",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 7,
      returnMethod: "https://schema.org/ReturnByMail",
      returnFees: "https://schema.org/FreeReturn",
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
          /* These three props MUST describe the same candidate set the galleries render, or the
             browser preloads one file and then requests another. They used to drift three ways:
             widths [600,1000,1200] against the galleries' [400,600,800,1000], `45vw` against the
             desktop column's calc(52vw - 120px), and a 900px breakpoint against the galleries'
             899px — so a 390px phone at DPR 3 preloaded w1200 and then displayed w1000, and a
             1440px desktop at DPR 1 preloaded w1000 and displayed w800. Both galleries and this
             preload now read PDP_WIDTHS / PDP_SIZES / PDP_SRC_WIDTH from components/img-src.ts,
             so they can only ever move together. */
          href={pv(first, PDP_SRC_WIDTH)}
          imageSrcSet={PDP_WIDTHS.map((w) => `${pv(first, w)} ${w}w`).join(", ")}
          imageSizes={PDP_SIZES}
          fetchPriority="high"
        />
      )}
      <Announcement text={s.homepage?.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <div className="container">
        <div style={{ padding: "22px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
          <Link href="/">Home</Link> / <Link href="/products">Shop</Link> {(p as any).category && String((p as any).category.name || "").trim().toLowerCase() !== String(p.title || "").trim().toLowerCase() && <>/ <Link href={"/products?category=" + (p as any).category.slug}>{(p as any).category.name}</Link></>} / <span style={{ color: "var(--text)" }}>{p.title}</span>
        </div>
        {/* The Delivery row reads the same admin shipping fields the checkout uses (with the same
            fallback strings), so the PDP can never contradict what the buyer pays or waits for. */}
        <ProductPageClient
          policies={{ inside: s.shipping?.estimateInside, outside: s.shipping?.estimateOutside, freeAt: s.shipping?.freeShippingThreshold || 0 }}
          sizeChartImage={p.sizeChartImage || null}
          soldCount={p.soldCount ?? null}
          saleEnds={p.saleEnds ? p.saleEnds.toISOString() : null}
          preorder={!!p.preorder}
          preorderDate={p.preorderDate ? p.preorderDate.toISOString() : null}
          soldMode={p.soldMode || "fixed"}
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
            variants: (p.preorder ? p.variants : p.variants.filter((v) => v.stock > 0)).map((v) => ({ id: v.id, size: v.size, color: v.color, stock: v.stock, price: v.price, image: v.image || null })),
            categoryName: p.category?.name,
            colorName: p.colorName,
            colorImage: p.colorImage,
          }}
          sizeChartHtml={p.category?.sizeChart || null}
          colorFamily={colorFamily}
        />
        {/* Reviews — the first block past the fold on a PDP, and the one surface that had no
            entrance at all. `.sdr` drives it from a CSS view() timeline (see globals.css §J). */}
        <section className="reviews sdr">
          <div className="section-head">
            <div><div className="eyebrow">Customer feedback</div><h2>Reviews ({p.reviews.length})</h2></div>
            {avgRating > 0 && <div style={{ fontSize: 15 }}>{"★".repeat(Math.round(avgRating))}<span style={{ color: "var(--muted)" }}> {avgRating.toFixed(1)} / 5</span></div>}
          </div>
          {p.reviews.length === 0 && <p style={{ color: "var(--muted)" }}>No reviews yet — be the first to review this product.</p>}
          {p.reviews.length > 1 && (
            <div className="reviews-hint">Swipe for all {p.reviews.length} reviews <span aria-hidden="true">→</span></div>
          )}
          {/* one track wrapper so phones can swipe the reviews sideways; desktop keeps the plain
              vertical stack (the wrapper is inert there — no .reviews .review descendant selectors exist) */}
          <div className="reviews-track">
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
          </div>
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
                    <ProductCard key={r.id} p={{ id: r.id, title: r.title, slug: r.slug, price: r.price, comparePrice: r.comparePrice, image: r.images?.[0]?.url, stock: r.stock, badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller, preorder: r.preorder, sizes: sizesOf(r) }} />
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
              <ProductCard key={r.id} p={{ id: r.id, title: r.title, slug: r.slug, price: r.price, comparePrice: r.comparePrice, image: r.images?.[0]?.url, stock: r.stock, badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller, preorder: r.preorder, sizes: sizesOf(r) }} />
            ))}
          </div>
        </section>
      </div>
      <RecentlyViewedServer currentId={p.id} />

      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}

