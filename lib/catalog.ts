import { unstable_cache } from "next/cache";
import { db } from "./db";
import { flattenCategoryTree } from "./category-tree";

/* Categories change rarely and are rendered into EVERY page's Header/Footer.
   Caching them here removes one DB roundtrip from every storefront render —
   including force-dynamic pages (cart/track/checkout) — so navigation between
   pages stays fast. Stale up to 60s, same magnitude as the ISR pages.
   Returned in 3-level tree order (main → sub → child) so nav/pills read naturally. */
export const getCategories = unstable_cache(
  async () => {
    const cats = await db.category.findMany({ orderBy: { id: "asc" } });
    return flattenCategoryTree(cats);
  },
  ["categories-v2"],
  { revalidate: 60 }
);
