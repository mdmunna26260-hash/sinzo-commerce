import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ posts: await db.blogPost.findMany({ orderBy: { createdAt: "desc" } }) });
}
export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const b = await req.json();
  if (!b.title || !b.content) return NextResponse.json({ error: "Title and content required" }, { status: 400 });
  const post = await db.blogPost.create({ data: { title: b.title, slug: slugify(b.slug || b.title), excerpt: b.excerpt || null, content: b.content, image: b.image || null, published: !!b.published } });
  return NextResponse.json({ ok: true, post });
}
