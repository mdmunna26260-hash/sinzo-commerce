import { roundMoney } from "./checkout-pricing";
import { comboQuote, normalizeComboOffers, bestBundleSavings, normalizeBundles } from "./combo";

export class CheckoutValidationError extends Error {}
export type CheckoutLine = { productId: number; variantId: number | null; qty: number };
type Product = {
  id: number; title: string; price: number; stock: number; preorder?: boolean; preorderDate?: Date | string | null;
  variants: { id: number; size?: string | null; color?: string | null; price?: number | null; stock: number }[];
  images?: { url: string; position?: number }[];
  comboOffers?: unknown; // JSON string column — parsed by normalizeComboOffers
  comboEligible?: boolean; // "combo department" flag — offers apply only to these products
};

const integerInput = (value: unknown): boolean => typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value));

export function parseCheckoutLines(raw: unknown): CheckoutLine[] {
  if (!Array.isArray(raw) || !raw.length) throw new CheckoutValidationError("Your cart is empty");
  if (raw.length > 50) throw new CheckoutValidationError("Too many items in your cart");
  const lines = new Map<string, CheckoutLine>();
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new CheckoutValidationError("Invalid cart item");
    const productId = Number(item.productId);
    const variantId = item.variantId == null ? null : Number(item.variantId);
    const qty = item.qty === undefined ? 1 : Number(item.qty);
    if (!integerInput(item.productId) || (item.variantId != null && !integerInput(item.variantId)) || (item.qty !== undefined && !integerInput(item.qty))) throw new CheckoutValidationError("Invalid product, variant, or quantity");
    if (!Number.isSafeInteger(productId) || productId <= 0 || (variantId !== null && (!Number.isSafeInteger(variantId) || variantId <= 0))) {
      throw new CheckoutValidationError("Invalid product or variant");
    }
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 99) throw new CheckoutValidationError("Quantity must be a whole number between 1 and 99");
    const key = `${productId}:${variantId || 0}`;
    const previous = lines.get(key);
    const combined = qty + (previous?.qty || 0);
    if (combined > 99) throw new CheckoutValidationError("Quantity must be a whole number between 1 and 99");
    lines.set(key, { productId, variantId, qty: combined });
  }
  return [...lines.values()];
}

export function buildCheckoutItems(lines: CheckoutLine[], products: Product[], options: { checkStock?: boolean; bundles?: unknown } = {}) {
  const productQuantities = new Map<number, number>();
  // quantity combo ("2 ta 1600"): all lines of one product combine toward one tier,
  // priced against the product base price; the effective per-unit price is spread
  // evenly across that product's lines so order rows stay consistent.
  // Tiers apply ONLY to products flagged comboEligible ("combo department").
  const comboUnit = new Map<number, number>(); // productId → effective unit price after combo
  const groupQuote = new Map<number, number>(); // productId → EXACT combo subtotal for the whole group
  const seen = new Set<number>();
  for (const line of lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product) throw new CheckoutValidationError("A product in your cart is no longer available");
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    const totalQty = lines.filter((l) => l.productId === product.id).reduce((s, l) => s + l.qty, 0);
    const offers = product.comboEligible ? normalizeComboOffers(product.comboOffers) : [];
    const quote = comboQuote(product.price, totalQty, offers);
    // never charge more than the raw base sum (e.g. a zero-price variant line)
    const baseSum = lines.filter((l) => l.productId === product.id)
      .reduce((s, l) => {
        const v = l.variantId === null ? null : product.variants.find((vv) => vv.id === l.variantId);
        return s + (v?.price ?? product.price) * l.qty;
      }, 0);
    groupQuote.set(product.id, Math.min(quote.subtotal, roundMoney(baseSum)));
    comboUnit.set(product.id, totalQty > 0 ? quote.subtotal / totalQty : product.price);
  }
  let baseTotal = 0;
  const items = lines.map((line) => {
    const product = products.find((p) => p.id === line.productId);
    if (!product) throw new CheckoutValidationError("A product in your cart is no longer available");
    const variant = line.variantId === null ? null : product.variants.find((v) => v.id === line.variantId);
    if (line.variantId !== null && !variant) throw new CheckoutValidationError(`The selected variant of ${product.title} is no longer available`);
    if (product.variants.length && !variant) throw new CheckoutValidationError(`Please select a size/color for ${product.title}`);
    const qtyForProduct = (productQuantities.get(product.id) || 0) + line.qty;
    productQuantities.set(product.id, qtyForProduct);
    if (options.checkStock !== false && !product.preorder && (qtyForProduct > product.stock || (variant && line.qty > variant.stock))) {
      throw new CheckoutValidationError(`Not enough stock for ${product.title}. Please update your cart.`);
    }
    const basePrice = variant?.price ?? product.price;
    if (!Number.isFinite(basePrice) || basePrice < 0) throw new CheckoutValidationError(`${product.title} is currently unavailable`);
    // combo tiers are defined on the product base price; a variant priced differently
    // still gets the same proportional per-unit rate within its product group.
    const effUnit = comboUnit.get(product.id) ?? basePrice;
    const price = basePrice <= 0 ? 0 : roundMoney(product.price > 0 ? effUnit * (basePrice / product.price) : effUnit);
    baseTotal = roundMoney(baseTotal + basePrice * line.qty);
    const image = [...(product.images || [])].sort((a, b) => (a.position || 0) - (b.position || 0))[0]?.url || null;
    return {
      productId: product.id, variantId: variant?.id ?? null, title: product.title,
      variant: variant ? [variant.size, variant.color].filter(Boolean).join(" · ") : null,
      price, qty: line.qty, image, preorder: !!product.preorder,
      preorderDate: product.preorderDate ? new Date(product.preorderDate) : null,
    };
  });
  // subtotal from EXACT group quotes (not Σ rounded line prices) → no 0.01 drift;
  // line prices are display values, adjusted so they still sum to the group quote.
  const groupLineSum = new Map<number, number>();
  for (const it of items) groupLineSum.set(it.productId, roundMoney((groupLineSum.get(it.productId) || 0) + it.price * it.qty));
  for (const it of items) {
    const exact = groupQuote.get(it.productId);
    if (exact == null) continue;
    const sum = groupLineSum.get(it.productId) || 0;
    const diff = roundMoney(exact - sum);
    if (diff !== 0 && Math.abs(diff) < 1) {
      it.price = roundMoney(it.price + diff / it.qty);
      groupLineSum.set(it.productId, exact);
    }
  }
  let subtotal = [...groupQuote.values()].reduce((s, v) => roundMoney(s + v), 0);
  if (!Number.isFinite(subtotal) || subtotal > 1_000_000_000) throw new CheckoutValidationError("Order amount exceeds the allowed limit");
  const comboSavings = roundMoney(Math.max(0, baseTotal - subtotal));

  // cross-product bundle: if every product of an active bundle has >=1 in the cart,
  // ONE unit of each is priced at the bundle total instead of base. Only bundles whose
  // products are ALL comboEligible qualify; only the single best bundle applies.
  const eligibleBundles = normalizeBundles(options.bundles).filter((b) =>
    b.productIds.every((id) => products.find((p) => p.id === id)?.comboEligible));
  let bundleSavings = 0;
  if (eligibleBundles.length) {
    // bundle compared against BASE product prices (not tier-adjusted) so the two
    // discounts stack cleanly instead of double-counting the reduced unit price.
    const baseLines = [...new Set(items.map((i) => i.productId))].map((id) => {
      const p = products.find((pp) => pp.id === id)!;
      const qty = items.filter((i) => i.productId === id).reduce((s, i) => s + i.qty, 0);
      return { productId: id, price: p.price, qty };
    });
    bundleSavings = bestBundleSavings(baseLines, eligibleBundles);
    subtotal = roundMoney(subtotal - bundleSavings);
  }
  return { items, subtotal, comboSavings: roundMoney(Math.max(0, comboSavings + bundleSavings)) };
}
