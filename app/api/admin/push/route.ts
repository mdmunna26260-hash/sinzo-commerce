import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { getVapid, sendPushAll, sendPushToPhones } from "@/lib/webpush";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
export const dynamic = "force-dynamic";

/* GET → subscriber stats for the admin panel */
export async function GET(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const [total, withPhone, recent] = await Promise.all([
    db.pushSubscription.count(),
    db.pushSubscription.count({ where: { phone: { not: null } } }),
    db.pushSubscription.findMany({
      orderBy: { id: "desc" },
      take: 30,
      select: { id: true, phone: true, createdAt: true, endpoint: true },
    }),
  ]);
  return NextResponse.json({ total, withPhone, recent });
}

/* POST → { action: "test", phone } | { action: "broadcast", title, body, url } */
export async function POST(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  try {
    const b = await req.json();
    const title = String(b.title || "").trim().slice(0, 80);
    const body = String(b.body || "").trim().slice(0, 200);
    const url = String(b.url || "/").trim().slice(0, 300);

    if (b.action === "test") {
      const phone = normalizeBDPhone(String(b.phone || ""));
      if (!isValidBDPhone(phone)) return NextResponse.json({ error: "Valid BD number din (01XXXXXXXXX)" }, { status: 400 });
      const r = await sendPushToPhones([phone], { title: title || "Test notification", body: body || "Push notification kaj korche ✓", url: url || "/track", tag: "test" });
      if (!r.sent) return NextResponse.json({ error: `Kono device pai nai ei number-e (${r.failed} failed, expired gula removed)` }, { status: 404 });
      return NextResponse.json({ ok: true, detail: `${r.sent} device-e pathano hoyeche` });
    }

    if (!title) return NextResponse.json({ error: "Title din" }, { status: 400 });
    const r = await sendPushAll({ title, body, url: url || "/", tag: "broadcast-" + Date.now() });
    return NextResponse.json({ ok: true, detail: `${r.sent} delivered · ${r.failed} failed · ${r.removed} expired removed` });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
