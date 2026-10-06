"use client";
import { useRef, useState, useCallback } from "react";
import { ProductCard } from "@/components/parts";
import { useRailSwipe } from "@/components/swipe-rail";

/* Related products: 2×2 grid per page, horizontal swipe, interactive page counter.
   Each page = 4 products (2 cols × 2 rows). Max 10 pages (40 products).

   The swipe comes from components/swipe-rail.ts — the horizontal axis is ours
   (`touch-action: pan-y`), so a thumb swipe always turns the page instead of being
   swallowed by the vertical page scroll on iOS.

   Two page indicators: the PDP shows bare page dots (`dots` — the markup that section
   already carried), everything else the counter + arrows. Both are driven by the same
   `page` state, which the rail's `onScroll` keeps in sync. */

type Item = {
  id: number; title: string; slug: string; price: number;
  comparePrice: number | null; image?: string; stock: number;
  /* the row's photos, as Prisma selects them; the component flattens them to URLs for the card */
  images?: { url: string }[];
  badge?: string | null; isNew?: boolean; isBestSeller?: boolean;
  /* forwarded straight to the card, exactly like the server-rendered grid next to it */
  preorder?: boolean; sizes?: string[];
};

export default function RelatedCarousel({ items, dots = false, cap = 40 }: { items: Item[]; dots?: boolean; cap?: number }) {
  /* The rail is one <div> per page; `cap` keeps the DOM bounded (the caller may hand us
     every related product of a big category). */
  const list = items.slice(0, cap);
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(list.length / 4);
  const totalRef = useRef(totalPages);
  totalRef.current = totalPages;

  const goTo = useCallback((i: number) => {
    const el = rail.node.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, Math.min(totalRef.current - 1, i)) * el.clientWidth, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rail = useRailSwipe({ pages: () => totalRef.current, goTo });

  const onScroll = useCallback(() => {
    const el = rail.node.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setPage(Math.min(Math.max(0, idx), Math.max(0, totalRef.current - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pages: Item[][] = [];
  for (let i = 0; i < list.length; i += 4) pages.push(list.slice(i, i + 4));
  if (!pages.length) return null;

  return (
    <div className="rel-carousel">
      <div className="rel-scroll" ref={rail.ref} onClickCapture={rail.capture.onClickCapture} onScroll={onScroll}>
        {pages.map((chunk, pi) => (
          <div className="rel-page" key={pi}>
            {chunk.map((r) => (
              <ProductCard
                key={r.id}
                p={{
                  id: r.id, title: r.title, slug: r.slug, price: r.price,
                  comparePrice: r.comparePrice, image: r.images?.[0]?.url || r.image, images: r.images?.map((i) => i.url), stock: r.stock,
                  badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller,
                  preorder: r.preorder, sizes: r.sizes,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {totalPages > 1 && (dots ? (
        /* This is a page indicator for the related-products rail, not a product-photo gallery;
           keep the compact page dots here and in the home rails. */
        <div className="rel-dots" aria-hidden>
          {pages.map((_, pi) => <span key={pi} className={"rel-dot" + (pi === page ? " on" : "")} />)}
        </div>
      ) : (
        <div className="rel-arrows">
          <button className="rel-arrow" onClick={() => goTo(page - 1)} disabled={page === 0} aria-label="Previous">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <span className="rel-page-num">{page + 1} / {totalPages}</span>
          <button className="rel-arrow" onClick={() => goTo(page + 1)} disabled={page >= totalPages - 1} aria-label="Next">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      ))}
    </div>
  );
}
