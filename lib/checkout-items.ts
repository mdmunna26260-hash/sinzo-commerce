import { roundMoney } from "./checkout-pricing";

export class CheckoutValidationError extends Error {}
export type CheckoutLine = { productId: number; variantId: number | null; qty: number };
type Product = {
  id: number; title: string; price: number; stock: number; preorder?: boolean; preorderDate?: Date | string | null;
  variants: { id: number; size?: string | null; color?: string | null; price?: number | null; stock: number }[];
  images?: { url: string; position?: number }[];
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

export function buildCheckoutItems(lines: CheckoutLine[], products: Product[], options: { checkStock?: boolean } = {}) {
  const productQuantities = new Map<number, number>();
  let subtotal = 0;
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
    const price = variant?.price ?? product.price;
    if (!Number.isFinite(price) || price < 0) throw new CheckoutValidationError(`${product.title} is currently unavailable`);
    subtotal = roundMoney(subtotal + price * line.qty);
    if (!Number.isFinite(subtotal) || subtotal > 1_000_000_000) throw new CheckoutValidationError("Order amount exceeds the allowed limit");
    const image = [...(product.images || [])].sort((a, b) => (a.position || 0) - (b.position || 0))[0]?.url || null;
    return {
      productId: product.id, variantId: variant?.id ?? null, title: product.title,
      variant: variant ? [variant.size, variant.color].filter(Boolean).join(" · ") : null,
      price, qty: line.qty, image, preorder: !!product.preorder,
      preorderDate: product.preorderDate ? new Date(product.preorderDate) : null,
    };
  });
  return { items, subtotal };
}
