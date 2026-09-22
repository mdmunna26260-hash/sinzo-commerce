import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/auth";
import { logApp } from "@/lib/logs";
import { toWaId, validWaId, waPretty } from "@/lib/wa-queue";

export const dynamic = "force-dynamic";

/* The STOP list (Phase 3).
   Anyone here never gets marketing again — order updates still go, because those are the customer's
   own order information. Customers add themselves by writing STOP to the shop number (the bridge
   forwards it to /api/wa/inbound, which writes the row); the panel can also add/remove by hand. */
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const rows = await db.waOptOut.findMany({ orderBy: { id: "desc" }, take: 500 });
  return NextResponse.json({ ok: true, optOuts: rows.map((r) => ({ ...r, pretty: waPretty(r.waId) })) });
}

export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => ({} as any));
  const waId = toWaId(String(b.wa || b.waId || b.phone || ""));
  if (!validWaId(waId)) return NextResponse.json({ error: "Number টা ঠিক নেই" }, { status: 400 });

  if (b.action === "remove") {
    await db.waOptOut.deleteMany({ where: { waId } });
    await logAudit(g.user.email, "WA_OPTOUT_REMOVED", waPretty(waId));
    return NextResponse.json({ ok: true, removed: true, waId });
  }

  await db.waOptOut.upsert({
    where: { waId },
    update: { reason: String(b.reason || "manual").slice(0, 200), source: String(b.source || "MANUAL").slice(0, 20) },
    create: { waId, reason: String(b.reason || "manual").slice(0, 200), source: String(b.source || "MANUAL").slice(0, 20) },
  });
  await db.customer.updateMany({ where: { phone: waPretty(waId) }, data: { waOptIn: false, waOptInAt: null } }).catch(() => {});
  await logApp("WARN", "WHATSAPP", `${waPretty(waId)} marked opted-out (${b.reason || "manual"})`, { waId });
  await logAudit(g.user.email, "WA_OPTOUT_ADDED", waPretty(waId));
  return NextResponse.json({ ok: true, waId });
}
