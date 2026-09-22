import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import { notifyWaitlistEntry, notifyWaitlistForProduct, markNotified, type WaitlistEntry } from "@/lib/waitlist";
export const dynamic = "force-dynamic";

/* Waitlist actions: tell one person, tell everyone waiting for a product, or clean up.
   Each notify reports which channel was used, and when no channel exists it returns the
   wa.me / mailto link so the owner can still send it by hand. */
export async function GET(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const productId = Number(new URL(req.url).searchParams.get("product") || 0);
  const rows = await db.waitlist.findMany({
    where: productId ? { productId } : {},
    orderBy: { id: "desc" }, take: 300,
    include: { product: { select: { title: true, slug: true, stock: true } } },
  });
  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await req.json().catch(() => ({}));
  const s = envFallback(await getSettings());
  const action = String(b.action || "notify");

  if (action === "delete") {
    const id = Number(b.id);
    const row = await db.waitlist.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    await db.waitlist.delete({ where: { id } });
    await logAudit(g.user.email, "WAITLIST_DELETE", `#${id} (${row.contact})`);
    return NextResponse.json({ ok: true });
  }

  if (action === "mark") {
    await markNotified(Number(b.id));
    return NextResponse.json({ ok: true, channel: "manual" });
  }

  if (action === "notify_product") {
    const productId = Number(b.productId);
    if (!productId) return NextResponse.json({ error: "productId required" }, { status: 400 });
    const r = await notifyWaitlistForProduct(productId, s, 50);
    await logAudit(g.user.email, "WAITLIST_NOTIFY_ALL", `product #${productId}: ${r.sent}/${r.candidates} notified`);
    return NextResponse.json({ ok: true, ...r });
  }

  const entry = await db.waitlist.findUnique({ where: { id: Number(b.id) } });
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  const r = await notifyWaitlistEntry(entry as WaitlistEntry, s);
  await logAudit(g.user.email, "WAITLIST_NOTIFY", `#${entry.id} → ${r.channel}${r.ok ? "" : " (manual)"}`);
  return NextResponse.json({ ...r });
}
