import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });
  for (let i = 0; i < ids.length; i++) {
    await db.product.update({ where: { id: Number(ids[i]) }, data: { position: i + 1 } }).catch(() => {});
  }
  await logAudit(g.user.email, "PRODUCTS_REORDERED", `${ids.length} products reordered`);
  return NextResponse.json({ ok: true });
}
