const MAX_STOCK = 2_147_483_647; // Prisma Int / PostgreSQL INTEGER
const MAX_COST = 1_000_000_000;
export class StockAdjustmentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function numeric(value: unknown, field: string): number {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim()) || !Number.isFinite(Number(value))) {
    throw new StockAdjustmentError(`${field} must be a number`);
  }
  return Number(value);
}

export function parseStockAdjustment(body: unknown): { productId: number; qty: number; mode: "add" | "set"; unitCost: number | null; note: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new StockAdjustmentError("Invalid stock adjustment");
  const b = body as Record<string, unknown>;
  const productId = numeric(b.productId, "Product ID");
  if (!Number.isSafeInteger(productId) || productId < 1 || productId > MAX_STOCK) throw new StockAdjustmentError("Pick a valid product");
  const mode = b.mode === undefined ? "add" : b.mode;
  if (mode !== "add" && mode !== "set") throw new StockAdjustmentError("Mode must be add or set");
  const qty = numeric(b.qty, "Quantity");
  if (!Number.isSafeInteger(qty) || Math.abs(qty) > MAX_STOCK) throw new StockAdjustmentError("Quantity must be a whole number within the stock limit");
  if (mode === "add" && qty === 0) throw new StockAdjustmentError("Quantity to add must be non-zero");
  if (mode === "set" && qty < 0) throw new StockAdjustmentError("Counted stock cannot be negative");
  let unitCost: number | null = null;
  if (b.unitCost != null && !(typeof b.unitCost === "string" && !b.unitCost.trim())) {
    unitCost = numeric(b.unitCost, "Unit cost");
    if (unitCost < 0 || unitCost > MAX_COST) throw new StockAdjustmentError("Unit cost must be a non-negative amount within the cost limit");
  }
  if (b.note != null && typeof b.note !== "string") throw new StockAdjustmentError("Note must be text");
  return { productId, qty, mode, unitCost, note: typeof b.note === "string" ? b.note.slice(0, 120) : "" };
}

export function adjustedStock(current: number, mode: "add" | "set", qty: number): number {
  const next = mode === "set" ? qty : current + qty;
  if (!Number.isSafeInteger(next) || next < 0 || next > MAX_STOCK) throw new StockAdjustmentError(`Stock must stay between 0 and ${MAX_STOCK}. Current stock: ${current}.`);
  return next;
}
