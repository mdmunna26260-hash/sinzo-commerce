import { db } from "./db";
import { getSettings, envFallback, type SettingsMap } from "./settings";
import { logApp } from "./logs";

/* WhatsApp queue (outbox) — Phase 1.
   Rule #1 of the whole WhatsApp system: NOTHING is sent inside a web request. Checkout, an order
   status change or the admin panel only ever writes a `WaMessage` row; scripts/wa-worker.js picks
   it up, decides (caps, quiet hours, pacing) and hands it to the bridge. A blocked/slow number or
   a bridge that is down therefore never delays a customer's order. */

export const WA_EVENTS = ["order_placed", "order_confirmed", "order_packed", "order_shipped", "order_delivered", "order_cancelled"] as const;
export type WaEvent = (typeof WA_EVENTS)[number];

/** Order status → the event template that goes out for it. */
export function eventForStatus(status: string): WaEvent | null {
  const map: Record<string, WaEvent> = {
    CONFIRMED: "order_confirmed",
    PACKED: "order_packed",
    PROCESSING: "order_packed",
    SHIPPED: "order_shipped",
    DELIVERED: "order_delivered",
    CANCELLED: "order_cancelled",
    RETURNED: "order_cancelled",
  };
  return map[String(status || "").toUpperCase()] || null;
}

export type WaRules = {
  /** master switch for the automatic (transactional) messages */
  enabled: boolean;
  /** "22:00" / "09:00" — quiet hours: only non-transactional kinds wait for the window */
  quietFrom: string;
  quietTo: string;
  /** default daily cap for a newly added number (warm-up: 50 → 150 → 300 → 400) */
  dailyCapDefault: number;
  /** WhatsApp failed → send the same text over SMS (item 7 gateway) instead of losing it */
  smsFallback: boolean;
  /** how long a message may sit in the queue before the SMS fallback may take over */
  fallbackHours: number;
  /** test mode: every message is redirected to `testNumber`, prefixed [TEST] — nothing reaches a customer */
  testMode: boolean;
  testNumber: string;
  /** coupon code mentioned in order messages (empty = no coupon line) */
  couponCode: string;
  /** append "Offers bondho korte STOP likhun" */
  stopLine: boolean;
  /** shared key scripts/wa-worker.js uses to call /api/wa/tick */
  workerKey: string;
  /** canned replies the inbox shows above the composer (editable, no deploy needed) */
  quickReplies: string[];
};

/** What may ride along with a message: nothing, the first product photo, or up to 3 item photos. */
export const WA_MEDIA_MODES = ["NONE", "PRODUCT", "ORDER_ITEMS"] as const;
/** most images one queued message may carry (WhatsApp allows more; the UI caps at 10) */
export const WA_MEDIA_MAX = 10;
export type WaMediaMode = (typeof WA_MEDIA_MODES)[number];

export const WA_RULE_DEFAULTS: WaRules = {
  enabled: true,
  quietFrom: "22:00",
  quietTo: "09:00",
  dailyCapDefault: 50,
  smsFallback: true,
  fallbackHours: 6,
  testMode: false,
  testNumber: "",
  couponCode: "",
  stopLine: true,
  workerKey: "",
  quickReplies: [
    "Apnake dhonnobad! Apnar order ta process hocche, 1–2 din er moddhe dispatch hobe.",
    "Parcel ta aj courier-e deya hoyeche 🚚 tracking number shiggiri pathacchi.",
    "Size ba colour change korte chan? Amake bolun, stock thakle change kore debo.",
    "Delivery address ta confirm korte parben please?",
    "Ei product ta stock e ache ✅ order korte chan?",
  ],
};

export function waRules(s: SettingsMap): WaRules {
  const raw = ((s as any).whatsapp || {}) as Partial<WaRules>;
  return { ...WA_RULE_DEFAULTS, ...raw };
}

/** "22:00"+"09:00" → is `now` inside the window (handles windows crossing midnight). */
export function inQuietHours(from: string, to: string, now = new Date()): boolean {
  const parse = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "").trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  };
  const a = parse(from), b = parse(to);
  if (a === null || b === null || a === b) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

/* ── templates ────────────────────────────────────────────────────────────────────────── */
export const WA_TEMPLATE_DEFAULTS: { key: WaEvent; name: string; category: "UTILITY" | "MARKETING"; mediaMode: WaMediaMode; body: string }[] = [
  {
    key: "order_placed", name: "Order placed (confirmation)", category: "UTILITY", mediaMode: "PRODUCT",
    body: [
      "Hi {name}! 🛒",
      "",
      "Apnar order *{code}* confirm hoyeche ✅",
      "",
      "{items}",
      "",
      "*Total: ৳{amount}* ({payment})",
      "Delivery: {eta}",
      "{couponLine}",
      "",
      "Order track korun: {link}",
      "",
      "Dhonnobad! 🙏 {stopLine}",
    ].join("\n"),
  },
  {
    key: "order_confirmed", name: "Order confirmed", category: "UTILITY", mediaMode: "NONE",
    body: "Hi {name}, apnar order *{code}* amra confirm korlam ✅ Total ৳{amount} ({payment}). Shighroi pack kore pathabo. Track: {link}",
  },
  {
    key: "order_packed", name: "Packed", category: "UTILITY", mediaMode: "NONE",
    body: "Hi {name}, apnar order *{code}* pack hoye gelo 📦 Aj-i courier e jabe. Total ৳{amount} (COD). {stopLine}",
  },
  {
    key: "order_shipped", name: "Handed to courier", category: "UTILITY", mediaMode: "NONE",
    body: [
      "Hi {name}, apnar order *{code}* courier e deya hoyeche 🚚",
      "{courierLine}",
      "{trackingLine}",
      "",
      "Track korun: {link}",
    ].join("\n"),
  },
  {
    key: "order_delivered", name: "Delivered", category: "UTILITY", mediaMode: "NONE",
    body: [
      "Hi {name}, apnar order *{code}* deliver hoyeche ✅",
      "",
      "Dhonnobad! Kono problem thakle ei number e likhun.",
      "Ekta review dile amader onek help hoy: {review}",
    ].join("\n"),
  },
  {
    key: "order_cancelled", name: "Cancelled", category: "UTILITY", mediaMode: "NONE",
    body: [
      "Hi {name}, apnar order *{code}* cancel kora hoyeche.",
      "COD order chhilo, tai kono taka kata hoy ni — kono chinta nai.",
      "",
      "Bhul hole abar order korun: {site}",
    ].join("\n"),
  },
];

/** The event templates exist on first use — default text once, never overwriting an edited body. */
export async function ensureWaTemplates(): Promise<void> {
  try {
    const { ensureExtraTables } = await import("./db-ensure");
    await ensureExtraTables();
    const have = await db.waTemplate.findMany({ select: { key: true } });
    const known = new Set(have.map((h) => h.key));
    for (const t of WA_TEMPLATE_DEFAULTS) {
      if (known.has(t.key)) continue;
      await db.waTemplate.create({ data: { key: t.key, name: t.name, category: t.category, body: t.body, mediaMode: t.mediaMode, enabled: true } }).catch(() => {});
    }
  } catch { /* the queue must stay callable even if this fails */ }
}

export async function waTemplates() {
  await ensureWaTemplates();
  return db.waTemplate.findMany({ orderBy: { id: "asc" } });
}

/** Canonical storefront URL for links inside messages (same rule as the emails). */
export function siteUrl(s: SettingsMap): string {
  const raw = (s as any)?.seo?.siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "";
  const url = String(raw).trim();
  if (url.startsWith("http")) return url.replace(/\/$/, "");
  if (url) return "https://" + url.replace(/\/$/, "");
  return "https://sinzooffcial.com";
}

/* ── variables ────────────────────────────────────────────────────────────────────────── */
const EMPTY = "\u0000";
const money = (n: number) => "৳" + Math.round(Number(n) || 0).toLocaleString("en-IN");

/** 01676450711 / +8801676450711 → 8801676450711 (the JID form, digits only). */
export function toWaId(phone: string): string {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("880")) return d;
  if (d.startsWith("01") && d.length === 11) return "880" + d.slice(1);
  if (d.startsWith("0") && d.length === 11) return "88" + d;
  if (d.length === 10) return "880" + d;
  return d;
}
/** pretty form for screens: 8801676450711 → 01676450711 */
export function waPretty(waId: string): string {
  const d = String(waId || "").replace(/\D/g, "");
  return d.startsWith("880") ? "0" + d.slice(3) : d;
}
export function validWaId(waId: string): boolean {
  return /^8801\d{9}$/.test(toWaId(waId));
}

/** Fills {variables} and DROPS any line whose placeholder had no value (so {trackingLine}
    disappears for an order that has no consignment yet instead of leaving "Tracking: "). */
export function renderTemplate(body: string, vars: Record<string, unknown>): string {
  const marked = String(body || "").replace(/\{(\w+)\}/g, (_m, k: string) => {
    // keys that start with "_" are internal (image lists and such) — they can never leak into a message
    if (k.startsWith("_")) return EMPTY;
    const v = vars[k];
    return v === undefined || v === null || v === "" ? EMPTY : String(v);
  });
  return marked
    .split("\n")
    .filter((line) => !line.includes(EMPTY))
    .map((line) => line.split(EMPTY).join("").replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* WhatsApp text limit is a character count, JS strings are UTF-16 — and Bengali/emoji are outside
   the BMP. A plain .slice() can cut such a character in half (mojibake, or a rejected send), so
   every clamp in the WhatsApp code goes through here: it never splits a surrogate pair, prefers to
   cut on a line break, and keeps the limit honest for mixed Bangla + English text. */
export function clampText(input: string, max = 4000): string {
  const s = String(input ?? "");
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // dangling high surrogate
  const nl = cut.lastIndexOf("\n");
  if (nl > max * 0.6) cut = cut.slice(0, nl);
  return cut.trimEnd() + "…";
}

/** UTF-16 length in WhatsApp terms — handy for the composer counter (Bangla counts as 1 char). */
export function textLength(input: string): number {
  return Array.from(String(input ?? "")).length;
}

export type WaVars = Record<string, unknown>;

/** Everything an order message can say, from the real order rows. */
export async function orderVars(order: any, s: SettingsMap, rules = waRules(s)): Promise<WaVars & { _media: string | null; _itemMedia: string[]; _couponLine: string }> {
  const site = siteUrl(s);
  const items = (order.items || []) as any[];
  const lines = items.slice(0, 8).map((i) => `• ${i.title}${i.variant ? ` (${i.variant})` : ""} × ${i.qty} — ${money(i.price * i.qty)}`);
  if (items.length > 8) lines.push(`…ar ${items.length - 8} item`);
  const productId = items.find((i) => i.productId)?.productId || null;
  let slug: string | null = null;
  if (productId) {
    const p = await db.product.findUnique({ where: { id: productId }, select: { slug: true } }).catch(() => null);
    slug = p?.slug || null;
  }
  const image = items.find((i) => i.image)?.image || null;
  const coupon = rules.couponCode || "";
  // up to 3 distinct item photos for mediaMode ORDER_ITEMS (duplicates collapse — a 3× same
  // product order should not send the same photo three times)
  const itemMedia = Array.from(new Set(items.map((i) => i.image).filter(Boolean).map((u: string) => mediaAbsolute(u, site) as string))).slice(0, 3);
  return {
    name: String(order.name || "").trim().split(/\s+/)[0] || "apni",
    code: order.code,
    amount: String(Math.round(order.total)),
    amountTk: money(order.total),
    items: lines.join("\n"),
    payment: order.paymentMethod === "COD" ? "Cash on Delivery" : order.paymentMethod || "COD",
    area: order.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka",
    eta: order.area === "INSIDE_DHAKA" ? "1–2 din (Inside Dhaka)" : "2–4 din (Outside Dhaka)",
    link: `${site}/track?code=${order.code}`,
    site,
    tracking: order.courierConsignmentId || order.courierTracking || "",
    courier: order.courierName || "Steadfast",
    courierLine: order.courierName ? `Courier: ${order.courierName}` : "",
    trackingLine: order.courierConsignmentId ? `Consignment: ${order.courierConsignmentId}` : "",
    product: slug ? `${site}/products/${slug}` : site,
    review: slug ? `${site}/products/${slug}#reviews` : `${site}/track?code=${order.code}`,
    coupon,
    couponLine: coupon ? `🎟 Poroborti order e *${coupon}* code diye discount nin.` : "",
    stopLine: rules.stopLine ? "\nOffer bondho korte 'STOP' likhun." : "",
    _media: mediaAbsolute(image, site),
    _itemMedia: itemMedia,
    _couponLine: coupon ? `🎟 Poroborti order e *${coupon}* code diye discount nin.` : "",
  };
}

/** The body + images one order event should send (shared by the worker path and the inbox panel). */
export async function renderOrderMessage(
  order: any,
  tpl: { body: string; mediaMode?: string | null },
  s: SettingsMap,
  rules = waRules(s),
): Promise<{ body: string; media: string[] }> {
  const vars = await orderVars(order, s, rules);
  const body = clampText(renderTemplate(tpl.body, vars), 4000);
  const mode = String(tpl.mediaMode || "NONE");
  const media =
    mode === "PRODUCT" ? (vars._media ? [vars._media] : [])
    : mode === "ORDER_ITEMS" ? vars._itemMedia.slice(0, 3)
    : [];
  return { body, media };
}

export function mediaAbsolute(url: string | null | undefined, site: string): string | null {
  const u = String(url || "").trim();
  if (!u) return null;
  if (u.startsWith("http")) return u;
  return site.replace(/\/$/, "") + (u.startsWith("/") ? u : "/" + u);
}

/* ── enqueue ──────────────────────────────────────────────────────────────────────────── */
export type EnqueueInput = {
  to: string;                 // local or international phone
  body: string;
  kind?: "AUTO" | "BROADCAST" | "REPLY" | "MANUAL";
  templateKey?: string | null;
  orderId?: number | null;
  media?: string[];           // absolute image URLs
  couponCode?: string | null;
  dedupeKey?: string | null;
  meta?: Record<string, unknown> | null;
  queuedAt?: Date;
};

export async function enqueue(input: EnqueueInput): Promise<{ ok: boolean; id?: number; reason?: string; to?: string }> {
  const { ensureExtraTables } = await import("./db-ensure");
  await ensureExtraTables().catch(() => {});
  const s = envFallback(await getSettings());
  const rules = waRules(s);

  let to = toWaId(input.to);
  let body = clampText(String(input.body || "").trim(), 4000);
  if (!body) return { ok: false, reason: "empty message" };
  if (!validWaId(to)) return { ok: false, reason: `invalid number (${waPretty(to) || "—"})` };

  // test mode: nothing reaches a customer, everything goes to the owner's test number
  if (rules.testMode && input.kind !== "REPLY") {
    const test = toWaId(rules.testNumber);
    if (!validWaId(test)) return { ok: false, reason: "test mode is on but no test number is set" };
    body = `[TEST → ${waPretty(to)}]\n${body}`;
    to = test;
  }

  if (input.dedupeKey) {
    const dup = await db.waMessage.findUnique({ where: { dedupeKey: input.dedupeKey } }).catch(() => null);
    if (dup) return { ok: false, id: dup.id, reason: "already queued" };
  }
  try {
    const row = await db.waMessage.create({
      data: {
        toWaId: to,
        kind: input.kind || "AUTO",
        templateKey: input.templateKey || null,
        body,
        // absolute URLs: the bridge may be on another host/port than the admin panel was
        mediaJson: input.media && input.media.length
          ? JSON.stringify(input.media.slice(0, WA_MEDIA_MAX).map((u) => mediaAbsolute(u, siteUrl(s))).filter(Boolean))
          : null,
        couponCode: input.couponCode || null,
        orderId: input.orderId ?? null,
        dedupeKey: input.dedupeKey || null,
        meta: input.meta ? JSON.stringify(input.meta).slice(0, 2000) : null,
        status: "QUEUED",
        queuedAt: input.queuedAt || new Date(),
      },
    });
    return { ok: true, id: row.id, to };
  } catch (e: any) {
    if (String(e?.code || "").includes("P2002")) return { ok: false, reason: "already queued" };
    return { ok: false, reason: String(e?.message || e).slice(0, 160) };
  }
}

/** The one entry point the rest of the app uses: "this happened to order X, tell the customer". */
export async function enqueueOrderEvent(orderId: number, event: WaEvent, opts: { force?: boolean } = {}): Promise<{ queued: boolean; id?: number; reason?: string }> {
  try {
    const { ensureExtraTables } = await import("./db-ensure");
    await ensureExtraTables().catch(() => {});
    const s = envFallback(await getSettings());
    const rules = waRules(s);
    if (!rules.enabled && !opts.force) return { queued: false, reason: "WhatsApp auto messages are off" };

    await ensureWaTemplates();
    const tpl = await db.waTemplate.findUnique({ where: { key: event } });
    if (!tpl) return { queued: false, reason: "no template" };
    if (!tpl.enabled && !opts.force) return { queued: false, reason: `${event} template is switched off` };

    const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return { queued: false, reason: "order not found" };
    if (event !== "order_cancelled" && ["CANCELLED", "RETURNED"].includes(order.status)) {
      return { queued: false, reason: `${order.code} is ${order.status}` };
    }

    const { body, media } = await renderOrderMessage(order, tpl, s, rules);

    const r = await enqueue({
      to: order.phone,
      body,
      kind: "AUTO",
      templateKey: event,
      orderId: order.id,
      media,
      couponCode: rules.couponCode || null,
      dedupeKey: `${event}:${order.id}`,
      meta: { code: order.code, name: order.name, amount: Math.round(order.total), area: order.area },
    });
    if (r.ok) {
      await logApp("INFO", "WHATSAPP", `${event} queued for ${order.code} → ${waPretty(r.to || order.phone)}`, { waMessageId: r.id, orderId: order.id });
      return { queued: true, id: r.id };
    }
    if (r.reason && r.reason !== "already queued") {
      // a switched-off template is normal, don't cry about it — a bad number is worth logging
      if (/invalid number|test mode/.test(r.reason)) {
        await logApp("WARN", "WHATSAPP", `${event} for ${order.code} not queued — ${r.reason}`, { orderId: order.id });
      }
    }
    return { queued: false, id: r.id, reason: r.reason };
  } catch (e: any) {
    await logApp("ERROR", "WHATSAPP", `enqueue ${event} for order ${orderId} failed: ${String(e?.message || e).slice(0, 200)}`).catch(() => {});
    return { queued: false, reason: "error" };
  }
}

/** enqueueOrderEvent without ever throwing or blocking the caller. */
export function enqueueOrderEventAsync(orderId: number, event: WaEvent): void {
  enqueueOrderEvent(orderId, event).catch(() => {});
}

/* ── preview + test send (Templates screen) ───────────────────────────────────────────── */
/** Sample values so a template can be previewed and tested before a real order exists. */
export function sampleVars(s: SettingsMap, rules = waRules(s)): WaVars {
  const site = siteUrl(s);
  const coupon = rules.couponCode || "SAVE100";
  return {
    name: "Rakib",
    code: "ORD-1042",
    amount: "2450",
    amountTk: money(2450),
    items: "• Silk Panjabi (L · Maroon) × 1 — " + money(2150) + "\n• Embroidered Cap × 1 — " + money(300),
    payment: "Cash on Delivery",
    area: "Inside Dhaka",
    eta: "1–2 din (Inside Dhaka)",
    link: `${site}/track?code=ORD-1042`,
    site,
    tracking: "STF-8892311",
    courier: "Steadfast",
    courierLine: "Courier: Steadfast",
    trackingLine: "Consignment: STF-8892311",
    product: `${site}/products/demo`,
    review: `${site}/products/demo#reviews`,
    coupon,
    couponLine: `🎟 Poroborti order e *${coupon}* code diye discount nin.`,
    stopLine: rules.stopLine ? "\nOffer bondho korte 'STOP' likhun." : "",
  };
}

/** Prefer a real catalogue photo for the test message so the owner sees what customers will. */
export async function sampleImage(): Promise<string | null> {
  try {
    const img = await db.productImage.findFirst({ where: { product: { status: "ACTIVE" } }, orderBy: { productId: "desc" }, select: { url: true } });
    return img?.url || null;
  } catch {
    return null;
  }
}

/** "Send a test to my number" — bypasses the event toggles on purpose, then runs the worker
    immediately so the owner sees the result in seconds instead of waiting for the next tick. */
export async function sendTemplateTest(key: string, to: string): Promise<{ ok: boolean; id?: number; reason?: string; tick?: any }> {
  const s = envFallback(await getSettings());
  const rules = waRules(s);
  await ensureWaTemplates();
  const tpl = await db.waTemplate.findUnique({ where: { key } });
  if (!tpl) return { ok: false, reason: "no such template" };
  const vars = sampleVars(s, rules);
  const body = "[TEST]\n" + renderTemplate(tpl.body, vars);
  const media: string[] = [];
  if (tpl.mediaMode === "PRODUCT") {
    const abs = mediaAbsolute(await sampleImage(), String(vars.site || ""));
    if (abs) media.push(abs);
  } else if (tpl.mediaMode === "ORDER_ITEMS") {
    // show the owner what a real order looks like: the newest product photos in the shop
    const imgs = await db.productImage.findMany({ where: { product: { status: "ACTIVE" } }, orderBy: { id: "desc" }, take: 2, select: { url: true } }).catch(() => []);
    for (const i of imgs) { const abs = mediaAbsolute(i.url, String(vars.site || "")); if (abs) media.push(abs); }
  }
  const r = await enqueue({ to, body, kind: "MANUAL", templateKey: key, media, dedupeKey: null, meta: { test: true } });
  if (!r.ok) return { ok: false, id: r.id, reason: r.reason };
  const { runWaTick } = await import("./wa-worker");
  const tick = await runWaTick({ limit: 1, force: true, bypass: true });
  return { ok: true, id: r.id, tick };
}

/* ── reads for the admin screens ─────────────────────────────────────────────────────── */
export async function waQueueStats() {
  const { ensureExtraTables } = await import("./db-ensure");
  await ensureExtraTables().catch(() => {});
  const [queued, sending, sent, delivered, read, failed, skipped] = await Promise.all([
    db.waMessage.count({ where: { status: "QUEUED" } }),
    db.waMessage.count({ where: { status: "SENDING" } }),
    db.waMessage.count({ where: { status: "SENT" } }),
    db.waMessage.count({ where: { status: "DELIVERED" } }),
    db.waMessage.count({ where: { status: "READ" } }),
    db.waMessage.count({ where: { status: "FAILED" } }),
    db.waMessage.count({ where: { status: "SKIPPED" } }),
  ]);
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const today = await db.waMessage.count({ where: { sentAt: { gte: since } } }).catch(() => 0);
  const oldest = await db.waMessage.findFirst({ where: { status: "QUEUED" }, orderBy: { id: "asc" }, select: { queuedAt: true } }).catch(() => null);
  return { queued, sending, sent, delivered, read, failed, skipped, last24h: today, oldestQueuedAt: oldest?.queuedAt || null };
}

export async function waRecentMessages(take = 40) {
  const { ensureExtraTables } = await import("./db-ensure");
  await ensureExtraTables().catch(() => {});
  return db.waMessage.findMany({ orderBy: { id: "desc" }, take });
}

/** Mirror an outgoing message into the WhatsApp inbox thread so the conversation reads in full. */
export async function mirrorToInbox(waId: string, body: string, orderId: number | null, status = "ok"): Promise<void> {
  try {
    await db.inboxMessage.create({ data: { waId: String(waId).replace(/\D/g, ""), name: null, direction: "OUT", body: String(body).slice(0, 4000), orderId, status } });
  } catch { /* the inbox is a convenience — never fail a send over it */ }
}
