/* Quantity combo offers ("2 ta 1600, 3 ta 2300") — one pure module shared by the
   storefront (cart/checkout display), the order API (authoritative pricing) and tests.

   A product's `comboOffers` column holds a JSON string like:
     [{"qty":2,"total":1600},{"qty":3,"total":2300}]
   meaning: 2 of the item cost 1600 in total, 3 cost 2300 in total. Tiers must be
   worse-or-equal per unit than the base price to make sense, but we never trust that:
   comboQuote() always takes the cheaper of base price vs. every reachable tier, so a
   misconfigured tier can never INCREASE the price. */

export type ComboOffer = { qty: number; total: number };

export const MAX_COMBO_TIERS = 10;

/* Accepts a JSON string (DB column), a parsed array, or null → clean, sorted, deduped tiers. */
export function normalizeComboOffers(raw: unknown): ComboOffer[] {
  let value: unknown = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try { value = JSON.parse(trimmed); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  const seen = new Map<number, number>();
  for (const item of value.slice(0, MAX_COMBO_TIERS * 4)) {
    if (!item || typeof item !== "object") continue;
    const qty = Number((item as any).qty);
    const total = Number((item as any).total);
    if (!Number.isSafeInteger(qty) || qty < 2 || qty > 99) continue; // qty 1 = base price, never a "combo"
    if (!Number.isFinite(total) || total < 0 || total > 1_000_000_000) continue;
    if (!seen.has(qty)) seen.set(qty, Math.round(total * 100) / 100); // first row wins on duplicate qty
  }
  return [...seen.entries()]
    .map(([qty, total]) => ({ qty, total }))
    .sort((a, b) => a.qty - b.qty)
    .slice(0, MAX_COMBO_TIERS);
}

export function serializeComboOffers(offers: ComboOffer[]): string | null {
  const clean = normalizeComboOffers(offers);
  return clean.length ? JSON.stringify(clean) : null;
}

export type ComboQuote = { subtotal: number; savings: number; tierQty: number | null };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* Best price for `qty` units of one product at `unitPrice` with the given tiers.
   A tier covers tier.qty items for tier.total; leftover items are charged at unitPrice.
   Multiple tiers can combine implicitly because we take the min over every reachable
   tier (and the no-combo base), which is optimal for this pricing shape. */
export function comboQuote(unitPrice: number, qty: number, offers: unknown): ComboQuote {
  const base = round2(unitPrice * qty);
  if (!Number.isFinite(base)) return { subtotal: 0, savings: 0, tierQty: null };
  let best = base;
  let tierQty: number | null = null;
  for (const t of normalizeComboOffers(offers)) {
    if (t.qty > qty) continue;
    const candidate = round2(t.total + (qty - t.qty) * unitPrice);
    if (candidate < best) { best = candidate; tierQty = t.qty; }
  }
  return { subtotal: best, savings: round2(base - best), tierQty };
}

/* Cart-level quote: lines of the same product combine toward one combo (sizes/colors
   don't break the combo — "3 ta item" means 3 units of that product). */
export function cartComboQuote(lines: { productId: number; price: number; qty: number; comboOffers?: unknown; comboEligible?: boolean }[], bundles?: unknown, deptTiers?: unknown): { subtotal: number; savings: number } {
  const groups = new Map<number, { qty: number; base: number; offers: unknown; unit: number }>();
  for (const l of lines) {
    const g = groups.get(l.productId) || { qty: 0, base: 0, offers: l.comboOffers, unit: l.price };
    g.qty += l.qty || 1;
    g.base += (l.qty || 1) * l.price;
    g.unit = l.price; // reference unit price = product base price snapshot on the line
    groups.set(l.productId, g);
  }
  let subtotal = 0, savings = 0;
  for (const g of groups.values()) {
    const q = comboQuote(g.unit, g.qty, g.offers);
    subtotal = round2(subtotal + q.subtotal);
    savings = round2(savings + q.savings);
  }
  // cross-product bundle: if every product of an active bundle has >=1 in the cart,
  // ONE unit of each is priced at the bundle total instead of base. Only the single
  // best (max-saving) bundle applies, so overlapping bundles never double-dip.
  const b = bestBundleSavings(lines, bundles);
  subtotal = round2(subtotal - b);
  savings = round2(savings + b);
  // department rule: count units of combo-eligible lines only
  const deptUnits = lines.reduce((s, l) => s + (l.comboEligible ? (l.qty || 1) : 0), 0);
  const d = deptDiscount(deptUnits, deptTiers);
  return { subtotal: round2(subtotal - d), savings: round2(savings + d) };
}

export type ComboBundleLike = { id?: number; price: number; active?: boolean; products?: unknown; productIds?: unknown };

export function normalizeBundles(raw: unknown): { id: number | null; price: number; productIds: number[] }[] {
  if (!Array.isArray(raw)) return [];
  const out: { id: number | null; price: number; productIds: number[] }[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const bb = b as any;
    if (bb.active === false) continue;
    const price = Number(bb.price);
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) continue;
    const idsRaw = Array.isArray(bb.productIds) ? bb.productIds : Array.isArray(bb.products) ? bb.products : [];
    const productIds: number[] = [...new Set<number>(idsRaw.map((x: any) => Number(typeof x === "object" && x ? x.productId ?? x.id : x)).filter((n: number) => Number.isSafeInteger(n) && n > 0))];
    if (productIds.length < 2) continue; // a "bundle" of one product is just a sale price
    out.push({ id: Number.isSafeInteger(Number(bb.id)) ? Number(bb.id) : null, price: round2(price), productIds });
  }
  return out;
}

/* Savings if the best applicable bundle is applied: sum of one base unit of each bundle
   product minus the bundle price, only when positive and every product is in the cart. */
export function bestBundleSavings(lines: { productId: number; price: number; qty: number }[], bundles: unknown): number {
  const inCart = new Map<number, number>();
  for (const l of lines) inCart.set(l.productId, (inCart.get(l.productId) || 0) + (l.qty || 1));
  const unit = new Map<number, number>();
  for (const l of lines) if (!unit.has(l.productId)) unit.set(l.productId, l.price);
  let best = 0;
  for (const b of normalizeBundles(bundles)) {
    if (!b.productIds.every((id) => (inCart.get(id) || 0) >= 1)) continue;
    const base = b.productIds.reduce((s, id) => s + (unit.get(id) || 0), 0);
    const save = round2(base - b.price);
    if (save > best) best = save;
  }
  return best;
}

/* ── Department-level combo rule ────────────────────────────────
   Settings key "combo": { enabled, deptTiers: [{qty, discount}] }.
   Rule: total UNITS of combo-department (comboEligible) products in the cart —
   1 unit = no discount, 2 units = discount of tier qty2, 3 units = tier qty3, etc.
   Best (max) reachable tier wins; amounts are DISCOUNTS (not totals), admin-set. */
export type DeptTier = { qty: number; discount: number };

export function normalizeDeptTiers(raw: unknown): DeptTier[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<number, number>();
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const qty = Number((item as any).qty);
    const discount = Number((item as any).discount);
    if (!Number.isSafeInteger(qty) || qty < 2 || qty > 99) continue;
    if (!Number.isFinite(discount) || discount < 0 || discount > 1_000_000_000) continue;
    if (!seen.has(qty)) seen.set(qty, round2(discount));
  }
  return [...seen.entries()].map(([qty, discount]) => ({ qty, discount })).sort((a, b) => a.qty - b.qty).slice(0, 10);
}

export function deptDiscount(totalComboUnits: number, tiers: unknown): number {
  let best = 0;
  for (const t of normalizeDeptTiers(tiers)) {
    if (t.qty <= totalComboUnits && t.discount > best) best = t.discount;
  }
  return best;
}
