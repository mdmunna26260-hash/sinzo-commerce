import type { Prisma, AbandonedCheckout } from "@prisma/client";
import { parseCheckoutLines, buildCheckoutItems, CheckoutValidationError, type CheckoutLine } from "./checkout-items";
import { normalizeBDPhone, isValidBDPhone } from "./phone";
import { checkoutTotals } from "./checkout-pricing";
import { validateCoupon, CouponValidationError } from "./coupons";
import { readRecoveryToken, matchesRecoverySubject } from "./recovery-security";

export class RecoveryError extends CheckoutValidationError {
  constructor(message: string, public status = 400) { super(message); }
}
export type SavedCart = { version: 2; items: CheckoutLine[]; area: "INSIDE_DHAKA" | "OUTSIDE_DHAKA"; notes: string; couponCode: string | null };
export function validateRecoveryContact(raw: any) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RecoveryError("Invalid checkout details");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const phone = typeof raw.phone === "string" ? normalizeBDPhone(raw.phone) : "";
  const address = typeof raw.address === "string" ? raw.address.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (name.length < 3 || name.length > 80 || !isValidBDPhone(phone) || address.length < 10 || address.length > 1000) throw new RecoveryError("Complete your name, valid phone and delivery address");
  if (raw.email && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new RecoveryError("Enter a valid email address");
  return { name, phone, address, email: email || null };
}
export function cartMetadata(raw: any): Omit<SavedCart, "version" | "items"> {
  if (raw.area !== "INSIDE_DHAKA" && raw.area !== "OUTSIDE_DHAKA") throw new RecoveryError("Select a delivery zone");
  if (raw.notes !== undefined && typeof raw.notes !== "string") throw new RecoveryError("Invalid checkout notes");
  if (raw.couponCode != null && (typeof raw.couponCode !== "string" || raw.couponCode.length > 64 || /[\r\n]/.test(raw.couponCode))) throw new RecoveryError("Invalid coupon code");
  return { area: raw.area, notes: (raw.notes || "").trim().slice(0, 2000), couponCode: raw.couponCode?.trim().toUpperCase() || null };
}
export function readSavedCart(cartJson: string): SavedCart {
  let raw;
  try { if (cartJson.length > 200_000) throw new Error(); raw = JSON.parse(cartJson); } catch { throw new RecoveryError("Saved cart is invalid; please rebuild your cart"); }
  if (!raw || Array.isArray(raw) || raw.version !== 2) throw new RecoveryError("This older checkout has no trusted product/variant references. Ask the customer to start checkout again.");
  return { version: 2, items: parseCheckoutLines(raw.items), ...cartMetadata(raw) };
}
export function displaySavedItems(cartJson: string): any[] {
  try { const raw = JSON.parse(cartJson); return Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : []; } catch { return []; }
}
export async function lockAbandoned(tx: Prisma.TransactionClient, id: number) {
  const placeholder = (process.env.DATABASE_URL || "").startsWith("postgres") ? "$1" : "?";
  await tx.$executeRawUnsafe(`UPDATE "AbandonedCheckout" SET "id" = "id" WHERE "id" = ${placeholder}`, id);
}
export async function verifyRecovery(tx: Pick<Prisma.TransactionClient, "abandonedCheckout">, token: unknown) {
  const p = readRecoveryToken(token);
  if (!p) throw new RecoveryError("Recovery link is invalid or expired", 410);
  const row = await tx.abandonedCheckout.findUnique({ where: { id: p.id } });
  if (!row || !matchesRecoverySubject(p, row)) throw new RecoveryError("Recovery link is invalid or expired", 410);
  if (row.checkoutStatus !== "OPEN" || row.convertedOrderId !== null) throw new RecoveryError("This checkout has already been handled", 410);
  return { row, couponCode: p.coupon || null };
}
export async function cartProducts(tx: Pick<Prisma.TransactionClient, "product">, lines: CheckoutLine[]) {
  return tx.product.findMany({ where: { id: { in: [...new Set(lines.map(l => l.productId))] }, status: "ACTIVE" }, include: { variants: true, images: { orderBy: { position: "asc" } } } });
}
export async function quoteSavedCart(tx: Prisma.TransactionClient | any, row: AbandonedCheckout, settings: any, couponOverride?: string | null, consume = false) {
  const saved = readSavedCart(row.cartJson);
  const contact = validateRecoveryContact(row);
  const products = await cartProducts(tx, saved.items);
  const { items, subtotal } = buildCheckoutItems(saved.items, products);
  const code = couponOverride || saved.couponCode;
  let applied = null;
  if (code) {
    if (consume) {
      const lock = await tx.coupon.updateMany({ where: { code, active: true }, data: { usedCount: { increment: 0 } } });
      if (!lock.count) throw new CouponValidationError("Invalid coupon code");
    }
    applied = await validateCoupon(tx, await tx.coupon.findUnique({ where: { code } }), subtotal, contact.phone);
    if (consume) await tx.coupon.update({ where: { code }, data: { usedCount: { increment: 1 } } });
  }
  const totals = checkoutTotals({ subtotal, discount: applied?.discount, freeship: applied?.freeship, area: saved.area, shipping: settings.shipping });
  return { saved, contact, items, subtotal, applied, totals, products };
}
/* Restore only current, real SKUs. Explicit warnings accompany any removal or
   stock-driven quantity reduction; stale captured prices are never trusted. */
export function restoredLines(saved: SavedCart, products: Awaited<ReturnType<typeof cartProducts>>) {
  const warnings: string[] = [], remaining = new Map<number, number>();
  const lines = saved.items.flatMap(line => {
    const p = products.find(p => p.id === line.productId);
    const v = p?.variants.find(v => v.id === line.variantId);
    if (!p || (line.variantId !== null && !v) || (p.variants.length && !v)) { warnings.push("A saved item/variant is no longer available and was removed."); return []; }
    const available = p.preorder ? 99 : Math.max(0, Math.min(remaining.get(p.id) ?? p.stock, v?.stock ?? p.stock));
    const qty = Math.min(line.qty, available);
    if (!qty) { warnings.push(`${p.title} is out of stock and was removed.`); return []; }
    if (qty !== line.qty) warnings.push(`${p.title}: quantity changed from ${line.qty} to ${qty} because stock changed.`);
    remaining.set(p.id, (remaining.get(p.id) ?? p.stock) - qty);
    const price = v?.price ?? p.price;
    if (!Number.isFinite(price) || price < 0) { warnings.push(`${p.title} is unavailable and was removed.`); return []; }
    return [{ key: `${p.id}:${v?.id || 0}`, productId: p.id, ...(v ? { variantId: v.id } : {}), title: p.title, slug: p.slug, price, qty, stock: available, image: p.images[0]?.url, size: v?.size || undefined, color: v?.color || undefined, preorder: !!p.preorder }];
  });
  return { lines, warnings };
}
export function escapeEmail(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function prepareRecoveredCart(tx: Prisma.TransactionClient | any, row: AbandonedCheckout, settings: any, couponOverride?: string | null) {
  const saved = readSavedCart(row.cartJson);
  const contact = validateRecoveryContact(row);
  const products = await cartProducts(tx, saved.items);
  const restored = restoredLines(saved, products);
  const oldItems = displaySavedItems(row.cartJson);
  for (const line of restored.lines) {
    const old = oldItems.find(i => i.productId === line.productId && (i.variantId || 0) === (line.variantId || 0));
    if (old && old.price !== line.price) restored.warnings.push(`${line.title}: price changed; the current price is shown.`);
  }
  const subtotal = restored.lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const code = couponOverride || saved.couponCode;
  let applied = null;
  if (code && restored.lines.length) {
    try { applied = await validateCoupon(tx, await tx.coupon.findUnique({ where: { code } }), subtotal, contact.phone); }
    catch (e) { if (!(e instanceof CouponValidationError)) throw e; restored.warnings.push("The recovery coupon is no longer eligible. No discount has been applied."); }
  }
  const totals = checkoutTotals({ subtotal, discount: applied?.discount, freeship: applied?.freeship, area: saved.area, shipping: settings.shipping });
  return { ...restored, contact: { ...contact, area: saved.area }, notes: saved.notes, couponCode: code, applied, totals };
}
