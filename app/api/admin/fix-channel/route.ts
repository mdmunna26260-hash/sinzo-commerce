import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";

/* TEMPORARY maintenance route (removed right after use).
   Re-tag orders placed from the Vercel site that were created before the
   channel system existed. SUPER_ADMIN only. */
export async function POST(req: Request) {
  const g = await requirePerm("users", req);
  if ("res" in g) return g.res;
  if (g.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const code = String(b.code || "").trim();
  const channel = b.channel === "vercel" || b.channel === "vps" ? b.channel : null;
  if (!code || !channel) return NextResponse.json({ error: "Send { code, channel }" }, { status: 400 });
  const updated = await db.order.updateMany({ where: { code }, data: { channel } });
  await logAudit(g.user.email, "FIX_ORDER_CHANNEL", `${code} -> ${channel}`);
  return NextResponse.json({ ok: true, updated: updated.count });
}
