export type CouponPricing = { type: string; value: number; maxDiscount?: number | null };
export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export function nonNegativeAmount(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : fallback;
}

export function couponDiscount(subtotal: number, coupon?: CouponPricing | null): number {
  if (!coupon) return 0;
  const value = nonNegativeAmount(coupon.value);
  let discount = coupon.type === "percent" ? subtotal * value / 100 : coupon.type === "fixed" ? value : 0;
  if (coupon.maxDiscount != null) discount = Math.min(discount, nonNegativeAmount(coupon.maxDiscount));
  return roundMoney(Math.max(0, Math.min(subtotal, discount)));
}

/* One calculation for the browser and the order API. A threshold of zero means
   the promotion is DISABLED, not that every order gets free shipping. Zero
   delivery fees are valid settings. */
export function checkoutTotals(input: {
  subtotal: number; discount?: number; area: string; shipping?: Record<string, any>;
  freeship?: boolean; outsideOverride?: number | null;
}) {
  const { shipping = {} } = input;
  const subtotal = nonNegativeAmount(input.subtotal);
  const discount = Math.min(subtotal, nonNegativeAmount(input.discount));
  const threshold = nonNegativeAmount(shipping.freeShippingThreshold);
  /* Per-product override: if any cart product sets its own OUTSIDE_DHAKA fee, the highest
     one wins over the global setting (caller passes the max). Null/0 = use the default. */
  const override = input.outsideOverride != null ? nonNegativeAmount(input.outsideOverride, 0) : 0;
  const fee = input.area === "INSIDE_DHAKA"
    ? nonNegativeAmount(shipping.insideDhaka, 80)
    : (override > 0 ? override : nonNegativeAmount(shipping.outsideDhaka, 140));
  const deliveryFee = input.freeship || (threshold > 0 && subtotal - discount >= threshold) ? 0 : fee;
  const total = roundMoney(subtotal - discount + deliveryFee);
  return { subtotal, discount, deliveryFee, total };
}

/* Highest per-product OUTSIDE_DHAKA delivery override in a cart (null when none set). */
export function maxOutsideDeliveryOverride(products: Array<{ outsideDeliveryFee?: number | null }> | null | undefined): number | null {
  if (!products?.length) return null;
  let max: number | null = null;
  for (const p of products) {
    const v = Number((p as any)?.outsideDeliveryFee);
    if (Number.isFinite(v) && v > 0 && (max === null || v > max)) max = v;
  }
  return max;
}
