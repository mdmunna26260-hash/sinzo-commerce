import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { waSend, waStatus } from "@/lib/wa";
import { getSettings, envFallback } from "@/lib/settings";
import { logApp } from "@/lib/logs";
export const dynamic = "force-dynamic";

/* WhatsApp inbox (admin side).
   GET  → conversation list (grouped by number) or one thread + the orders that match the number
   POST → send a reply (stored as an OUT row either way) or link the thread to an order */
export async function GET(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const url = new URL(req.url);
  const wa = (url.searchParams.get("wa") || "").replace(/\D/g, "");

  if (wa) {
    const rows = await db.inboxMessage.findMany({ where: { waId: wa }, orderBy: { id: "asc" }, take: 300 });
    const local = wa.startsWith("880") ? "0" + wa.slice(3) : wa;
    const orders = await db.order.findMany({
      where: { phone: local }, orderBy: { id: "desc" }, take: 5,
      select: { id: true, code: true, name: true, status: true, total: true, createdAt: true },
    });
    return NextResponse.json({ ok: true, wa, rows, orders });
  }

  const recent = await db.inboxMessage.findMany({ orderBy: { id: "desc" }, take: 500 });
  const conversations = new Map<string, any>();
  for (const m of recent) {
    const c = conversations.get(m.waId) || { waId: m.waId, name: m.name, last: m.body, lastAt: m.createdAt, lastDirection: m.direction, count: 0, inbound: 0, orderId: null };
    c.count++;
    if (m.direction === "IN") c.inbound++;
    if (!c.name && m.name) c.name = m.name;
    if (!c.orderId && m.orderId) c.orderId = m.orderId;
    conversations.set(m.waId, c);
  }
  const list = Array.from(conversations.values()).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  const orderIds = Array.from(new Set(list.map((c) => c.orderId).filter(Boolean)));
  const orders = await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, code: true, name: true, status: true } });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const status = await waStatus().catch(() => ({ running: false, connected: false }));
  const s = envFallback(await getSettings());
  return NextResponse.json({
    ok: true,
    status,
    autoReply: (s as any).notifications?.waAutoReply || "",
    conversations: list.map((c) => ({ ...c, order: c.orderId ? byId.get(c.orderId) || null : null })),
    totals: { conversations: list.length, inbound: list.reduce((a, c) => a + c.inbound, 0) },
  });
}

export async function POST(req: Request) {
  const g = await requirePerm("orders", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await req.json().catch(() => ({}));

  if (b.action === "link") {
    const wa = String(b.wa || "").replace(/\D/g, "");
    const code = String(b.orderCode || "").trim().toUpperCase();
    const order = await db.order.findFirst({ where: { code } }) || await db.order.findFirst({ where: { code: { contains: code } } });
    if (!order) return NextResponse.json({ error: `"${code}" code e kono order nei` }, { status: 404 });
    await db.inboxMessage.updateMany({ where: { waId: wa }, data: { orderId: order.id } });
    await logAudit(g.user.email, "WA_INBOX_LINK", `${wa} → ${order.code}`);
    return NextResponse.json({ ok: true, order: { id: order.id, code: order.code, name: order.name } });
  }

  const to = String(b.to || "").replace(/\D/g, "");
  const body = String(b.body || "").trim().slice(0, 4000);
  if (!to || !body) return NextResponse.json({ error: "to and body required" }, { status: 400 });
  const order = await db.order.findFirst({ where: { phone: to.startsWith("880") ? "0" + to.slice(3) : to }, orderBy: { id: "desc" }, select: { id: true, code: true } });
  const r = await waSend(to, body);
  await db.inboxMessage.create({
    data: {
      waId: to, name: null, direction: "OUT", body,
      orderId: order?.id ?? null,
      status: r.ok ? "ok" : "failed",
    },
  });
  if (!r.ok) {
    await logApp("ERROR", "WHATSAPP", `outbound reply to ${to} failed: ${r.error || "unknown"}`, { to });
    return NextResponse.json({ ok: false, error: r.error || "WhatsApp bridge theke pathate parlam na", connected: r.connected }, { status: 502 });
  }
  await logAudit(g.user.email, "WA_INBOX_REPLY", `${to}${order ? " (" + order.code + ")" : ""}: ${body.slice(0, 80)}`);
  return NextResponse.json({ ok: true });
}
