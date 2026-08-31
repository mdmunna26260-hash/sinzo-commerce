import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { rateLimit } from "@/lib/auth";
export const dynamic = "force-dynamic";

/* Fraud report from the admin order page: records a structured report for the
   phone and auto-blacklists it, so future checkouts from this number are
   blocked/flagged by the existing fraud system. */
export async function POST(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  if (!rateLimit("fraudrep:" + g.user.email, 20, 60 * 1000)) {
    return NextResponse.json({ error: "Too many — wait a minute" }, { status: 429 });
  }
  const b = await req.json().catch(() => ({}));
  const phone = String(b.phone || "").trim();
  const reason = String(b.reason || "Fraud").trim().slice(0, 120);
  const userNote = String(b.note || "").trim().slice(0, 500);
  if (!/^01[3-9]\d{8}$/.test(phone)) return NextResponse.json({ error: "Valid BD phone required" }, { status: 400 });

  const dupes = await db.order.count({ where: { phone } });
  const note = `reported: ${reason}${userNote ? " — " + userNote : ""}`;
  const existing = await db.blacklist.findFirst({ where: { type: "PHONE", value: phone } });
  if (existing) await db.blacklist.update({ where: { id: existing.id }, data: { note } });
  else await db.blacklist.create({ data: { type: "PHONE", value: phone, note } });
  await logAudit(g.user.email, "FRAUD_REPORT", `${phone} — ${reason}${userNote ? " — " + userNote : ""} (had ${dupes} orders)`);
  return NextResponse.json({ ok: true, phone, reason, pastOrders: dupes });
}

export async function GET(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const entries = await db.blacklist.findMany({ where: { type: "PHONE" }, orderBy: { id: "desc" }, take: 200 });
  return NextResponse.json({ entries });
}
