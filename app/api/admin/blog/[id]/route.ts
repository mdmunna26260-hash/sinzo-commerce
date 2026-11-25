import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const MAX_TITLE = 200;
const MAX_EXCERPT = 300;
const MAX_CONTENT = 200_000;

/* Blog post edit / publish / delete. The list + create endpoint lives in ../route.ts; these are
   the two operations a writer needs after the first save: fix a typo, and take it live. */
export async function GET(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const post = await db.blogPost.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post });
}

export async function PUT(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* Validate every incoming field BEFORE touching the database. The old code checked
     title/content only after building the update payload, so an empty title still ran
     a slug lookup, and any Prisma error was returned raw to the browser. */
  const data: Record<string, unknown> = {};
  if (b.title !== undefined) {
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });
    if (title.length > MAX_TITLE) return NextResponse.json({ error: "Title is too long" }, { status: 400 });
    data.title = title;
  }
  if (b.excerpt !== undefined) data.excerpt = b.excerpt ? String(b.excerpt).slice(0, MAX_EXCERPT) : null;
  if (b.content !== undefined) {
    if (typeof b.content !== "string" || !b.content.trim()) return NextResponse.json({ error: "Content required" }, { status: 400 });
    if (b.content.length > MAX_CONTENT) return NextResponse.json({ error: "Content is too long" }, { status: 400 });
    data.content = b.content;
  }
  if (b.image !== undefined) {
    const image = b.image === null || b.image === "" ? null : String(b.image).trim();
    if (image && (image.length > 2048 || /[\u0000-\u001f\u007f]/.test(image))) return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
    data.image = image;
  }
  if (b.published !== undefined) data.published = b.published === true;

  const before = await db.blogPost.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (b.slug !== undefined || data.title !== undefined) {
    const want = slugify(b.slug || (data.title as string) || before.title);
    if (want && want !== before.slug) {
      // a live URL that 404s is worse than a slightly ugly slug, so never collide
      const clash = await db.blogPost.findFirst({ where: { slug: want, id: { not: id } } });
      data.slug = clash ? `${want}-${Date.now().toString(36)}`.slice(0, 120) : want;
    }
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true, post: before });

  try {
    const post = await db.blogPost.update({ where: { id }, data });
    if (data.published !== undefined && data.published !== before.published) {
      await logAudit(g.user.email, data.published ? "BLOG_PUBLISH" : "BLOG_UNPUBLISH", `${post.title} (/blog/${post.slug})`);
    } else {
      await logAudit(g.user.email, "BLOG_EDIT", `${post.title}${data.slug ? ` (slug → /blog/${data.slug})` : ""}`);
    }
    return NextResponse.json({ ok: true, post });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "A post with that slug already exists" }, { status: 409 });
    // never echo Prisma/driver messages to the client
    console.error("blog post update failed", e?.code || e?.name);
    return NextResponse.json({ error: "Could not update the post" }, { status: 500 });
  }
}

export async function DELETE(req: Request, props: Ctx) {
  const params = await props.params;
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const post = await db.blogPost.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await db.blogPost.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Could not delete the post" }, { status: 500 });
  }
  await logAudit(g.user.email, "BLOG_DELETE", post.title);
  return NextResponse.json({ ok: true });
}
