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

// ISR: Cache page for 60s, then revalidate in background
// First visitor after expiry: gets cached page (fast), fresh page renders in background
export const dynamic = "force-dynamic";
// runtime caching via CDN headers keeps it fast; skip build-time DB (small VPS)

const DEFAULT_SECTIONS = [
  { id: "hero", enabled: true }, { id: "values", enabled: true }, { id: "featured", enabled: true },
  { id: "categories", enabled: true }, { id: "promo", enabled: true }, { id: "bestsellers", enabled: true },
  { id: "testimonials", enabled: true },
];

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

function Quote({ r, rd, plain }: { r: any; rd?: number; plain?: boolean }) {
  return (
    <div className={"quote2" + (plain ? "" : " reveal")} style={!plain && rd != null ? ({ "--rd": rd } as CSSProperties) : undefined}>
      <span className="q-mark" aria-hidden>“</span>
      <span className="stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
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
  const reviews = await db.review.findMany({ where: { status: "APPROVED", featured: true }, include: { product: { select: { title: true } } }, take: 4 });
  if (reviews.length < 4) {
    const extra = await db.review.findMany({ where: { status: "APPROVED" }, include: { product: { select: { title: true } } }, take: 4 - reviews.length });
    reviews.push(...extra);
  }
  const hp = s.homepage || {};
  const sectionCfg: { id: string; enabled: boolean }[] =
    Array.isArray(s.homeSections) && s.homeSections.length ? s.homeSections : DEFAULT_SECTIONS;
  const bust = (() => { let h = 0; const str = JSON.stringify(hp); for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; } return Math.abs(h).toString(36); })();
  const vb = (u?: string) => (u ? (u.includes("?") ? u + "&v=" + bust : u + "?v=" + bust) : u);

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
        <Head no="03" eyebrow="Loved by hundreds" title="Best Sellers" href="/collections/best-sellers" />
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
    testimonials: reviews.length > 0 ? (
      <section className="section container" style={{ paddingTop: 0 }} key="testimonials">
        <Head no="04" eyebrow="Reviews" title="What customers say" />
        <Carousel className="mobile-only">
          <div className="grid grid-2q">{reviews.slice(0, 2).map((r, idx) => <Quote key={r.id} r={r} rd={idx % 2} />)}</div>
          <div className="grid grid-2q">{reviews.slice(2, 4).map((r, idx) => <Quote key={r.id} r={r} rd={idx % 2} />)}</div>
        </Carousel>
        {/* Desktop marquee: 4+ reviews thakle ekta seamless band — ek set er por hubohu
            second copy, tai -50% translate korle loop dekha jay na. Duration content er
            sathe scale kore (per-review ~11s), nohoile kom review e charto cholto.
            Kom review hole marquee ta meaningless — tokhon grid e fallback. */}
        {reviews.length >= 4 && (
          <div className="qmarquee">
            <div className="qmarquee-track" style={{ animationDuration: `${reviews.length * 11}s` }}>
              {[...reviews, ...reviews].map((r, i) => <Quote key={"qm" + i} r={r} plain />)}
            </div>
          </div>
        )}
        <div className={reviews.length >= 4 ? "desktop-only qgrid-fallback" : "desktop-only"}>
          <div className="grid grid-3">
            {reviews.map((r, idx) => <Quote key={r.id} r={r} rd={idx % 3} />)}
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
