"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { ProductCard } from "@/components/parts";

/* Related products: 2×2 grid per page, horizontal swipe (scroll-snap),
   interactive dot indicators that update as you swipe.
   Each page = 4 products (2 cols × 2 rows). Max 10 pages (40 products). */

type Item = {
  id: number; title: string; slug: string; price: number;
  comparePrice: number | null; image?: string; stock: number;
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
                  comparePrice: r.comparePrice, image: r.image, stock: r.stock,
                  badge: r.badge, isNew: r.isNew, isBestSeller: r.isBestSeller,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="rel-dots">
          {pages.map((_, pi) => (
            <button
              key={pi}
              className={"rel-dot" + (pi === page ? " on" : "")}
              onClick={() => goTo(pi)}
              aria-label={"Page " + (pi + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
