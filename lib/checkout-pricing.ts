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
   delivery fees are valid settings, and gift-wrap fees are configurable. */
export function checkoutTotals(input: {
  subtotal: number; discount?: number; area: string; shipping?: Record<string, any>;
  checkout?: Record<string, any>; giftWrap?: boolean; freeship?: boolean;
}) {
  const { shipping = {}, checkout = {} } = input;
  const subtotal = nonNegativeAmount(input.subtotal);
  const discount = Math.min(subtotal, nonNegativeAmount(input.discount));
  const threshold = nonNegativeAmount(shipping.freeShippingThreshold);
  const fee = input.area === "INSIDE_DHAKA"
    ? nonNegativeAmount(shipping.insideDhaka, 80)
    : nonNegativeAmount(shipping.outsideDhaka, 140);
  const deliveryFee = input.freeship || (threshold > 0 && subtotal - discount >= threshold) ? 0 : fee;
  const giftWrapFee = input.giftWrap ? nonNegativeAmount(checkout.giftWrapFee, 60) : 0;
  const total = roundMoney(subtotal - discount + deliveryFee + giftWrapFee);
  return { subtotal, discount, deliveryFee, giftWrapFee, total };
}
