import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import LinksClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign links" };

/* UTM link builder.
   "Facebook theke koto order elo?" is unanswerable unless the links are tagged. This builds
   tagged links for the pages that matter, keeps the ones already used, and shows the tag the
   site's own first-party attribution stores on every order (source/medium/campaign). */
export default async function LinksPage({ searchParams }: { searchParams: { t?: string } }) {
  const user = await requireAdmin(searchParams);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const [products, posts] = await Promise.all([
    db.product.findMany({ where: { status: "ACTIVE" }, orderBy: { views: "desc" }, take: 30, select: { title: true, slug: true } }),
    db.blogPost.findMany({ where: { published: true }, orderBy: { id: "desc" }, take: 20, select: { title: true, slug: true } }).catch(() => []),
  ]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com";
  return (
    <>
      <div className="admin-top">
        <div><h1>Campaign links</h1><div className="who">UTM builder · {user.name}</div></div>
      </div>
      <LinksClient siteUrl={siteUrl} products={products} posts={posts as any[]} />
      <div className="cfg-note" style={{ marginTop: 16 }}>
        UTM tags ride along on the URL, so whatever a customer lands on, the tag is stored on the order
        (Admin → Analytics shows orders by source/medium). Rules of thumb: <b>utm_source</b> = where the
        click came from (facebook, instagram, whatsapp, sms), <b>utm_medium</b> = how (social, cpc, email),
        <b> utm_campaign</b> = which push (eid-sale, ramadan-drop). Lowercase + hyphens keeps the reports
        tidy; never tag the same push two different ways.
      </div>
    </>
  );
}
