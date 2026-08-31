import Link from "next/link";
import { Fragment } from "react";
import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";
import { imgSrc } from "@/components/img-src";
import { CartProvider } from "@/components/store";
import Carousel from "@/components/home/carousel";
import SmartImg from "@/components/smart-img";

// ISR: Cache page for 60s, then revalidate in background
// First visitor after expiry: gets cached page (fast), fresh page renders in background
export const revalidate = 60;

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

function CatTile({ c }: { c: any }) {
  const tileSrc = c.image
    ? (c.image.includes("/uploads/seed/") ? c.image.replace(/\.jpg$/, "-600.webp") : (c.image.match(/^\/api\/media\/([a-z0-9]+)$/i) ? c.image + "/w600" : c.image))
    : "/uploads/seed/p-" + (CAT_IMG[c.slug] || "shirt") + "-600.webp";
  return (
    <Link className="ctile" href={"/products?category=" + c.slug}>
      <img src={tileSrc} alt={c.name} loading="lazy" decoding="async" />
      <div className="ctile-label"><span>{c.description?.slice(0, 40) || "Collection"}</span><h3>{c.name}</h3></div>
      <span className="ctile-arrow" aria-hidden>→</span>
    </Link>
  );
}

function Quote({ r }: { r: any }) {
  return (
    <div className="quote2">
      <span className="q-mark" aria-hidden>“</span>
      <span className="stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
      <p>{r.text}</p>
      <div className="who">{r.name} — {r.product.title.slice(0, 24)}…</div>
    </div>
  );
}

export default async function HomePage() {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  const featuredSlug = s.homepage?.featuredCollection || "new-arrivals";
  // select only what product cards need — full rows (description, tags, sku…) stay on the server
  const colProductSelect = {
    product: {
      select: {
        id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
        badge: true, isNew: true, isBestSeller: true, position: true, status: true,
        category: { select: { name: true } },
        images: { select: { url: true }, orderBy: { position: "asc" as const }, take: 1 },
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
        categoryName: x.product.category?.name, stock: Math.max(x.product.stock, (x.product.variants || []).reduce((s: number, v: any) => s + v.stock, 0)),
        isNew: x.product.isNew, isBestSeller: x.product.isBestSeller, badge: x.product.badge,
        sizes: Array.from(new Set((x.product.variants || []).filter((v: any) => v.stock > 0 && v.size).map((v: any) => v.size))).sort(),
        colors: Array.from(new Set((x.product.variants || []).filter((v: any) => v.stock > 0 && v.color).map((v: any) => v.color))),
      }));

  const values = ["Cash on Delivery", "Delivery in 24–72h", "7-Day Easy Returns", "100% Authentic"];

  const sections: Record<string, React.ReactNode> = {
    hero: (
      <section className="hero" key="hero">
        {hp.heroImage && <SmartImg className="hero-img" priority src={vb(hp.heroImage)} alt={cfg.store?.name || "Hero"} />}
        <div className="hero-overlay">
          <div className="hero-content">
            <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <i style={{ display: "inline-block", width: 26, height: 1, background: "var(--text)" }} />
              {cfg.store?.tagline || "New Season"}
            </div>
            <h1>{hp.heroTitle}</h1>
            <p>{hp.heroSubtitle}</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link className="btn" href="/products">{hp.heroCta || "Shop Now"}</Link>
              <Link className="btn btn-ghost" href="/track">Track Order</Link>
            </div>
          </div>
        </div>
      </section>
    ),
    values: (
      <div className="values" key="values">
        <div className="container values-inner2">
          {values.map((v) => <span key={v}>{v}</span>)}
        </div>
      </div>
    ),
    featured: (
      <section className="section container" key="featured">
        <Head no="01" eyebrow="Created for you" title={featuredCol?.title || "New Arrivals"} href={"/collections/" + featuredSlug} />
        <Carousel className="mobile-only">
          {Array.from({ length: Math.max(1, Math.ceil(cp(featuredCol).length / 4)) }, (_, i) => (
            <div className="grid grid-4" key={"fp" + i}>{cp(featuredCol).slice(i * 4, i * 4 + 4).map((p: any) => <ProductCard key={p.id} p={p} />)}</div>
          ))}
        </Carousel>
        <div className="desktop-only">
          <div className="grid grid-4">
            {cp(featuredCol).map((p: any) => <ProductCard key={p.id} p={p} />)}
          </div>
        </div>
      </section>
    ),
    categories: (
      <section className="section container" style={{ paddingTop: 0 }} key="categories">
        <Head no="02" eyebrow="Browse" title="Shop by Category" href="/products" />
        {/* SOB category dekhabe: mobile-e swipeable carousel (3 per page), desktop-e full grid */}
        <Carousel className="mobile-only">
          {Array.from({ length: Math.ceil(cats.length / 3) }, (_, i) => (
            <div className="grid grid-3" key={"cp" + i}>{cats.slice(i * 3, i * 3 + 3).map((c) => <CatTile key={c.id} c={c} />)}</div>
          ))}
        </Carousel>
        <div className="desktop-only">
          <div className="cat-grid-desktop">
            {cats.map((c) => <CatTile key={c.id} c={c} />)}
          </div>
        </div>
      </section>
    ),
    promo: hp.promoTitle ? (
      <section className="container" style={{ marginBottom: 80 }} key="promo">
        <div className="promo-split reveal">
          <div className="ps-img">
            {hp.promoImage && <SmartImg src={vb(hp.promoImage)} alt={hp.promoTitle} />}
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
          <div className="grid grid-4">{cp(bestSellers).slice(0, 4).map((p: any) => <ProductCard key={p.id} p={p} />)}</div>
          <div className="grid grid-4">{cp(bestSellers).slice(4, 8).map((p: any) => <ProductCard key={p.id} p={p} />)}</div>
        </Carousel>
        <div className="desktop-only">
          <div className="grid grid-4">
            {cp(bestSellers).map((p: any) => <ProductCard key={p.id} p={p} />)}
          </div>
        </div>
      </section>
    ),
    testimonials: reviews.length > 0 ? (
      <section className="section container" style={{ paddingTop: 0, paddingBottom: 90 }} key="testimonials">
        <Head no="04" eyebrow="Reviews" title="What customers say" />
        <Carousel className="mobile-only">
          <div className="grid grid-2q">{reviews.slice(0, 2).map((r) => <Quote key={r.id} r={r} />)}</div>
          <div className="grid grid-2q">{reviews.slice(2, 4).map((r) => <Quote key={r.id} r={r} />)}</div>
        </Carousel>
        <div className="desktop-only">
          <div className="grid grid-3">
            {reviews.map((r) => <Quote key={r.id} r={r} />)}
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
        <Fragment key={x.id}>{sections[x.id] || null}</Fragment>
      ))}

      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </CartProvider>
  );
}
