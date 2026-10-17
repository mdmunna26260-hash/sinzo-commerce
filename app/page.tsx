import Link from "next/link";
import { Fragment } from "react";
import type { CSSProperties } from "react";
import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import { imgSrc } from "@/components/img-src";
import { CartProvider } from "@/components/store";
import Carousel from "@/components/home/carousel";
import SmartImg from "@/components/smart-img";
import SafeSection from "@/components/safe-section";
import { makeReviewLoop } from "@/lib/review-marquee";
import { discountPercent, pickDiscountProducts, pickLimitedProducts } from "@/lib/home-merchandising";

// ISR: Cache page for 60s, then revalidate in background
// First visitor after expiry: gets cached page (fast), fresh page renders in background
export const dynamic = "force-dynamic";
// runtime caching via CDN headers keeps it fast; skip build-time DB (small VPS)

const DEFAULT_SECTIONS = [
  { id: "hero", enabled: true }, { id: "values", enabled: true }, { id: "featured", enabled: true },
  { id: "categories", enabled: true }, { id: "discounts", enabled: true }, { id: "promo", enabled: true },
  { id: "bestsellers", enabled: true }, { id: "limited", enabled: true }, { id: "testimonials", enabled: true },
];
const MERCH_SECTION_IDS = ["discounts", "limited"] as const;

const CAT_IMG: Record<string, string> = { shirts: "shirt", outerwear: "coat", dresses: "dress", bottoms: "trousers", knitwear: "knit", accessories: "bag", "t-shirts": "tee" };

/* editorial section header: 01 — Eyebrow / Title / View All */
function Head({ no, eyebrow, title, href }: { no: string; eyebrow: string; title: string; href?: string }) {
  return (
    <div className="section-head2">
      <div>
        <div className="sh-eyebrow"><span className="sh-no">{no}</span>{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      {href && <Link className="sh-link" href={href}>View All <span aria-hidden>→</span></Link>}
    </div>
  );
}

function ProductShelf({ products }: { products: any[] }) {
  if (!products.length) return null;
  const pages = Array.from({ length: Math.ceil(products.length / 4) }, (_, index) => products.slice(index * 4, index * 4 + 4));
  return (
    <>
      <Carousel className="mobile-only">
        {pages.map((page, pageIndex) => (
          <div className="grid grid-4" key={"shelf-" + pageIndex}>
            {page.map((product: any, index: number) => <ProductCard key={product.id} p={product} rd={(pageIndex * 4 + index) % 4} />)}
          </div>
        ))}
      </Carousel>
      <div className="desktop-only">
        <div className="grid grid-4">
          {products.map((product: any, index: number) => <ProductCard key={product.id} p={product} rd={index % 4} />)}
        </div>
      </div>
    </>
  );
}

function CatTile({ c, rd }: { c: any; rd?: number }) {
  const seed = "/uploads/seed/p-" + (CAT_IMG[c.slug] || "shirt") + "-600.webp";
  const tileSrc = c.image
    ? (c.image.includes("/uploads/seed/") ? c.image.replace(/\.jpg$/, "-600.webp") : (c.image.match(/^\/api\/media\/([a-z0-9]+)$/i) ? c.image + "/w600" : c.image))
    : seed;
  return (
    <Link className="ctile reveal" href={"/products?category=" + c.slug} style={rd != null ? ({ "--rd": rd } as CSSProperties) : undefined}>
      {/* SmartImg owns the broken-image fallback. An inline onError={(e) => …} here used to sit on this
          <img>; this tile is passed into <Carousel> (a client component), and React refuses function props
          across that boundary — it threw while serializing the payload, so the server HTML looked fine
          (curl/SEO saw the page) and every browser replaced it with the OOPS card after hydration. */}
      <SmartImg src={tileSrc} alt={c.name} fallback={seed} sizes="(max-width: 899px) 45vw, 23vw" widths={[300, 600, 1000]} />
      <div className="ctile-label"><span>{c.description?.slice(0, 40) || "Collection"}</span><h3>{c.name}</h3></div>
    </Link>
  );
}

type HomeReview = { id: number; name: string; rating: number; text: string; product: { title: string } };
function Quote({ r, hidden }: { r: HomeReview; hidden?: boolean }) {
  const rating = Math.max(0, Math.min(5, Math.round(r.rating)));
  return (
    <div className="quote2" role="listitem" data-review-id={r.id} aria-hidden={hidden || undefined}>
      <span className="q-mark" aria-hidden="true">“</span>
      <span className="stars" role="img" aria-label={`${rating} out of 5 stars`}>{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span>
      <p>{r.text}</p>
      <div className="who">{r.name || "Customer"} — {(r.product?.title || "SINZO").slice(0, 24)}…</div>
    </div>
  );
}

export default async function HomePage() {
  try {
    return await HomeContent();
  } catch (e: any) {
    console.error("HomePage render error:", e?.message);
    return <div className="container" style={{ padding: "80px 24px", textAlign: "center" }}><h1 className="brand-wm">SINZO</h1><p style={{ color: "var(--muted)" }}>Page load korte halka somossa hocche — refresh korun.</p></div>;
  }
}

async function HomeContent() {
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  const featuredSlug = s.homepage?.featuredCollection || "new-arrivals";
  // Select only what homepage cards and the merchandising rules need — full
  // descriptions, tags and SKUs stay on the server and out of the page payload.
  const productCardSelect = {
    id: true, title: true, slug: true, price: true, comparePrice: true, stock: true, lowStock: true,
    badge: true, isNew: true, isBestSeller: true, position: true, status: true, preorder: true, saleEnds: true,
    category: { select: { name: true } },
    images: { select: { url: true }, orderBy: { position: "asc" as const }, take: 6 },
    variants: { select: { size: true, color: true, stock: true } },
  } as const;
  const colProductSelect = { product: { select: productCardSelect } } as const;
  const [featuredCol, bestSellers, reviews, activeCatalog] = await Promise.all([
    db.collection.findUnique({
      where: { slug: featuredSlug },
      include: { products: { take: 24, select: colProductSelect } },
    }),
    db.collection.findUnique({
      where: { slug: "best-sellers" },
      include: { products: { take: 8, select: colProductSelect } },
    }),
    // All published reviews, once each; featured first. Never expose pending
    // reviews or private phone fields, and never cap the animation at four.
    db.review.findMany({
      where: { status: "APPROVED" },
      select: { id: true, name: true, rating: true, text: true, product: { select: { title: true } } },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    }),
    db.product.findMany({
      where: { status: "ACTIVE" },
      select: productCardSelect,
      orderBy: [{ position: "asc" }, { id: "desc" }],
      take: 80,
    }),
  ]);
  const reviewLoop = makeReviewLoop(reviews);
  const hp = s.homepage || {};
  const bust = (() => { let h = 0; const str = JSON.stringify(hp); for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; } return Math.abs(h).toString(36); })();
  const vb = (u?: string) => (u ? (u.includes("?") ? u + "&v=" + bust : u + "?v=" + bust) : u);

  const toCards = (products: any[]) => products
    .filter((product: any) => product.status === "ACTIVE")
    .sort((a: any, b: any) => (a.position || 0) - (b.position || 0) || a.id - b.id)
    .map((product: any) => ({
      id: product.id, title: product.title, slug: product.slug, price: product.price,
      comparePrice: product.comparePrice, image: product.images?.[0]?.url,
      images: (product.images || []).map((image: any) => image.url),
      categoryName: product.category?.name,
      stock: Math.max(product.stock, (product.variants || []).reduce((sum: number, variant: any) => sum + variant.stock, 0)),
      lowStock: product.lowStock, position: product.position,
      isNew: product.isNew, isBestSeller: product.isBestSeller, badge: product.badge, preorder: !!product.preorder,
      saleEnds: product.saleEnds ? new Date(product.saleEnds).toISOString() : null,
      sizes: Array.from(new Set((product.variants || []).filter((variant: any) => (product.preorder || variant.stock > 0) && variant.size).map((variant: any) => variant.size))).sort(),
      colors: Array.from(new Set((product.variants || []).filter((variant: any) => (product.preorder || variant.stock > 0) && variant.color).map((variant: any) => variant.color))),
    }));
  const cp = (collection: any) => toCards((collection?.products || []).map((entry: any) => entry.product));
  const catalogCards = toCards(activeCatalog);
  const discountProducts = pickDiscountProducts(catalogCards, 8);
  const limitedProducts = pickLimitedProducts(catalogCards, 8).map((product) => ({ ...product, badge: product.badge || "limited" }));
  const biggestDiscount = discountProducts.reduce((max, product) => Math.max(max, discountPercent(product)), 0);

  // Existing stores may already have a saved homepage section order from before
  // these shelves existed. Append only missing new sections so the feature ships
  // without rearranging the merchant's established layout.
  const savedSections: { id: string; enabled: boolean }[] =
    Array.isArray(s.homeSections) && s.homeSections.length ? s.homeSections : DEFAULT_SECTIONS;
  const sectionCfg = [
    ...savedSections,
    ...MERCH_SECTION_IDS.filter((id) => !savedSections.some((section) => section.id === id)).map((id) => ({ id, enabled: true })),
  ];

  const values = ["Cash on Delivery", "Delivery in 24–72h", "7-Day Easy Returns", "100% Authentic"];

  const sections: Record<string, React.ReactNode> = {
    hero: (
      <section className="hero" key="hero">
        {hp.heroImage && (
          <>
            {/* LCP element: hand the URL to the preload scanner instead of waiting for the client
                component to render. Next hoists this <link> out of the body into <head>. */}
            <link
              rel="preload"
              as="image"
              fetchPriority="high"
              href={imgSrc(vb(hp.heroImage), 1200)}
              imageSrcSet={[600, 1000].map((n) => `${imgSrc(vb(hp.heroImage), n)} ${n}w`).join(", ")}
              imageSizes="100vw"
            />
            <div className="hero-media">
              {/* The <img> keeps its kenburns entrance; this wrapper carries the scroll-driven
                  parallax, so the two animations never fight over one element. */}
              <SmartImg className="hero-img" priority src={vb(hp.heroImage)} alt={cfg.store?.name || "Hero"} sizes="100vw" widths={[600, 1000]} />
            </div>
          </>
        )}
        {hp.heroImage && (
          <div className="hero-cue" aria-hidden><i /><span>Scroll</span></div>
        )}
        <div className="hero-overlay">
          <div className="hero-content">
            <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <i style={{ display: "inline-block", width: 26, height: 1, background: "var(--text)" }} />
              {cfg.store?.tagline || "New Season"}
            </div>
            <h1>{hp.heroTitle}</h1>
            <p>{hp.heroSubtitle}</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {/* the two highest-intent clicks on the site, above the fold: warm them right away */}
              <Link className="btn" href="/products" prefetch>{hp.heroCta || "Shop Now"}</Link>
              <Link className="btn btn-ghost" href="/track" prefetch>Track Order</Link>
            </div>
          </div>
        </div>
      </section>
    ),
    values: (
      <div className="values" key="values">
        <div className="container values-inner2">
          {values.map((v, i) => <span key={v} className="reveal" style={{ "--rd": i } as CSSProperties}>{v}</span>)}
        </div>
      </div>
    ),
    featured: (
      <section className="section container" key="featured">
        <Head no="01" eyebrow="Created for you" title={featuredCol?.title || "New Arrivals"} href={"/collections/" + featuredSlug} />
        <Carousel className="mobile-only">
          {Array.from({ length: Math.max(1, Math.ceil(cp(featuredCol).length / 4)) }, (_, i) => (
            <div className="grid grid-4" key={"fp" + i}>{cp(featuredCol).slice(i * 4, i * 4 + 4).map((p: any, idx) => <ProductCard key={p.id} p={p} rd={(i * 4 + idx) % 4} />)}</div>
          ))}
        </Carousel>
        <div className="desktop-only">
          <div className="grid grid-4">
            {cp(featuredCol).map((p: any, idx) => <ProductCard key={p.id} p={p} rd={idx % 4} />)}
          </div>
        </div>
      </section>
    ),
    categories: (
      <section className="section container" style={{ paddingTop: 0 }} key="categories">
        <Head no="02" eyebrow="Browse" title="Shop by Category" href="/products" />
        {/* SOB category dekhabe: mobile-e swipeable carousel (3 per page), desktop-e full grid */}
        <Carousel className="mobile-only">
          {Array.from({ length: Math.ceil(cats.length / 4) }, (_, i) => (
            <div className="cat-row-4" key={"cp" + i}>{cats.slice(i * 4, i * 4 + 4).map((c, idx) => <CatTile key={c.id} c={c} rd={(i * 4 + idx) % 4} />)}</div>
          ))}
        </Carousel>
        <div className="desktop-only">
          <div className="cat-grid-desktop">
            {cats.map((c, idx) => <CatTile key={c.id} c={c} rd={idx % 4} />)}
          </div>
        </div>
      </section>
    ),
    discounts: discountProducts.length ? (
      <section className="section merch-section merch-sale" key="discounts">
        <div className="container">
          <Head no="03" eyebrow="Selected reductions" title="The Discount Edit" href="/products?onsale=1" />
          <div className="merch-context" aria-label="Discount collection summary">
            <span>Live catalogue offers · prices applied automatically</span>
            <strong>Up to {biggestDiscount}% off</strong>
          </div>
          <ProductShelf products={discountProducts} />
        </div>
      </section>
    ) : null,
    promo: hp.promoTitle ? (
      <section className="section container" style={{ paddingTop: 0 }} key="promo">
        <div className="promo-split reveal">
          <div className="ps-img">
            {hp.promoImage && <SmartImg src={vb(hp.promoImage)} alt={hp.promoTitle} sizes="(max-width: 899px) 92vw, 46vw" widths={[600, 1000]} />}
          </div>
          <div className="ps-body">
            <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <i style={{ display: "inline-block", width: 26, height: 1, background: "var(--accent)" }} />
              Limited time
            </div>
            <h3>{hp.promoTitle}</h3>
            <p>{hp.promoText}</p>
            <Link className="btn" href="/products" style={{ alignSelf: "flex-start" }}>Shop the edit</Link>
          </div>
        </div>
      </section>
    ) : null,
    bestsellers: (
      <section className="section container" style={{ paddingTop: 0 }} key="bestsellers">
        <Head no="04" eyebrow="Loved by hundreds" title="Best Sellers" href="/collections/best-sellers" />
        <ProductShelf products={cp(bestSellers).slice(0, 8)} />
      </section>
    ),
    limited: limitedProducts.length ? (
      <section className="section container merch-section merch-limited" style={{ paddingTop: 0 }} key="limited">
        <Head no="05" eyebrow="Small quantities" title="Limited Availability" href="/products?avail=1" />
        <div className="merch-context">
          <span>Based on current live inventory</span>
          <strong>Fewest pieces first</strong>
        </div>
        <ProductShelf products={limitedProducts} />
      </section>
    ) : null,
    testimonials: reviews.length > 0 ? (
      <section className="section container testimonials" id="customer-reviews" style={{ paddingTop: 0 }} key="testimonials">
        <Head no="06" eyebrow="Reviews" title="What customers say" />
        {/* Same seamless, continuous band on phones, tablets and desktop.
            Clone cards are decorative: assistive technology reads each real
            review once. Reduced-motion visitors get a manually scrollable list. */}
        <div className="qmarquee" role="region" aria-label="Customer reviews" tabIndex={0}>
          <div className="qmarquee-track" role="list" style={{ animationDuration: `${reviewLoop.length * 11}s` }}>
            {[...reviewLoop, ...reviewLoop].map((r, i) => <Quote key={`qm-${i}-${r.id}`} r={r} hidden={i >= reviews.length} />)}
          </div>
        </div>
      </section>
    ) : null,
  };

  return (
    <CartProvider>
      <Announcement text={hp.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />

      {sectionCfg.filter((x) => x.enabled).map((x) => (
        <Fragment key={x.id}>{sections[x.id] ? <SafeSection id={x.id}>{sections[x.id]}</SafeSection> : null}</Fragment>
      ))}

      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </CartProvider>
  );
}
