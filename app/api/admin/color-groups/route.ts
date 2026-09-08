import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";

/* Color groups: product families whose colors link to each other on the PDP.
   SUPER_ADMIN/ADMIN manage via requirePerm("products"). */

export async function GET(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  const groups = await db.colorGroup.findMany({
    where: q ? { name: { contains: q } } : undefined,
    orderBy: { id: "desc" },
    take: 50,
    include: {
      products: {
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, title: true, slug: true, colorName: true, colorImage: true, status: true },
        orderBy: { id: "asc" },
      },
    },
  });
  return NextResponse.json({ groups });
}

export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || "").trim().slice(0, 120);
  if (name.length < 2) return NextResponse.json({ error: "Group name din (minimum 2 character)" }, { status: 400 });
  const exists = await db.colorGroup.findUnique({ where: { name } });
  if (exists) return NextResponse.json({ ok: true, group: exists, existed: true });
  const group = await db.colorGroup.create({ data: { name } });
  await logAudit(g.user.email, "COLOR_GROUP_CREATED", name);
  return NextResponse.json({ ok: true, group });
}
