import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import { sendSms, smsCfg, smsStats, SMS_TEMPLATES, fillTemplate, normalizeBdPhone } from "@/lib/sms";

export const dynamic = "force-dynamic";

/* SMS via a Bangladeshi gateway (BulkSMSBD / GreenWeb / MimSMS / custom GET URL).
   GET  → whether it is configured, delivery stats, the templates and the last sends
   POST → send one message to a phone, an order code, or a customer phone
   Nothing pretends to work: without a key the send is refused and logged, so the owner sees
   "gateway not configured" instead of customers never getting a parcel update. */
export async function GET(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const s = envFallback(await getSettings());
  const cfg = smsCfg(s);
  const stats = await smsStats();
  const logs = await db.appLog.findMany({ where: { kind: "SMS" }, orderBy: { id: "desc" }, take: 60 });
  return NextResponse.json({
    ok: true,
    configured: !!(cfg.enabled !== false && cfg.apiKey),
    provider: cfg.provider || "bulksmsbd",
    senderId: cfg.senderId || "",
    keyTail: cfg.apiKey ? "••••" + cfg.apiKey.slice(-4) : "",
    stats,
    templates: SMS_TEMPLATES,
    logs,
    autoEvents: {
      placed: (s as any).notifications?.sms_on_placed === true,
      confirmed: (s as any).notifications?.sms_on_confirmed === true,
      shipped: (s as any).notifications?.sms_on_shipped === true,
      delivered: (s as any).notifications?.sms_on_delivered === true,
    },
  });
}

export async function POST(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await req.json().catch(() => ({}));
  const s = envFallback(await getSettings());

  let phone = String(b.phone || "").trim();
  let message = String(b.message || "").trim().slice(0, 600);
  let orderId: number | null = null;
  if (b.orderCode) {
    const order = await db.order.findFirst({ where: { code: { equals: String(b.orderCode).trim() } } })
      || await db.order.findFirst({ where: { code: String(b.orderCode).trim().toUpperCase() } });
    if (!order) return NextResponse.json({ error: `No order with code "${b.orderCode}"` }, { status: 404 });
    orderId = order.id;
    if (!phone) phone = order.phone;
    message = fillTemplate(message, {
      name: order.name, code: order.code, amount: "৳" + Math.round(order.total).toLocaleString("en-IN"),
      courier: order.courierName || "courier", tracking: order.courierConsignmentId || order.code, area: order.area,
    });
  }
  if (!phone || !message) return NextResponse.json({ error: "Phone and message are required" }, { status: 400 });

  const r = await sendSms(s, phone, message, b.template ? `template:${String(b.template).slice(0, 20)}` : "manual");
  await logAudit(g.user.email, "SMS_SEND", `${normalizeBdPhone(phone)} — ${r.ok ? "sent" : "failed: " + (r.error || "")}`);
  return NextResponse.json({ ...r, to: normalizeBdPhone(phone), message, orderId }, { status: r.ok ? 200 : 200 });
}

/** Send the "back in stock" style broadcast text to several numbers at once (max 50). */
export async function PUT(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => ({}));
  const numbers: string[] = Array.isArray(b.phones) ? b.phones.slice(0, 50) : [];
  const message = String(b.message || "").trim();
  if (!numbers.length || !message) return NextResponse.json({ error: "phones[] and message are required" }, { status: 400 });
  const s = envFallback(await getSettings());
  const results: { to: string; ok: boolean; error?: string }[] = [];
  for (const n of numbers) {
    const r = await sendSms(s, n, message, "bulk");
    results.push({ to: normalizeBdPhone(n), ok: r.ok, error: r.error });
  }
  await logAudit(g.user.email, "SMS_BULK", `${results.filter((r) => r.ok).length}/${results.length} sent`);
  return NextResponse.json({ ok: true, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}
