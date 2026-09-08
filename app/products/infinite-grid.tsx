"use client";
import { useEffect, useRef, useState } from "react";
import { ProductCard } from "@/components/parts";
import { useSearchParams } from "next/navigation";

/* Infinite scroll grid — UX unchanged: first batch renders instantly from the
   server, more batches auto-reveal as the customer scrolls (sentinel +
   IntersectionObserver), no buttons, no page reloads.

   TASK 01 (internal only): batches are revealed from the server-rendered first
   page (24) first; when memory runs out the next page is fetched from
   /api/products (server-side pagination) instead of the server having sent
   the whole catalog up front. */

type Card = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  image?: string | null; categoryName?: string | null; stock: number;
  isNew?: boolean; isBestSeller?: boolean; badge?: string | null;
  colors?: string[]; sizes?: string[];
};

const REVEAL_BATCH = 12; // same reveal cadence as before

export default function InfiniteGrid({ products, total, hasMore, sp, pageSize }: {
  products: Card[];
  total: number;
  hasMore: boolean;
  sp: Record<string, string | undefined>;
  pageSize: number;
}) {
  const ssp = useSearchParams();
  const [items, setItems] = useState<Card[]>(products);
  const [visible, setVisible] = useState(Math.min(REVEAL_BATCH, products.length));
  const [serverPage, setServerPage] = useState(1);
  const [done, setDone] = useState(!hasMore);
  const [fetching, setFetching] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // filters/sort changed → parent remounts us (Suspense key); reset defensively
  useEffect(() => {
    setItems(products);
    setVisible(Math.min(REVEAL_BATCH, products.length));
    setServerPage(1);
    setDone(!hasMore);
  }, [ssp]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadNextPage = async () => {
    if (fetching || done) return;
    setFetching(true);
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) if (v) params.set(k, v);
      params.set("page", String(serverPage + 1));
      const r = await fetch("/api/products?" + params.toString());
      const j = await r.json();
      const fresh: Card[] = (j.products || []).filter((p: Card) => !items.some((x) => x.id === p.id));
      setItems((cur) => [...cur, ...fresh]);
      setServerPage((p) => p + 1);
      if (!j.hasMore || fresh.length === 0) setDone(true);
    } catch { setDone(true); }
    setFetching(false);
  };

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (visible < items.length) {
            // still revealing the in-memory batch (same as the old behaviour)
            setVisible((v) => (v >= items.length ? v : v + REVEAL_BATCH));
          } else if (!done) {
            loadNextPage();
          }
        }
      },
      { rootMargin: "600px 0px" } // start loading before reaching the bottom
    );
    io.observe(el);
    return () => io.disconnect();
  });

  const shown = items.slice(0, visible);
  const remaining = Math.max(0, total - shown.length);

  return (
    <>
      <div className="shop-grid">
        {shown.map((p) => (
          <ProductCard key={p.id} p={{
            id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
            image: p.image, categoryName: p.categoryName, stock: p.stock,
            isNew: p.isNew, isBestSeller: p.isBestSeller, badge: p.badge,
            colors: p.colors,
            sizes: p.sizes ? [...new Set(p.sizes)] as string[] : undefined,
          }} />
        ))}
      </div>
      {(remaining > 0 || fetching) && (
        <div ref={sentinel} className="inf-sentinel" aria-hidden>
          <span className="inf-spinner" />
        </div>
      )}
      {remaining <= 0 && !fetching && total > 12 && (
        <div className="inf-end">— sob product dekhano hoyeche —</div>
      )}
    </>
  );
}
