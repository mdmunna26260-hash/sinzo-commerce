import Link from "next/link";
import { Fragment } from "react";
import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { Header, Footer, Announcement } from "@/components/chrome";
import { ProductCard } from "@/components/parts";

export const dynamic = "force-dynamic";

const DEFAULT_SECTIONS = [
  { id: "hero", enabled: true }, { id: "values", enabled: true }, { id: "featured", enabled: true },
  { id: "categories", enabled: true }, { id: "promo", enabled: true }, { id: "bestsellers", enabled: true },
  { id: "testimonials", enabled: true },
];

export default async function HomePage() {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await db.category.findMany({ orderBy: { id: "asc" } });
  const featuredSlug = s.homepage?.featuredCollection || "new-arrivals";
  const featuredCol = await db.collection.findUnique({
    where: { slug: featuredSlug },
    include: { products: { take: 8, include: { product: { include: { images: true, category: true } } } } },
  });
  const bestSellers = await db.collection.findUnique({
    where: { slug: "best-sellers" },
    include: { products: { take: 4, include: { product: { include: { images: true, category: true } } } } },
  });
  const reviews = await db.review.findMany({ where: { status: "APPROVED", featured: true }, include: { product: true }, take: 3 });
  if (reviews.length < 3) {
    const extra = await db.review.findMany({ where: { status: "APPROVED" }, include: { product: true }, take: 3 - reviews.length });
    reviews.push(...extra);
  }
  const hp = s.homepage || {};
  const sectionCfg: { id: string; enabled: boolean }[] =
    Array.isArray(s.homeSections) && s.homeSections.length ? s.homeSections : DEFAULT_SECTIONS;
  const cp = (col: any) =>
    (col?.products || []).filter((x: any) => x.product.status === "ACTIVE")
      .sort((a: any, b: any) => (a.product.position || 0) - (b.product.position || 0))
      .map((x: any) => ({
      id: x.product.id, title: x.product.title, slug: x.product.slug, price: x.product.price,
      comparePrice: x.product.comparePrice, image: x.product.images?.[0]?.url,
      categoryName: x.product.category?.name, stock: x.product.stock, isNew: true,
    }));

  // each homepage section, addressable by id — rendered in the admin-configured order
  const sections: Record<string, React.ReactNode> = {
    hero: (
      <section className="hero" key="hero">
        {hp.heroImage && <img className="hero-img" src={hp.heroImage} alt={cfg.store?.name || "Hero"} fetchPriority="high" />}
        <div className="hero-overlay">
          <div className="hero-content">
            <div className="eyebrow">{cfg.store?.tagline}</div>
            <h1>{hp.heroTitle}</h1>
            <p>{hp.heroSubtitle}</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link className="btn" href="/products">{hp.heroCta || "Shop Now"}</Link>
              <Link className="btn btn-outline" href="/track" style={{ background: "rgba(250,249,247,.7)" }}>Track Order</Link>
            </div>
          </div>
        </div>
      </section>
    ),
    values: (
      <div className="values" key="values">
        <div className="container values-inner">
          <div className="value"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>Cash on Delivery</div>
          <div className="value"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 11h18M3 11l2-7h14l2 7M5 11v9h14v-9"/></svg>Delivery in 24–72h</div>
          <div className="value"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.6 4.2M3 3v5h5"/></svg>7-Day Easy Returns</div>
          <div className="value"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>100% Authentic</div>
        </div>
      </div>
    ),
    featured: (
      <section className="section container" key="featured">
        <div className="section-head">
          <div>
            <div className="eyebrow">{featuredCol?.subtitle || "Curated for you"}</div>
            <h2>{featuredCol?.title || "New Arrivals"}</h2>
          </div>
          <Link className="link-underline" href={"/collections/" + featuredSlug}>View all</Link>
        </div>
        <div className="grid grid-4">
          {cp(featuredCol).map((p: any) => <ProductCard key={p.id} p={p} />)}
        </div>
      </section>
    ),
    categories: (
      <section className="section container" style={{ paddingTop: 0 }} key="categories">
        <div className="section-head"><div><div className="eyebrow">Browse</div><h2>Shop by Category</h2></div></div>
        <div className="grid grid-3">
          {cats.slice(0, 3).map((c) => (
            <Link key={c.id} className="ctile reveal" href={"/products?category=" + c.slug}>
              {c.image ? <img src={c.image} alt={c.name} loading="lazy" /> : (
                <img src={"/uploads/seed/p-" + ({shirts:"shirt",outerwear:"coat",dresses:"dress",bottoms:"trousers",knitwear:"knit",accessories:"bag","t-shirts":"tee"} as any)[c.slug] + ".jpg"} alt={c.name} loading="lazy" />
              )}
              <div className="ctile-label"><span>{c.description?.slice(0, 40) || "Collection"}</span><h3>{c.name}</h3></div>
            </Link>
          ))}
        </div>
      </section>
    ),
    promo: hp.promoTitle ? (
      <section className="promo container" style={{ marginBottom: 72 }} key="promo">
        {hp.promoImage && <img src={hp.promoImage} alt={hp.promoTitle} loading="lazy" />}
        <div className="promo-box">
          <div className="promo-inner">
            <div className="eyebrow">Limited time</div>
            <h3>{hp.promoTitle}</h3>
            <p>{hp.promoText}</p>
            <Link className="btn" href="/products">Shop the edit</Link>
          </div>
        </div>
      </section>
    ) : null,
    bestsellers: (
      <section className="section container" style={{ paddingTop: 0 }} key="bestsellers">
        <div className="section-head">
          <div><div className="eyebrow">Loved by hundreds</div><h2>Best Sellers</h2></div>
          <Link className="link-underline" href="/collections/best-sellers">View all</Link>
        </div>
        <div className="grid grid-4">
          {cp(bestSellers).map((p: any) => <ProductCard key={p.id} p={p} />)}
        </div>
      </section>
    ),
    testimonials: reviews.length > 0 ? (
      <section className="section container" style={{ paddingTop: 0 }} key="testimonials">
        <div className="section-head"><div><div className="eyebrow">Reviews</div><h2>What customers say</h2></div></div>
        <div className="grid grid-3">
          {reviews.map((r) => (
            <div className="quote" key={r.id}>
              <span className="stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
              <p>“{r.text}”</p>
              <div className="who">{r.name} · {r.product.title.slice(0, 24)}…</div>
            </div>
          ))}
        </div>
      </section>
    ) : null,
  };

  return (
    <>
      <Announcement text={hp.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />

      {sectionCfg.filter((x) => x.enabled).map((x) => (
        <Fragment key={x.id}>{sections[x.id] || null}</Fragment>
      ))}

      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
