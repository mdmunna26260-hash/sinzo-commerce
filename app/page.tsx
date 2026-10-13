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
import HeroSlider from "@/components/home/hero-slider";
import SmartImg from "@/components/smart-img";
import SafeSection from "@/components/safe-section";
import { makeReviewLoop } from "@/lib/review-marquee";

// ISR: Cache page for 60s, then revalidate in background
// First visitor after expiry: gets cached page (fast), fresh page renders in background
export const dynamic = "force-dynamic";
// runtime caching via CDN headers keeps it fast; skip build-time DB (small VPS)

const DEFAULT_SECTIONS = [
  { id: "hero", enabled: true }, { id: "values", enabled: true }, { id: "featured", enabled: true },
  { id: "discount", enabled: true }, { id: "categories", enabled: true }, { id: "promo", enabled: true },
  { id: "bestsellers", enabled: true }, { id: "mostviewed", enabled: true },
  { id: "testimonials", enabled: true },
];

/* A store that saved a layout before these sections existed has them missing from
   s.homeSections, and an unknown id simply never renders — so the new sections would
   stay invisible with no way to switch them on except re-saving the layout. Append any
   section the saved list has not heard of, keeping the admin's order for the rest. */
function withNewSections(saved: { id: string; enabled: boolean }[]) {
  const seen = new Set(saved.map((s) => s.id));
  return [...saved, ...DEFAULT_SECTIONS.filter((d) => !seen.has(d.id))];
}

const CAT_IMG: Record<string, string> = { shirts: "shirt", outerwear: "coat", dresses: "dress", bottoms: "trousers", knitwear: "knit", accessories: "bag", "t-shirts": "tee" };

/* editorial section header: 01 — Eyebrow / Title / View All */
function Head({ no, eyebrow, title, href }: { no?: string; eyebrow: string; title: string; href?: string }) {
  return (
    <div className="section-head2">
      <div>
        <div className="sh-eyebrow">{no && <span className="sh-no">{no}</span>}{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      {href && <Link className="sh-link" href={href}>View All <span aria-hidden>→</span></Link>}
    </div>
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
  // select only what product cards need — full rows (description, tags, sku…) stay on the server
  const colProductSelect = {
    product: {
      select: {
        id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
        badge: true, isNew: true, isBestSeller: true, position: true, status: true, preorder: true,
        category: { select: { name: true } },
        images: { select: { url: true }, orderBy: { position: "asc" as const }, take: 6 },
        variants: { select: { size: true, color: true, stock: true } },
      },
    },
  } as const;
  const featuredCol = await db.collection.findUnique({
    where: { slug: featuredSlug },
    include: { products: { take: 24, select: colProductSelect } },
  });
  const bestSellers = await db.collection.findUnique({
    where: { slug: "best-sellers" },
    include: { products: { take: 8, select: colProductSelect } },
  });
  // All published reviews, once each; featured first. Never expose pending
  // reviews or private phone fields, and never cap the animation at four.
  const reviews = await db.review.findMany({
    where: { status: "APPROVED" },
    select: { id: true, name: true, rating: true, text: true, product: { select: { title: true } } },
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  const reviewLoop = makeReviewLoop(reviews);
  const hp = s.homepage || {};
  const sectionCfg: { id: string; enabled: boolean }[] =
    Array.isArray(s.homeSections) && s.homeSections.length ? withNewSections(s.homeSections) : DEFAULT_SECTIONS;

  /* ---- the two data-driven product rails ----
     Both read columns that already exist, so neither needs a migration:
     `comparePrice` (set by the admin when a product goes on sale) and `views`
     (incremented on every product-page render in app/products/[slug]/page.tsx).

     SQLite/Postgres cannot compare two columns in a Prisma `where`, so the
     discount rail filters `comparePrice != null` in the query and does the
     `> price` test plus the percentage sort in JS. The candidate set is capped
     so a large catalogue never pulls every sale product into memory. */
  const enabledIds = new Set(sectionCfg.filter((x) => x.enabled).map((x) => x.id));
  const RAIL_SIZE = 8;
  const railSelect = {
    id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
    badge: true, isNew: true, isBestSeller: true, status: true, preorder: true, views: true,
    category: { select: { name: true } },
    images: { select: { url: true }, orderBy: { position: "asc" as const }, take: 6 },
    variants: { select: { size: true, color: true, stock: true } },
  };

  const discountRaw = enabledIds.has("discount")
    ? await db.product.findMany({
        where: { status: "ACTIVE", comparePrice: { not: null } },
        select: railSelect,
        orderBy: { updatedAt: "desc" },
        take: 60,
      })
    : [];
  const discountProducts = discountRaw
    .filter((p) => (p.comparePrice ?? 0) > p.price)
    .sort((a, b) => {
      const pct = (x: typeof a) => ((x.comparePrice! - x.price) / x.comparePrice!) * 100;
      return pct(b) - pct(a);
    })
    .slice(0, RAIL_SIZE);

  const mostViewed = enabledIds.has("mostviewed")
    ? await db.product.findMany({
        where: { status: "ACTIVE", views: { gt: 0 } },
        select: railSelect,
        orderBy: [{ views: "desc" }, { id: "desc" }],
        take: RAIL_SIZE,
      })
    : [];
  const bust = (() => { let h = 0; const str = JSON.stringify(hp); for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; } return Math.abs(h).toString(36); })();
  const vb = (u?: string) => (u ? (u.includes("?") ? u + "&v=" + bust : u + "?v=" + bust) : u);

  /* Hero banners. `homepage.heroSlides` is the new multi-image field; a store that has
     never opened the new editor still has the single `homepage.heroImage`, so fall back
     to it and the hero keeps working untouched after deploy. Entries without an image
     are dropped so a half-filled row in the admin cannot render an empty slide. */
  const heroSlides: { image: string; href?: string; alt?: string }[] = (
    Array.isArray(hp.heroSlides) && hp.heroSlides.length
      ? hp.heroSlides
      : hp.heroImage
        ? [{ image: hp.heroImage, href: "/products" }]
        : []
  )
    .filter((sl: any) => sl && typeof sl.image === "string" && sl.image.trim())
    .map((sl: any) => ({
      image: vb(sl.image.trim())!,
      href: typeof sl.href === "string" && sl.href.trim() ? sl.href.trim() : undefined,
      alt: typeof sl.alt === "string" && sl.alt.trim() ? sl.alt.trim() : cfg.store?.name || "Banner",
    }));

  const cp = (col: any) =>
    (col?.products || []).filter((x: any) => x.product.status === "ACTIVE")
      .sort((a: any, b: any) => (a.product.position || 0) - (b.product.position || 0))
      .map((x: any) => ({
        id: x.product.id, title: x.product.title, slug: x.product.slug, price: x.product.price,
        comparePrice: x.product.comparePrice, image: x.product.images?.[0]?.url,
        images: (x.product.images || []).map((im: any) => im.url),
        categoryName: x.product.category?.name, stock: Math.max(x.product.stock, (x.product.variants || []).reduce((s: number, v: any) => s + v.stock, 0)),
        isNew: x.product.isNew, isBestSeller: x.product.isBestSeller, badge: x.product.badge, preorder: !!x.product.preorder,
        sizes: Array.from(new Set((x.product.variants || []).filter((v: any) => (x.product.preorder || v.stock > 0) && v.size).map((v: any) => v.size))).sort(),
        colors: Array.from(new Set((x.product.variants || []).filter((v: any) => (x.product.preorder || v.stock > 0) && v.color).map((v: any) => v.color))),
      }));

  /* same shape as cp(), for rails that query products directly instead of through a collection */
  const mp = (rows: any[]) =>
    rows.map((p: any) => ({
      id: p.id, title: p.title, slug: p.slug, price: p.price,
      comparePrice: p.comparePrice, image: p.images?.[0]?.url,
      images: (p.images || []).map((im: any) => im.url),
      categoryName: p.category?.name,
      stock: Math.max(p.stock, (p.variants || []).reduce((s: number, v: any) => s + v.stock, 0)),
      isNew: p.isNew, isBestSeller: p.isBestSeller, badge: p.badge, preorder: !!p.preorder,
      sizes: Array.from(new Set((p.variants || []).filter((v: any) => (p.preorder || v.stock > 0) && v.size).map((v: any) => v.size))).sort(),
      colors: Array.from(new Set((p.variants || []).filter((v: any) => (p.preorder || v.stock > 0) && v.color).map((v: any) => v.color))),
    }));

  /* a rail of up to 8 cards: swipeable pages of 4 on mobile, one grid on desktop */
  const Rail = ({ items, k }: { items: any[]; k: string }) => (
    <>
      <Carousel className="mobile-only">
        <div className="grid grid-4">{items.slice(0, 4).map((p: any, idx: number) => <ProductCard key={p.id} p={p} rd={idx % 4} />)}</div>
        {items.length > 4 && (
          <div className="grid grid-4">{items.slice(4, 8).map((p: any, idx: number) => <ProductCard key={p.id} p={p} rd={idx % 4} />)}</div>
        )}
      </Carousel>
      <div className="desktop-only">
        <div className="grid grid-4">
          {items.map((p: any, idx: number) => <ProductCard key={p.id} p={p} rd={idx % 4} />)}
        </div>
      </div>
    </>
  );

  const values = ["Cash on Delivery", "Delivery in 24–72h", "7-Day Easy Returns", "100% Authentic"];

  /* The "01 / 02 / 03" chapter numbers in each section heading used to be hard-coded, so they
     went out of sequence the moment anyone reordered or hid a section in Settings → Homepage
     Layout (and On Sale shipped colliding with Reviews on "04"). Derive them instead: walk the
     admin's own order and number only the headed sections that will actually render. */
  const headedIfVisible: Record<string, boolean> = {
    featured: true,
    categories: true,
    bestsellers: true,
    discount: discountProducts.length > 0,
    mostviewed: mostViewed.length > 0,
    testimonials: reviews.length > 0,
  };
  const no: Record<string, string> = {};
  let headNo = 0;
  for (const x of sectionCfg) {
    if (x.enabled && headedIfVisible[x.id]) no[x.id] = String(++headNo).padStart(2, "0");
  }

  const sections: Record<string, React.ReactNode> = {
    hero: heroSlides.length ? (
      <section className="hero hero-banner" key="hero">
        {/* LCP element: hand the FIRST slide to the preload scanner instead of waiting for the
            client component to render. Next hoists this <link> out of the body into <head>.
            Only the first one — preloading every slide would fight the LCP image for bandwidth. */}
        <link
          rel="preload"
          as="image"
          fetchPriority="high"
          href={imgSrc(heroSlides[0].image, 1200)}
          imageSrcSet={[600, 1000].map((n) => `${imgSrc(heroSlides[0].image, n)} ${n}w`).join(", ")}
          imageSizes="100vw"
        />
        {/* The banners carry no text, so the page would otherwise ship without an h1.
            Keep a real one for SEO and screen readers, visually hidden. */}
        <h1 className="sr-only">{hp.heroTitle || cfg.store?.name || "SINZO"}</h1>
        <HeroSlider slides={heroSlides} intervalMs={Number(hp.heroInterval) || 5500} label="Promotions" />
        <div className="hero-cue" aria-hidden><i /><span>Scroll</span></div>
      </section>
    ) : null,
    values: (
      <div className="values" key="values">
        <div className="container values-inner2">
          {values.map((v, i) => <span key={v} className="reveal" style={{ "--rd": i } as CSSProperties}>{v}</span>)}
        </div>
      </div>
    ),
    featured: (
      <section className="section container" key="featured">
        <Head no={no.featured} eyebrow="Created for you" title={featuredCol?.title || "New Arrivals"} href={"/collections/" + featuredSlug} />
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
        <Head no={no.categories} eyebrow="Browse" title="Shop by Category" href="/products" />
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
        <Head no={no.bestsellers} eyebrow="Loved by hundreds" title="Best Sellers" href="/collections/best-sellers" />
        <Carousel className="mobile-only">
          <div className="grid grid-4">{cp(bestSellers).slice(0, 4).map((p: any, idx) => <ProductCard key={p.id} p={p} rd={idx % 4} />)}</div>
          <div className="grid grid-4">{cp(bestSellers).slice(4, 8).map((p: any, idx) => <ProductCard key={p.id} p={p} rd={idx % 4} />)}</div>
        </Carousel>
        <div className="desktop-only">
          <div className="grid grid-4">
            {cp(bestSellers).map((p: any, idx) => <ProductCard key={p.id} p={p} rd={idx % 4} />)}
          </div>
        </div>
      </section>
    ),
    /* Both rails disappear completely when they have nothing to show, rather than
       rendering an empty header — a new store has no discounts and no view counts yet. */
    discount: discountProducts.length > 0 ? (
      <section className="section container" style={{ paddingTop: 0 }} key="discount">
        <Head no={no.discount} eyebrow="Limited time" title="On Sale" href="/products?onsale=1" />
        <Rail items={mp(discountProducts)} k="discount" />
      </section>
    ) : null,
    mostviewed: mostViewed.length > 0 ? (
      <section className="section container" style={{ paddingTop: 0 }} key="mostviewed">
        <Head no={no.mostviewed} eyebrow="Trending now" title="Most Viewed" href="/products?sort=popular" />
        <Rail items={mp(mostViewed)} k="mostviewed" />
      </section>
    ) : null,
    testimonials: reviews.length > 0 ? (
      <section className="section container testimonials" id="customer-reviews" style={{ paddingTop: 0 }} key="testimonials">
        <Head no={no.testimonials} eyebrow="Reviews" title="What customers say" />
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
