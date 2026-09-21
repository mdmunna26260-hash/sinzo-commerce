import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import BlogEditor, { type Post } from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog" };

type SP = { t?: string };

/* Blog CMS.
   The BlogPost model, its API and the site have existed for a while — the API was never wired to
   a screen and no public /blog route read it, so nothing that got saved could ever be seen. This
   is the screen; /blog and /blog/<slug> are the pages. */
export default async function BlogAdminPage({ searchParams }: { searchParams: SP }) {
  const user = await requireAdmin(searchParams);
  const t = searchParams.t || "";
  const tk = (p: string) => (t ? p + (p.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t) : p);

  const posts = await db.blogPost.findMany({ orderBy: [{ published: "asc" }, { updatedAt: "desc" }] });
  const rows: Post[] = posts.map((p) => ({
    id: p.id, title: p.title, slug: p.slug, excerpt: p.excerpt, content: p.content,
    image: p.image, published: p.published,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  }));
  const live = posts.filter((p) => p.published).length;

  return (
    <>
      <div className="admin-top">
        <div>
          <h1>Blog</h1>
          <div className="who">{live} published · {posts.length - live} draft{posts.length - live === 1 ? "" : "s"} · {user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="abtn" href={tk("/admin/marketing")}>Marketing</Link>
          <a className="abtn" href="/blog" target="_blank" rel="noreferrer">Open /blog ↗</a>
        </div>
      </div>

      {posts.length > 0 && live === 0 && (
        <div className="cfg-note" style={{ marginBottom: 16 }}>
          Every post is still a draft, so /blog shows the empty state to visitors. Press <b>Publish</b> on one and it
          goes live immediately.
        </div>
      )}

      <BlogEditor posts={rows} />
    </>
  );
}
