/* Free-gift rule — server-authoritative.

   Settings key "gift":
     { enabled, tiers: [{ amount, freeQty }], productIds: number[], excludeProductIds: number[] }

   Rule (per user spec): RAW subtotal (before combo/bundle discounts) of cart lines,
   excluding `excludeProductIds` and any free-gift line itself, must reach `amount` →
   customer may choose up to `freeQty` items from the admin-selected gift pool at ৳0.
   Higher tiers give more free items (2500 → 1 free, 5000 → 2 free, …). */

export type GiftTier = { amount: number; freeQty: number };
export type GiftRule = { enabled?: boolean; tiers: GiftTier[]; productIds: number[]; excludeProductIds: number[] };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function normalizeGiftRule(raw: any): GiftRule {
  const tiers: GiftTier[] = [];
  const seen = new Set<number>();
  for (const t of Array.isArray(raw?.tiers) ? raw.tiers : []) {
    const amount = Number(t?.amount);
    const freeQty = Number(t?.freeQty);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) continue;
    if (!Number.isSafeInteger(freeQty) || freeQty < 1 || freeQty > 10) continue;
    if (!seen.has(round2(amount))) { seen.add(round2(amount)); tiers.push({ amount: round2(amount), freeQty }); }
  }
  tiers.sort((a, b) => a.amount - b.amount);
  const ids = (v: any) => [...new Set((Array.isArray(v) ? v : []).map((x: any) => Number(x)).filter((n: number) => Number.isSafeInteger(n) && n > 0))];
  return {
    enabled: raw?.enabled !== false,
    tiers: tiers.slice(0, 10),
    productIds: ids(raw?.productIds).slice(0, 100),
    excludeProductIds: ids(raw?.excludeProductIds).slice(0, 500),
  };
}

/* How many free items the customer is entitled to for a given eligible subtotal. */
export function giftEntitlement(eligibleSubtotal: number, rule: unknown): number {
  const r = normalizeGiftRule(rule);
  if (!r.enabled || !r.tiers.length) return 0;
  let qty = 0;
  for (const t of r.tiers) if (eligibleSubtotal >= t.amount) qty = Math.max(qty, t.freeQty);
  return qty;
}
