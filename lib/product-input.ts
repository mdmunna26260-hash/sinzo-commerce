const MAX_INT = 2_147_483_647;
const MAX_MONEY = 1_000_000_000;
const PRODUCT_STATUSES = new Set(["ACTIVE", "DRAFT", "ARCHIVED"]);
const SOLD_MODES = new Set(["fixed", "random"]);

export class ProductInputError extends Error {}

function objectBody(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProductInputError("Invalid product payload");
  return value as Record<string, any>;
}

function text(value: unknown, field: string, max: number, required = false): string | null {
  if (value == null || value === "") {
    if (required) throw new ProductInputError(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new ProductInputError(`${field} must be text`);
  const clean = value.replace(/\s+/g, " ").trim();
  if (required && !clean) throw new ProductInputError(`${field} is required`);
  if (clean.length > max) throw new ProductInputError(`${field} is too long`);
  return clean || null;
}

function longText(value: unknown, field: string, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ProductInputError(`${field} must be text`);
  const clean = value.trim();
  if (clean.length > max) throw new ProductInputError(`${field} is too long`);
  return clean || null;
}

function numberValue(value: unknown, field: string, options: { optional?: boolean; integer?: boolean; defaultValue?: number; max?: number } = {}): number | null {
  if (value == null || value === "") {
    if (options.optional) return null;
    if (options.defaultValue !== undefined) return options.defaultValue;
    throw new ProductInputError(`${field} is required`);
  }
  if (typeof value !== "number" && typeof value !== "string") throw new ProductInputError(`${field} must be a number`);
  if (typeof value === "string" && !value.trim()) throw new ProductInputError(`${field} must be a number`);
  const parsed = Number(value);
  const max = options.max ?? (options.integer ? MAX_INT : MAX_MONEY);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max || (options.integer && !Number.isSafeInteger(parsed))) {
    throw new ProductInputError(`${field} must be a non-negative${options.integer ? " whole" : ""} number`);
  }
  return parsed;
}

function optionalId(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") throw new ProductInputError(`Invalid ${field}`);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_INT) throw new ProductInputError(`Invalid ${field}`);
  return id;
}

function dateValue(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && !(value instanceof Date)) throw new ProductInputError(`Invalid ${field}`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ProductInputError(`Invalid ${field}`);
  return date;
}

function mediaUrl(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ProductInputError(`${field} must be a URL`);
  const clean = value.trim();
  if (!clean || clean.length > 2048 || /[\u0000-\u001f\u007f]/.test(clean)) throw new ProductInputError(`Invalid ${field}`);
  if (!(clean.startsWith("/") || /^https?:\/\//i.test(clean))) throw new ProductInputError(`Invalid ${field}`);
  return clean;
}

export type ParsedProductInput = ReturnType<typeof parseProductInput>;

export function parseProductInput(value: unknown) {
  const body = objectBody(value);
  const title = text(body.title, "Title", 200, true)!;
  const status = body.status == null || body.status === "" ? "ACTIVE" : String(body.status);
  if (!PRODUCT_STATUSES.has(status)) throw new ProductInputError("Invalid product status");
  const soldMode = body.soldMode == null || body.soldMode === "" ? "fixed" : String(body.soldMode);
  if (!SOLD_MODES.has(soldMode)) throw new ProductInputError("Invalid sold mode");

  if (!Array.isArray(body.images || [])) throw new ProductInputError("Images must be a list");
  if ((body.images || []).length > 30) throw new ProductInputError("A product can have at most 30 images");
  const images = (body.images || []).map((url: unknown, index: number) => mediaUrl(url, `Image ${index + 1}`)!);
  if (new Set(images).size !== images.length) throw new ProductInputError("Duplicate product images are not allowed");

  if (!Array.isArray(body.variants || [])) throw new ProductInputError("Variants must be a list");
  if ((body.variants || []).length > 100) throw new ProductInputError("A product can have at most 100 variants");
  const variants = (body.variants || []).map((raw: unknown, index: number) => {
    const variant = objectBody(raw);
    return {
      id: optionalId(variant.id, `variant ${index + 1} ID`),
      size: text(variant.size, `Variant ${index + 1} size`, 60),
      color: text(variant.color, `Variant ${index + 1} color`, 60),
      sku: text(variant.sku, `Variant ${index + 1} SKU`, 120),
      price: numberValue(variant.price, `Variant ${index + 1} price`, { optional: true }),
      stock: numberValue(variant.stock, `Variant ${index + 1} stock`, { integer: true, defaultValue: 0 })!,
      image: mediaUrl(variant.image, `Variant ${index + 1} image`),
    };
  });
  const variantIds = variants.flatMap((variant) => variant.id ? [variant.id] : []);
  if (new Set(variantIds).size !== variantIds.length) throw new ProductInputError("Duplicate variant IDs are not allowed");

  return {
    title,
    slug: text(body.slug, "Slug", 120),
    shortDesc: text(body.shortDesc, "Short description", 500),
    description: longText(body.description, "Description", 50_000),
    sku: text(body.sku, "SKU", 120),
    barcode: text(body.barcode, "Barcode", 120),
    price: numberValue(body.price, "Price")!,
    comparePrice: numberValue(body.comparePrice, "Compare-at price", { optional: true }),
    cost: numberValue(body.cost, "Cost", { optional: true }),
    stock: numberValue(body.stock, "Stock", { integer: true, defaultValue: 0 })!,
    lowStock: numberValue(body.lowStock, "Low-stock alert", { integer: true, defaultValue: 5 })!,
    soldCount: numberValue(body.soldCount, "Sold count", { integer: true, optional: true }),
    saleEnds: dateValue(body.saleEnds, "sale end date"),
    preorder: body.preorder === true,
    preorderDate: dateValue(body.preorderDate, "pre-order date"),
    soldMode,
    colorGroupId: optionalId(body.colorGroupId, "color group"),
    colorName: text(body.colorName, "Color name", 40),
    colorImage: mediaUrl(body.colorImage, "Color image"),
    status,
    featured: body.featured === true,
    tags: text(body.tags, "Tags", 1000),
    sizeChartImage: mediaUrl(body.sizeChartImage, "Size chart image"),
    badge: text(body.badge, "Badge", 40),
    isNew: body.isNew === true,
    isBestSeller: body.isBestSeller === true,
    categoryId: optionalId(body.categoryId, "category"),
    images,
    variants,
  };
}
