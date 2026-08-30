import { unstable_cache } from "next/cache";
import { db } from "./db";

/* Categories change rarely and are rendered into EVERY page's Header/Footer.
   Caching them here removes one DB roundtrip from every storefront render —
   including force-dynamic pages (cart/track/checkout) — so navigation between
   pages stays fast. Stale up to 60s, same magnitude as the ISR pages. */
export const getCategories = unstable_cache(
  async () => db.category.findMany({ orderBy: { id: "asc" } }),
  ["categories-v1"],
  { revalidate: 60 }
);
