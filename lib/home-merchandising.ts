export type HomeMerchProduct = {
  id: number;
  price: number;
  comparePrice: number | null;
  stock: number;
  lowStock?: number | null;
  badge?: string | null;
  position?: number | null;
  preorder?: boolean;
};

export function discountPercent(product: Pick<HomeMerchProduct, "price" | "comparePrice">): number {
  const compare = Number(product.comparePrice);
  const price = Number(product.price);
  if (!Number.isFinite(price) || !Number.isFinite(compare) || price < 0 || compare <= price) return 0;
  return Math.max(1, Math.min(99, Math.round((1 - price / compare) * 100)));
}

export function pickDiscountProducts<T extends HomeMerchProduct>(products: T[], limit = 8): T[] {
  return products
    .filter((product) => (product.preorder || product.stock > 0) && discountPercent(product) > 0)
    .sort((a, b) => discountPercent(b) - discountPercent(a)
      || ((b.comparePrice || b.price) - b.price) - ((a.comparePrice || a.price) - a.price)
      || (a.position || 0) - (b.position || 0)
      || a.id - b.id)
    .slice(0, Math.max(0, limit));
}

export function pickLimitedProducts<T extends HomeMerchProduct>(products: T[], limit = 8): T[] {
  const available = products
    .filter((product) => !product.preorder && Number.isFinite(product.stock) && product.stock > 0)
    .sort((a, b) => a.stock - b.stock || (a.position || 0) - (b.position || 0) || a.id - b.id);
  const genuinelyLimited = available.filter((product) =>
    String(product.badge || "").toLowerCase() === "limited"
    || product.stock <= Math.max(15, Number(product.lowStock) || 0));
  // Never manufacture urgency. If no live inventory is genuinely low (and no
  // item is explicitly marked limited), the homepage omits this shelf.
  return genuinelyLimited.slice(0, Math.max(0, limit));
}
