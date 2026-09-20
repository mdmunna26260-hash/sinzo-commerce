"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { ProductCard } from "@/components/parts";

/* Related products: 2×2 grid per page, horizontal swipe (scroll-snap),
   interactive dot indicators that update as you swipe.
   Each page = 4 products (2 cols × 2 rows). Max 10 pages (40 products). */

type Item = {
  id: number; title: string; slug: string; price: number;
  comparePrice: number | null; image?: string; images?: { url: string }[]; stock: number;
  badge?: string | null; isNew?: boolean; isBestSeller?: boolean;
};

export default function RelatedCarousel({ items }: { items: Item[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(items.length / 4);

  const pages: Item[][] = [];
  for (let i = 0; i < items.length; i += 4) pages.push(items.slice(i, i + 4));
  if (!pages.length) return null;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setPage(Math.min(idx, totalPages - 1));
  }, [totalPages]);

  const goTo = (i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="rel-carousel">
      <div className="rel-scroll" ref={scrollRef} onScroll={onScroll}>
        {pages.map((chunk, pi) => (
          <div className="rel-page" key={pi}>
            {chunk.map((r) => (
              <ProductCard
                key={r.id}
                p={{
                  id: r.id, title: r.title, slug: r.slug, price: r.price,
                  comparePrice: r.comparePrice, image: r.images?.[0]?.url || r.image, images: r.images?.map((i) => i.url), stock: r.stock,
                  badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="rel-arrows">
          <button className="rel-arrow" onClick={() => goTo(page - 1)} disabled={page === 0} aria-label="Previous">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <span className="rel-page-num">{page + 1} / {totalPages}</span>
          <button className="rel-arrow" onClick={() => goTo(page + 1)} disabled={page >= totalPages - 1} aria-label="Next">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
