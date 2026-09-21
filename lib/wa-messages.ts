import { db } from "./db";
import { getSettings, envFallback } from "./settings";
import {
  enqueue, mediaAbsolute, clampText, renderTemplate, siteUrl, waRules, waTemplates, eventForStatus,
  renderOrderMessage, WA_MEDIA_MAX,
} from "./wa-queue";

/* Phase 2 message toolkit — everything the panel needs to build a message that is NOT one of the
   six automatic order events: pick a product, write a card, attach compressed photos, add the
   coupon and a product link, then hand it to the same outbox queue (nothing is sent inside the
   request; the worker paces it, and a "send now" just runs one tick immediately). */

export type CatalogHit = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  stock: number; status: string; image: string | null;
};

/** Search for the product picker (title / SKU / slug). */
export async function searchCatalog(q: string, take = 12): Promise<CatalogHit[]> {
  const term = String(q || "").trim();
  const where: any = term
    ? { OR: [{ title: { contains: term } }, { sku: { contains: term } }, { slug: { contains: term } }] }
    : {};
  const rows = await db.product.findMany({
    where, orderBy: { id: "desc" }, take: Math.min(Math.max(take, 1), 25),
    select: { id: true, title: true, slug: true, price: true, comparePrice: true, stock: true, status: true, images: { select: { url: true }, take: 1 } },
  });
  return rows.map((p) => ({
    id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice ?? null,
    stock: p.stock, status: p.status, image: p.images[0]?.url || null,
  }));
}

const money = (n: number) => "৳" + Math.round(Number(n) || 0).toLocaleString("en-IN");

/** The WhatsApp-side "product card": bold name, price (with a struck-through compare price when the
    product is on sale), stock line when it is low, and a tappable product link. Plain text on
    purpose — a link preview or a rich card is a Phase 4 / Cloud API feature. */
export function productCardText(p: { title: string; price: number; comparePrice?: number | null; stock?: number | null; slug: string }, site: string): string {
  const url = `${site.replace(/\/$/, "")}/products/${p.slug}`;
  const sale = p.comparePrice && p.comparePrice > p.price ? ` ~৳${Math.round(p.comparePrice).toLocaleString("en-IN")}~` : "";
  const lines = [`*${p.title}*`, `💰 ${money(p.price)}${sale}`];
  if (typeof p.stock === "number" && p.stock > 0 && p.stock <= 5) lines.push(`⚡ Matro ${p.stock} pcs baki`);
  if (typeof p.stock === "number" && p.stock <= 0) lines.push("🔔 Ekhon stock e nei (pre-order newa hocche)");
  lines.push("", `Order korun 👉 ${url}`);
  return lines.join("\n");
}

export function productCardImage(p: { image?: string | null }, site: string): string[] {
  const abs = mediaAbsolute(p.image, site);
  return abs ? [abs] : [];
}

export type ComposedInput = {
  body?: string;
  productId?: number | null;
  couponCode?: string | null;
  includeStopLine?: boolean;
  images?: string[];
};

export type Composed = { body: string; images: string[]; product?: CatalogHit };

/** Assemble what the customer will actually read: the typed text, the product card, the coupon
    line and the STOP line — in that order, with no duplicated blank lines. */
export async function composeMessage(input: ComposedInput): Promise<Composed> {
  const s = envFallback(await getSettings());
  const rules = waRules(s);
  const site = siteUrl(s);
  const parts: string[] = [];

  const typed = String(input.body || "").trim();
  if (typed) parts.push(typed);

  let product: CatalogHit | undefined;
  if (input.productId) {
    product = (await catalogById(Number(input.productId))) || undefined;
    if (product) parts.push(productCardText(product, site));
  }

  const coupon = String(input.couponCode ?? rules.couponCode ?? "").trim();
  if (coupon) parts.push(`🎟 Ei coupon ta use korte parben: *${coupon}*`);

  if (input.includeStopLine ?? rules.stopLine) parts.push("Offer bondho korte 'STOP' likhun.");

  const images = [...(input.images || [])];
  if (product) for (const img of productCardImage(product, site)) if (!images.includes(img)) images.unshift(img);

  return { body: clampText(parts.join("\n\n").trim(), 4000), images: images.slice(0, WA_MEDIA_MAX), product };
}

export async function catalogById(id: number): Promise<CatalogHit | null> {
  if (!id) return null;
  const p = await db.product.findUnique({
    where: { id },
    select: { id: true, title: true, slug: true, price: true, comparePrice: true, stock: true, status: true, images: { select: { url: true }, take: 1 } },
  }).catch(() => null);
  if (!p) return null;
  return { id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice ?? null, stock: p.stock, status: p.status, image: p.images[0]?.url || null };
}

/** Queue a panel-written message and (optionally) run one worker tick right away so the owner sees
    it leave immediately. Caps / quiet-hours / device choice still decide it — sendNow never forces
    a message past the daily cap. */
export async function sendNow(input: {
  to: string; body: string; images?: string[]; kind?: "AUTO" | "MANUAL" | "BROADCAST" | "REPLY";
  orderId?: number | null; couponCode?: string | null; meta?: Record<string, unknown> | null; immediate?: boolean;
  templateKey?: string | null;
}): Promise<{ ok: boolean; id?: number; reason?: string; sent: boolean; tick?: any }> {
  const r = await enqueue({
    to: input.to,
    body: input.body,
    kind: input.kind || "MANUAL",
    templateKey: input.templateKey ?? null,
    media: input.images || [],
    orderId: input.orderId ?? null,
    couponCode: input.couponCode ?? null,
    meta: input.meta ?? null,
  });
  if (!r.ok) return { ok: false, id: r.id, reason: r.reason, sent: false };
  let sent = false;
  let tick: any = null;
  if (input.immediate !== false) {
    const { runWaTick } = await import("./wa-worker");
    // The owner pressed send: run a tick right away. Older rows may still be in the queue ahead of
    // this one (the worker sends oldest-first), so a couple more ticks are allowed — but only while
    // messages are actually going out, so a daily cap or a dead bridge never turns this into a spin.
    for (let i = 0; i < 3; i++) {
      tick = await runWaTick({ limit: 3, force: true, bypass: true });
      const row = await db.waMessage.findUnique({ where: { id: r.id }, select: { status: true, error: true } }).catch(() => null);
      if (row && row.status !== "QUEUED" && row.status !== "SENDING") {
        sent = row.status === "SENT" || row.status === "DELIVERED" || row.status === "READ";
        if (!sent && row.error) return { ok: false, id: r.id, reason: row.error, sent: false, tick };
        break;
      }
      if (!tick?.sent) break; // nothing left the building — respect the cap and let the worker handle it later
    }
  }
  return { ok: true, id: r.id, sent, tick };
}

/* ── order context for the inbox ─────────────────────────────────────────────────────── */

export type OrderContext = {
  order: {
    id: number; code: string; name: string; status: string; paymentMethod: string; paymentStatus: string;
    total: number; subtotal: number; discount: number; deliveryFee: number; area: string;
    phone: string; waId: string; address: string; couponCode: string | null; createdAt: string;
    courierName: string | null; courierConsignmentId: string | null;
    items: { title: string; qty: number; price: number; variant: string | null; productId: number | null; slug: string | null; image: string | null }[];
  };
  events: { key: string; name: string; enabled: boolean; mediaMode: string; body: string }[];
  suggestedEvent: string;
  preview: string;
  images: string[];
};

const waIdOf = (phone: string) => {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("880")) return d;
  if (d.startsWith("0")) return "880" + d.slice(1);
  return d.length === 10 ? "880" + d : d;
};

/** Everything the panel shows next to a chat: the order, its items, and the ready-to-send update
    for its current status (same templates the worker uses, so nothing diverges). */
export async function orderContext(opts: { orderId?: number; code?: string; waId?: string; event?: string }): Promise<OrderContext | null> {
  const s = envFallback(await getSettings());
  const rules = waRules(s);

  let order: any = null;
  if (opts.orderId) order = await db.order.findUnique({ where: { id: opts.orderId }, include: { items: true } }).catch(() => null);
  if (!order && opts.code) {
    const code = String(opts.code).trim().toUpperCase().replace(/^ORD-?/, "ORD-");
    order = await db.order.findFirst({ where: { OR: [{ code }, { code: { contains: code } }] }, orderBy: { id: "desc" }, include: { items: true } }).catch(() => null);
  }
  if (!order && opts.waId) {
    const d = String(opts.waId).replace(/\D/g, "");
    const local = d.startsWith("880") ? "0" + d.slice(3) : d;
    order = await db.order.findFirst({ where: { phone: local }, orderBy: { id: "desc" }, include: { items: true } }).catch(() => null);
  }
  if (!order) return null;

  const tpls = await waTemplates();
  const slugs = new Map<number, string | null>();
  for (const it of order.items) {
    if (it.productId && !slugs.has(it.productId)) {
      const p = await db.product.findUnique({ where: { id: it.productId }, select: { slug: true } }).catch(() => null);
      slugs.set(it.productId, p?.slug || null);
    }
  }

  const suggested = opts.event && tpls.some((t) => t.key === opts.event)
    ? String(opts.event)
    : (eventForStatus(order.status) || "order_placed");
  const tpl = tpls.find((t) => t.key === suggested) || tpls[0];
  const rendered = tpl ? await renderOrderMessage(order, tpl, s, rules) : { body: "", media: [] };

  return {
    order: {
      id: order.id, code: order.code, name: order.name, status: order.status,
      paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
      total: order.total, subtotal: order.subtotal, discount: order.discount, deliveryFee: order.deliveryFee,
      area: order.area, phone: order.phone, waId: waIdOf(order.phone), address: order.address,
      couponCode: order.couponCode || null, createdAt: order.createdAt?.toISOString?.() || "",
      courierName: order.courierName || null, courierConsignmentId: order.courierConsignmentId || null,
      items: order.items.map((i: any) => ({
        title: i.title, qty: i.qty, price: i.price, variant: i.variant || null,
        productId: i.productId ?? null, slug: i.productId ? slugs.get(i.productId) ?? null : null, image: i.image || null,
      })),
    },
    events: tpls.map((t) => ({ key: t.key, name: t.name, enabled: t.enabled, mediaMode: t.mediaMode, body: t.body })),
    suggestedEvent: suggested,
    preview: rendered.body,
    images: rendered.media,
  };
}

/** Re-render a template with placeholder values, for the composer's live preview. */
export async function previewText(body: string, sample: Record<string, string>): Promise<string> {
  return clampText(renderTemplate(String(body || ""), sample), 4000);
}
