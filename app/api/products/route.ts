import { NextResponse } from "next/server";
import { categoryIdForSlug, listProducts } from "@/lib/product-listing";

export const dynamic = "force-dynamic";

/* TASK 01 — server-side pagination endpoint for the infinite-scroll grid.
   The /products page renders the first PAGE_SIZE results; this route serves
   each next page on demand (same filtering/sorting/select, all DB-side).
   Public storefront data — same fields the page already renders. */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const page = Math.max(1, Math.min(500, parseInt(sp.get("page") || "1", 10) || 1));
    const filters = {
      q: sp.get("q") || undefined,
      category: sp.get("category") || undefined,
      min: sp.get("min") || undefined,
      max: sp.get("max") || undefined,
      size: sp.get("size") || undefined,
      color: sp.get("color") || undefined,
      avail: sp.get("avail") || undefined,
      sort: sp.get("sort") || undefined,
      onsale: sp.get("onsale") || undefined,
    };
    const categoryId = await categoryIdForSlug(filters.category);
    const result = await listProducts(filters, page, categoryId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ products: [], total: 0, hasMore: false }, { status: 200 });
  }
}
