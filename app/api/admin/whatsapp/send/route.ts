import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings, envFallback } from "@/lib/settings";
import { waRules, validWaId, toWaId, waPretty, eventForStatus, renderOrderMessage, waTemplates } from "@/lib/wa-queue";
import { composeMessage, sendNow, catalogById } from "@/lib/wa-messages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Send a panel-written message (Phase 2).
   Two shapes:
     • { body, productId?, images[]?, couponCode? }  → a composed message (text + product card + photos)
     • { orderId, templateKey }                      → the order update for that order, rendered with
                                                       the SAME template the worker would use
   Either way it goes into the outbox and one worker tick runs straight away, so the owner sees it
   leave. Caps, quiet hours and device choice still apply — nothing here forces a message out. */
export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const b = await req.json().catch(() => ({} as any));
  const s = envFallback(await getSettings());
  const rules = waRules(s);
  const immediate = b.immediate !== false;

  let to = String(b.to || "").trim();
  let body = "";
  let images: string[] = Array.isArray(b.images) ? b.images.filter((u: any) => typeof u === "string" && u.trim()) : [];
  let orderId: number | null = null;
  let templateKey: string | null = null;
  let coupon: string | null = null;

  if (b.orderId || b.orderCode) {
    // ── order update ──────────────────────────────────────────────────────────────
    const order = b.orderId
      ? await db.order.findUnique({ where: { id: Number(b.orderId) }, include: { items: true } })
      : await db.order.findFirst({ where: { code: String(b.orderCode).trim().toUpperCase() }, include: { items: true } });
    if (!order) return NextResponse.json({ error: "Order khuje paoa gelo na" }, { status: 404 });
    const tpls = await waTemplates();
    templateKey = String(b.templateKey || eventForStatus(order.status) || "order_placed");
    const tpl = tpls.find((t) => t.key === templateKey);
    if (!tpl) return NextResponse.json({ error: "Template nei" }, { status: 400 });
    const rendered = await renderOrderMessage(order, tpl, s, rules);
    body = rendered.body;
    orderId = order.id;
    to = to || order.phone;
    // an owner-sent order update replaces the queued event's photos with the same ones
    images = images.length ? images : rendered.media;
  } else {
    // ── composed message ──────────────────────────────────────────────────────────
    if (b.productId) {
      const p = await catalogById(Number(b.productId));
      if (!p) return NextResponse.json({ error: "Product nei" }, { status: 404 });
    }
    const composed = await composeMessage({
      body: b.body,
      productId: b.productId ? Number(b.productId) : null,
      couponCode: b.couponCode === undefined ? rules.couponCode : String(b.couponCode || ""),
      includeStopLine: typeof b.includeStopLine === "boolean" ? b.includeStopLine : rules.stopLine,
      images,
    });
    body = composed.body;
    images = composed.images;
    coupon = String(b.couponCode ?? rules.couponCode ?? "").trim() || null;
    if (composed.product) templateKey = null;
  }

  if (!to) return NextResponse.json({ error: "Kake pathaben (number din)" }, { status: 400 });
  const waId = toWaId(to);
  if (!validWaId(waId)) return NextResponse.json({ error: `${waPretty(waId) || to} ekta valid BD number na` }, { status: 400 });
  if (!body.trim()) return NextResponse.json({ error: "Message khali — kichu likhun" }, { status: 400 });
  if (body.length > 4000) return NextResponse.json({ error: "Message onek boro (4000 character er beshi)" }, { status: 400 });
  if (images.length > 10) images = images.slice(0, 10);

  const r = await sendNow({
    to: waId,
    body,
    images,
    kind: templateKey ? "AUTO" : "MANUAL",
    templateKey,
    orderId,
    couponCode: coupon,
    immediate,
    meta: { manual: true, by: g.user.email, productId: b.productId ? Number(b.productId) : null, templateKey },
  });

  await logAudit(g.user.email, "WA_SEND", `${templateKey || "custom"} → ${waPretty(waId)}${images.length ? ` (${images.length} image)` : ""}: ${body.slice(0, 80).replace(/\n/g, " ")}`);
  if (!r.ok) return NextResponse.json({ ok: false, id: r.id, error: r.reason || "Pathate parlam na" }, { status: 502 });
  return NextResponse.json({
    ok: true, id: r.id, sent: r.sent,
    status: r.sent ? "SENT" : "QUEUED",
    message: r.sent ? "Message chole geche ✓" : "Queue te ache — worker porer tick e pathabe (cap/quiet hours er karone)",
    body, images, templateKey,
    tick: r.tick ? { sent: r.tick.sent, queued: r.tick.claimed, notes: r.tick.notes } : null,
  });
}
