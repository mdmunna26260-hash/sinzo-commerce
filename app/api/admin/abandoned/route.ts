import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
/* DELETE ?olderThanDays=N — purge OPEN checkouts older than N days (2 weeks default). */
export async function DELETE(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const days = Number(new URL(req.url).searchParams.get("olderThanDays") || 14);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return NextResponse.json({ error: "Use a whole number of days between 1 and 3650" }, { status: 400 });
  const cutoff = new Date(Date.now() - days * 86400000);
  const res = await db.abandonedCheckout.deleteMany({ where: { checkoutStatus: "OPEN", updatedAt: { lt: cutoff } } });
  await logAudit(g.user.email, "ABANDONED_PURGE", `${res.count} rows older than ${days}d`);
  return NextResponse.json({ ok: true, deleted: res.count });
}
