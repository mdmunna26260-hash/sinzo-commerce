import { db } from "./db";
import { toWaId, validWaId, waPretty } from "./wa-queue";
import type { SettingsMap } from "./settings";

/* WhatsApp audience builder (Phase 3).

   An audience is a small JSON rule the owner picks in the campaign composer. Resolving it means:
   pull the matching customers out of real data (orders, waitlist, consent flags) → drop duplicate
   numbers → drop invalid numbers → drop anyone who wrote STOP → drop anyone who already got a
   message recently (optional) → and only then report the count that will actually receive the
   campaign. The same function feeds the live "kotojon jabe" counter and the send itself, so what
   the owner sees is exactly who gets it. */

export const WA_AUDIENCES = [
  "all_customers", "recent_buyers", "product_buyers", "collection_buyers", "high_spenders",
  "area", "waitlist", "opted_in", "cancelled_only", "csv",
] as const;
export type WaAudienceType = (typeof WA_AUDIENCES)[number];

export const WA_AUDIENCE_LABELS: Record<WaAudienceType, string> = {
  all_customers: "সব customer (order করা সবাই)",
  recent_buyers: "সাম্প্রতিক buyer (শেষ N দিনে)",
  product_buyers: "নির্দিষ্ট product কেনা buyer",
  collection_buyers: "নির্দিষ্ট collection কেনা buyer",
  high_spenders: "বেশি খরচ করা buyer",
  area: "এলাকাভিত্তিক (ঢাকার ভিতরে/বাইরে)",
  waitlist: "Waitlist (stock চেয়েছিল)",
  opted_in: "Opt-in করা (marketing-এ রাজি)",
  cancelled_only: "শুধু cancelled order-এর customer",
  csv: "নিজের CSV list",
};

export type WaAudienceRule = {
  type: WaAudienceType;
  days?: number;                 // recent_buyers
  productId?: number | null;     // product_buyers
  collectionId?: number | null;  // collection_buyers
  minSpend?: number;             // high_spenders
  area?: string;                 // area — INSIDE_DHAKA | OUTSIDE_DHAKA
  optedInOnly?: boolean;         // default TRUE: marketing needs consent
  excludeRecentDays?: number;    // skip anyone messaged in the last N days
  csvPhones?: string[];          // csv
};

export type WaRecipient = { to: string; phone: string; name: string; orderId?: number | null };

export type WaAudienceExcluded = {
  notOptedIn: number;
  optedOut: number;
  invalid: number;
  duplicate: number;
  recent: number;
};

export type WaAudienceResult = {
  recipients: WaRecipient[];
  excluded: WaAudienceExcluded;
  rule: WaAudienceRule;
  description: string;
};

export const WA_AUDIENCE_DEFAULTS: WaAudienceRule = {
  type: "all_customers",
  days: 60,
  minSpend: 3000,
  area: "INSIDE_DHAKA",
  optedInOnly: true,
  excludeRecentDays: 0,
  csvPhones: [],
};

/** Normalising a rule that came from the browser (JSON column) — never trust its shape. */
export function audienceRule(raw: unknown): WaAudienceRule {
  let obj: any = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { obj = {}; }
  }
  obj = obj && typeof obj === "object" ? obj : {};
  const type: WaAudienceType = (WA_AUDIENCES as readonly string[]).includes(obj.type)
    ? (obj.type as WaAudienceType)
    : "all_customers";
  return {
    type,
    days: Math.max(1, Math.min(Number(obj.days) || WA_AUDIENCE_DEFAULTS.days!, 730)),
    productId: obj.productId ? Number(obj.productId) : null,
    collectionId: obj.collectionId ? Number(obj.collectionId) : null,
    minSpend: Math.max(0, Number(obj.minSpend) || WA_AUDIENCE_DEFAULTS.minSpend!),
    area: ["INSIDE_DHAKA", "OUTSIDE_DHAKA"].includes(String(obj.area)) ? String(obj.area) : "INSIDE_DHAKA",
    optedInOnly: obj.optedInOnly === undefined ? true : !!obj.optedInOnly,
    excludeRecentDays: Math.max(0, Math.min(Number(obj.excludeRecentDays) || 0, 365)),
    csvPhones: Array.isArray(obj.csvPhones) ? obj.csvPhones.map((p: any) => String(p)).slice(0, 10000) : [],
  };
}

export function describeRule(rule: WaAudienceRule): string {
  switch (rule.type) {
    case "recent_buyers": return `শেষ ${rule.days} দিনে যারা কিনেছে`;
    case "product_buyers": return `একটা নির্দিষ্ট product-এর buyer`;
    case "collection_buyers": return `একটা collection-এর buyer`;
    case "high_spenders": return `৳${rule.minSpend}+ খরচ করা buyer`;
    case "area": return rule.area === "INSIDE_DHAKA" ? "ঢাকার ভিতরের customer" : "ঢাকার বাইরের customer";
    case "waitlist": return "Waitlist-এ নাম দেওয়া মানুষ";
    case "opted_in": return "Marketing-এ opt-in করা customer";
    case "cancelled_only": return "শেষ order টা cancel হওয়া customer";
    case "csv": return `নিজের CSV list (${rule.csvPhones?.length || 0} number)`;
    default: return "সব customer";
  }
}

/** CSV (or pasted lines) → phone list. Accepts "name,phone" rows and bare numbers, any column order. */
export function parseCsvPhones(text: string): { phones: string[]; skipped: number } {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  let skipped = 0;
  for (const line of lines) {
    if (/^(name|phone|number|mobile|customer)\b/i.test(line) && out.length === 0) continue; // header
    const cols = line.split(/[,;\t]/).map((c) => c.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
    const phoneCell = cols.find((c) => c.replace(/\D/g, "").length >= 10) || cols[0] || "";
    const digits = phoneCell.replace(/\D/g, "");
    if (validWaId(toWaId(digits))) out.push(toWaId(digits));
    else skipped += 1;
  }
  return { phones: [...new Set(out)], skipped };
}

/** "01712…" / "8801712…" / "+880 1712…" all end up as one key, so the same person counts once. */
function keyOf(phone: string): string {
  return toWaId(phone);
}

export async function resolveAudience(rawRule: unknown): Promise<WaAudienceResult> {
  const rule = audienceRule(rawRule);
  const { ensureExtraTables } = await import("./db-ensure");
  await ensureExtraTables().catch(() => {});

  type Cand = { phone: string; name: string | null; orderId?: number | null };
  let candidates: Cand[] = [];
  const dropped: WaAudienceExcluded = { notOptedIn: 0, optedOut: 0, invalid: 0, duplicate: 0, recent: 0 };

  if (rule.type === "csv") {
    candidates = (rule.csvPhones || []).map((p) => ({ phone: p, name: null }));
  } else if (rule.type === "waitlist") {
    const rows = await db.waitlist.findMany({ orderBy: { id: "desc" }, take: 5000, select: { contact: true } }).catch(() => []);
    candidates = rows.map((r) => ({ phone: String(r.contact || ""), name: null }));
  } else if (rule.type === "opted_in") {
    const rows = await db.customer.findMany({ where: { waOptIn: true }, orderBy: { id: "desc" }, take: 20000, select: { phone: true, name: true } }).catch(() => []);
    candidates = rows.map((r) => ({ phone: r.phone, name: r.name }));
  } else {
    // order-derived audiences: newest order per phone wins (name/area/code come from it)
    const where: any = {};
    if (rule.type === "recent_buyers") {
      where.createdAt = { gte: new Date(Date.now() - (rule.days || 60) * 86400_000) };
      where.status = { notIn: ["CANCELLED"] };
    } else if (rule.type === "area") {
      where.area = rule.area;
      where.status = { notIn: ["CANCELLED"] };
    } else if (rule.type !== "cancelled_only") {
      where.status = { notIn: ["CANCELLED"] };
    }

    let productIds: number[] | null = null;
    if (rule.type === "product_buyers" && rule.productId) productIds = [rule.productId];
    if (rule.type === "collection_buyers" && rule.collectionId) {
      const links = await db.collectionProduct.findMany({ where: { collectionId: rule.collectionId }, select: { productId: true } }).catch(() => []);
      productIds = links.map((l) => l.productId);
      if (!productIds.length) productIds = [-1]; // no such collection → nobody
    }

    if (productIds) {
      const items = await db.orderItem.findMany({
        where: { productId: { in: productIds } },
        select: { order: { select: { id: true, phone: true, name: true, status: true } } },
        orderBy: { id: "desc" },
        take: 20000,
      }).catch(() => []);
      candidates = items
        .map((i) => i.order)
        .filter((o) => o && !["CANCELLED"].includes(o.status))
        .map((o) => ({ phone: o.phone, name: o.name, orderId: o.id }));
    } else {
      const orders = await db.order.findMany({ where, orderBy: { id: "desc" }, take: 20000, select: { id: true, phone: true, name: true, total: true, status: true } }).catch(() => []);
      if (rule.type === "cancelled_only") {
        const newest = new Map<string, { status: string; phone: string; name: string | null; id: number }>();
        for (const o of orders) {
          const k = keyOf(o.phone);
          if (!newest.has(k)) newest.set(k, { status: o.status, phone: o.phone, name: o.name, id: o.id });
        }
        candidates = [...newest.values()].filter((v) => v.status === "CANCELLED").map((v) => ({ phone: v.phone, name: v.name, orderId: v.id }));
      } else if (rule.type === "high_spenders") {
        const spend = new Map<string, { sum: number; phone: string; name: string | null; id: number }>();
        for (const o of orders) {
          if (o.status === "CANCELLED") continue;
          const k = keyOf(o.phone);
          const cur = spend.get(k);
          if (cur) cur.sum += Number(o.total) || 0;
          else spend.set(k, { sum: Number(o.total) || 0, phone: o.phone, name: o.name, id: o.id });
        }
        candidates = [...spend.values()].filter((v) => v.sum >= (rule.minSpend || 0)).map((v) => ({ phone: v.phone, name: v.name, orderId: v.id }));
      } else {
        // all_customers / recent_buyers / area — one row per phone, newest order first
        const seen = new Set<string>();
        for (const o of orders) {
          const k = keyOf(o.phone);
          if (seen.has(k)) continue;
          seen.add(k);
          candidates.push({ phone: o.phone, name: o.name, orderId: o.id });
        }
      }
    }
  }

  // dedupe by normalised number
  const byPhone = new Map<string, Cand>();
  for (const c of candidates) {
    const k = keyOf(c.phone);
    if (!k) continue;
    if (byPhone.has(k)) { dropped.duplicate += 1; continue; }
    byPhone.set(k, c);
  }

  // consent + STOP list + "already messaged recently" + validity
  const optIn = new Map<string, string>();
  if (rule.optedInOnly && rule.type !== "opted_in" && byPhone.size) {
    const rows = await db.customer.findMany({ where: { waOptIn: true }, select: { phone: true } }).catch(() => []);
    for (const r of rows) optIn.set(keyOf(r.phone), r.phone);
  }
  const optOut = new Set<string>();
  const stopRows = await db.waOptOut.findMany({ select: { waId: true } }).catch(() => []);
  for (const r of stopRows) optOut.add(keyOf(r.waId));

  let recentSet = new Set<string>();
  if (rule.excludeRecentDays && rule.excludeRecentDays > 0) {
    const since = new Date(Date.now() - rule.excludeRecentDays * 86400_000);
    const sent = await db.waMessage.findMany({ where: { queuedAt: { gte: since } }, select: { toWaId: true }, take: 20000 }).catch(() => []);
    recentSet = new Set(sent.map((m) => keyOf(m.toWaId)));
  }

  const recipients: WaRecipient[] = [];
  for (const [k, c] of byPhone) {
    const to = toWaId(c.phone);
    if (!validWaId(to)) { dropped.invalid += 1; continue; }
    if (optOut.has(k)) { dropped.optedOut += 1; continue; }
    if (rule.optedInOnly && rule.type !== "opted_in" && !optIn.has(k)) { dropped.notOptedIn += 1; continue; }
    if (recentSet.has(k)) { dropped.recent += 1; continue; }
    recipients.push({ to, phone: waPretty(to), name: String(c.name || "").trim(), orderId: c.orderId ?? null });
  }
  recipients.sort((a, b) => a.to.localeCompare(b.to));

  return { recipients, excluded: dropped, rule, description: describeRule(rule) };
}

/** The list an owner downloads to re-use elsewhere ("who did this segment actually pick"). */
export function audienceCsv(result: WaAudienceResult): string {
  const head = "name,phone,order_id";
  const rows = result.recipients.map((r) => `"${(r.name || "").replace(/"/g, '""')}",${r.phone},${r.orderId ?? ""}`);
  return [head, ...rows].join("\n");
}

/** Where a broadcast's short link lands when the owner did not pick a URL: the store itself. */
export function defaultLinkTarget(s: SettingsMap): string {
  const base = String((s as any)?.seo?.siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://sinzooffcial.com").replace(/\/+$/, "");
  return base;
}
