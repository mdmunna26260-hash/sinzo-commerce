"use client";
import { useEffect, useRef, useState } from "react";
import { ProductCard } from "@/components/parts";
import { useSearchParams } from "next/navigation";

/* Infinite scroll grid: shows first batch instantly, auto-reveals more
   batches as the customer scrolls down (sentinel + IntersectionObserver).
   No buttons, no page reloads — exactly like modern fashion stores. */
export default function InfiniteGrid({ products }: { products: any[] }) {
  const sp = useSearchParams();
  const [visible, setVisible] = useState(12);
  const sentinel = useRef<HTMLDivElement>(null);
  const BATCH = 12;

  // filters/sort changed → reset to first batch
  useEffect(() => { setVisible(12); }, [sp]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible((v) => (v >= products.length ? v : v + BATCH));
          }
        }
      },
      { rootMargin: "600px 0px" } // start loading before reaching the bottom
    );
    io.observe(el);
    return () => io.disconnect();
  }, [products.length]);

  const shown = products.slice(0, visible);
  const remaining = products.length - shown.length;

  return (
    <>
      <div className="shop-grid">
        {shown.map((p) => (
          <ProductCard key={p.id} p={{
            id: p.id, title: p.title, slug: p.slug, price: p.price, comparePrice: p.comparePrice,
            image: p.image, images: p.images, categoryName: p.categoryName, stock: p.stock,
            isNew: p.isNew, isBestSeller: p.isBestSeller, badge: p.badge,
            preorder: p.preorder,
            colors: p.colors,
            sizes: p.sizes ? [...new Set(p.sizes)].sort() as string[] : undefined,
            qa: p.qa,
          }} />
        ))}
      </div>
      {remaining > 0 && (
        <div ref={sentinel} className="inf-sentinel" aria-hidden>
          <span className="inf-spinner" />
        </div>
      )}
      {remaining <= 0 && products.length > 12 && (
        <div className="inf-end">— you have seen everything —</div>
      )}
    </>
  );
}
