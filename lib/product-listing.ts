import { db } from "./db";

/* TASK 01 — shared product-listing engine.
   One source of truth for the /products page (first page) and the
   /api/products pagination endpoint, so filtering/sorting/select/mapping
   can never drift apart.

   Everything below is DB-side:
   - filtering  (search/category/price/onsale/stock + size/color via variants)
   - sorting    (DB orderBy, no in-memory sorting)
   - pagination (take/skip)
   - selection  (only the fields the product card renders)
*/

export type ListingSP = {
  q?: string; category?: string; min?: string; max?: string;
  size?: string; color?: string; avail?: string; sort?: string; onsale?: string;
};

export const PAGE_SIZE = 24;

const isPg = (process.env.DATABASE_URL || "").startsWith("postgres");

/* Product fields the card renders — descriptions/tags/sku stay on the server. */
export const CARD_SELECT = {
  id: true, title: true, slug: true, price: true, comparePrice: true, stock: true,
  badge: true, isNew: true, isBestSeller: true,
  category: { select: { name: true } },
  images: { select: { url: true }, orderBy: { position: "asc" as const }, take: 1 },
  variants: { select: { size: true, color: true, stock: true } },
} as const;

/* Build the Prisma `where` for a listing/search request. All filters resolve
   in the DATABASE (size/color used to be filtered in Node after loading the
   whole catalog — the main listing bottleneck). */
export function buildProductWhere(sp: ListingSP): any {
  const where: any = { status: "ACTIVE" };
  if (sp.q) {
    const q = sp.q.trim();
    // same columns as before → identical results; pg_trgm GIN indexes make it fast
    where.OR = [
      { title: { contains: q } }, { description: { contains: q } }, { shortDesc: { contains: q } },
      { tags: { contains: q } }, { sku: { contains: q } },
    ];
  }
  if (sp.category) where.categorySlug = sp.category; // resolved to id by caller (needs cats)
  if (sp.min || sp.max) {
    where.price = {};
    if (sp.min) where.price.gte = parseFloat(sp.min);
    if (sp.max) where.price.lte = parseFloat(sp.max);
  }
  if (sp.onsale === "1") where.comparePrice = { not: null, gt: 0 };
  if (sp.avail === "1") where.stock = { gt: 0 };
  // DB-side size / color filters (was: fetch-all then filter in Node)
  const vSome: any = {};
  if (sp.size) { vSome.size = sp.size; vSome.stock = { gt: 0 }; }
  if (sp.color) {
    // Case-insensitive everywhere. Postgres: `mode: "insensitive"` (index-assisted).
    // SQLite (dev): `contains` compiles to LIKE, which is already CI for ASCII.
    vSome.color = isPg ? { equals: sp.color, mode: "insensitive" } : { contains: sp.color };
    if (!("stock" in vSome)) vSome.stock = { gt: 0 };
  }
  if (Object.keys(vSome).length) where.variants = { some: vSome };
  return where;
}

/* Resolve a category slug to its id (callers that have the cats list reuse it). */
export async function categoryIdForSlug(slug?: string): Promise<number | undefined> {
  if (!slug) return undefined;
  const c = await db.category.findUnique({ where: { slug }, select: { id: true } });
  return c?.id;
}

/* DB-side sort. Default = admin drag&drop order (position, then newest). */
export function buildProductOrderBy(sort?: string): any {
  return (
    sort === "price_asc" ? { price: "asc" } :
    sort === "price_desc" ? { price: "desc" } :
    sort === "popular" ? { views: "desc" } :
    sort === "new" ? { createdAt: "desc" } :
    sort === "oldest" ? { createdAt: "asc" } :
    [{ position: "asc" }, { id: "desc" }]
  );
}

/* Shape a product row into the card payload every surface uses.
   Identical to the shape /products has always rendered. */
export function mapCard(p: any) {
  return {
    id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
    image: p.images?.[0]?.url ?? null, categoryName: p.category?.name ?? null,
    stock: Math.max(p.stock, (p.variants || []).reduce((s: number, v: any) => s + v.stock, 0)),
    isNew: p.isNew, isBestSeller: p.isBestSeller, badge: p.badge,
    colors: Array.from(new Set<string>((p.variants || []).filter((v: any) => v.stock > 0 && v.color).map((v: any) => v.color as string))),
    sizes: Array.from(new Set<string>((p.variants || []).filter((v: any) => v.stock > 0 && v.size).map((v: any) => v.size as string))).sort(),
  };
}

/* One page of the listing: DB-side filter + sort + paginate. */
export async function listProducts(sp: ListingSP, page: number, categoryId?: number) {
  const where = buildProductWhere(sp);
  if (where.categorySlug) { where.categoryId = categoryId; delete where.categorySlug; }
  const orderBy = buildProductOrderBy(sp.sort);
  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where, orderBy,
      select: CARD_SELECT,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
  ]);
  return { total, products: rows.map(mapCard), page, pageSize: PAGE_SIZE, hasMore: page * PAGE_SIZE < total };
}
