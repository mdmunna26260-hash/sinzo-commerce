import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { slugify } from "@/lib/slug";
export const dynamic = "force-dynamic";

const MAX_TITLE = 200;
const MAX_EXCERPT = 300;
const MAX_CONTENT = 200_000;

function imageValue(raw: unknown): { value: string | null; error?: string } {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  const s = String(raw).trim();
  if (!s) return { value: null };
  if (s.length > 2048 || /[\u0000-\u001f\u007f]/.test(s)) return { value: null, error: "Invalid image URL" };
  return { value: s };
}

export async function GET(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  return NextResponse.json({ posts: await db.blogPost.findMany({ orderBy: { createdAt: "desc" } }) });
}

export async function POST(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const content = typeof b.content === "string" ? b.content : "";
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });
  if (!content.trim()) return NextResponse.json({ error: "Content required" }, { status: 400 });
  if (title.length > MAX_TITLE) return NextResponse.json({ error: `Title is too long (max ${MAX_TITLE})` }, { status: 400 });
  if (content.length > MAX_CONTENT) return NextResponse.json({ error: "Content is too long" }, { status: 400 });
  const excerpt = b.excerpt ? String(b.excerpt).trim().slice(0, MAX_EXCERPT) : null;
  const image = imageValue(b.image);
  if (image.error) return NextResponse.json({ error: image.error }, { status: 400 });

  try {
    // BlogPost.slug is @unique. The old code let a duplicate title surface as a 500.
    const base = slugify(b.slug || title) || `post-${Date.now().toString(36)}`;
    let slug = base;
    if (await db.blogPost.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${base}-${Date.now().toString(36)}`.slice(0, 120);
    }
    const post = await db.blogPost.create({
      data: { title, slug, excerpt, content, image: image.value, published: b.published === true },
    });
    return NextResponse.json({ ok: true, post });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "A post with that slug already exists" }, { status: 409 });
    console.error("blog post create failed", e?.code || e?.name);
    return NextResponse.json({ error: "Could not create the post" }, { status: 500 });
  }
}
