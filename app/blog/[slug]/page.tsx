import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { getSessionUser } from "@/lib/auth";
import { Header, Footer } from "@/components/chrome";
import { imgSrc, imgSrcSet } from "@/components/img-src";
import { blocks, readingMinutes, dateLabel } from "@/lib/blog";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

const siteBase = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com").replace(/\/$/, "");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await db.blogPost.findUnique({ where: { slug: params.slug } });
  if (!p) return { title: "Story not found" };
  /* A draft's title/excerpt must not leak into <title> or a share preview for anyone but the
     writer previewing it — otherwise an unpublished URL still tells the world what is coming. */
  if (!p.published) {
    const me = await getSessionUser().catch(() => null);
    if (!me) return { title: "Story not found", robots: { index: false, follow: false } };
  }
  const url = `${siteBase()}/blog/${p.slug}`;
  const desc = p.excerpt || blocks(p.content)[0]?.text.slice(0, 155) || "";
  return {
    /* a draft is reachable by URL for the admin's own preview but must never be indexed */
    title: p.title,
    description: desc,
    alternates: { canonical: `/blog/${p.slug}` },
    ...(p.published ? {} : { robots: { index: false, follow: false } }),
    openGraph: {
      type: "article",
      url,
      title: p.title,
      description: desc,
      publishedTime: p.createdAt.toISOString(),
      modifiedTime: p.updatedAt.toISOString(),
      ...(p.image ? { images: [imgSrc(p.image, 1200) || p.image] } : {}),
    },
  };
}

export default async function BlogPostPage({ params, searchParams }: Props & { searchParams: { preview?: string } }) {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const store: any = cfg.store || {};
  const cats = await getCategories();
  const p = await db.blogPost.findUnique({ where: { slug: params.slug } });
  if (!p) notFound();
  if (!p.published) {
    // drafts are the writer's business only — everyone else gets the 404 they'd expect
    const me = await getSessionUser().catch(() => null);
    if (!me) notFound();
  }

  const body = blocks(p.content);
  const more = await db.blogPost.findMany({
    where: { published: true, id: { not: p.id } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, title: true, slug: true, image: true, excerpt: true, content: true, createdAt: true },
  });

  const articleLd = p.published ? {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${siteBase()}/blog/${p.slug}#article`,
        headline: p.title,
        description: p.excerpt || body[0]?.text.slice(0, 200) || undefined,
        datePublished: p.createdAt.toISOString(),
        dateModified: p.updatedAt.toISOString(),
        mainEntityOfPage: { "@type": "WebPage", "@id": `${siteBase()}/blog/${p.slug}` },
        inLanguage: "en",
        ...(p.image ? { image: [siteBase() + (imgSrc(p.image, 1200) || p.image)] } : {}),
        author: { "@type": "Organization", name: store.name || "Store", url: siteBase() + "/" },
        publisher: { "@id": siteBase() + "/#organization" },
      },
    ],
  } : null;

  return (
    <>
      <Header storeName={store.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      {articleLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />}
      <main className="container blog-wrap">
        <nav className="blog-crumbs">
          <Link href="/blog">Journal</Link> <span aria-hidden>·</span> <span>{p.title}</span>
        </nav>

        <article className="blog-post">
          {!p.published && <div className="blog-draft">Draft — not visible to visitors and not indexed.</div>}
          <div className="blog-meta">
            {dateLabel(p.createdAt)} · {readingMinutes(p.content)} min read
          </div>
          <h1>{p.title}</h1>
          {p.excerpt && <p className="blog-standfirst">{p.excerpt}</p>}
          {p.image && (
            <figure className="blog-hero">
              <img
                src={imgSrc(p.image, 1200) || p.image}
                srcSet={imgSrcSet(p.image, [400, 600, 800, 1200])}
                sizes="(max-width: 900px) 94vw, 860px"
                alt={p.title}
              />
            </figure>
          )}
          <div className="blog-body">
            {body.map((b, i) => (b.type === "h2" ? <h2 key={i}>{b.text}</h2> : <p key={i}>{b.text}</p>))}
          </div>
          <div className="blog-cta">
            <div>
              <b>Still not sure which one?</b>
              <div>Tell us your size on WhatsApp — we&apos;ll tell you what fits.</div>
            </div>
            <Link className="btn btn-accent" href="/products">Shop the collection</Link>
          </div>
        </article>

        {more.length > 0 && (
          <section className="blog-more-sec">
            <h2>More from the journal</h2>
            <div className="blog-grid">
              {more.map((m) => (
                <Link className="blog-card" key={m.id} href={`/blog/${m.slug}`}>
                  {m.image && (
                    <div className="blog-card-img">
                      <img
                        src={imgSrc(m.image, 400) || m.image}
                        srcSet={imgSrcSet(m.image, [200, 300, 400, 600])}
                        sizes="(max-width: 700px) 92vw, 300px"
                        alt={m.title}
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="blog-meta">{dateLabel(m.createdAt)}</div>
                  <h3>{m.title}</h3>
                  <p>{m.excerpt || blocks(m.content)[0]?.text || ""}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
