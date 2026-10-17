"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

/* Shows recently viewed products from localStorage. The homepage variant is a
   personalised conversion shelf; it stays completely absent for first-time
   visitors, so no empty placeholder shifts the server-rendered layout. */
export default function RecentlyViewedServer({ currentId = 0, homepage = false }: { currentId?: number; homepage?: boolean }) {
  const [items, setItems] = useState<{ id: number; slug: string; title: string; image?: string; price: number }[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = JSON.parse(localStorage.getItem("sz_recent") || "[]");
      if (!Array.isArray(stored)) return;
      setItems(stored
        .filter((item: any) => Number.isInteger(item?.id) && item.id > 0 && item.id !== currentId && typeof item.slug === "string" && typeof item.title === "string" && Number.isFinite(Number(item.price)))
        .slice(0, homepage ? 8 : 6));
    } catch {}
  }, [currentId, homepage]);

  if (!mounted || !items.length) return null;

  return (
    <section className={`section sdr${homepage ? " container home-recently" : ""}`} id={homepage ? "recently-viewed" : undefined} style={{ paddingTop: homepage ? 0 : 10 }}>
      {homepage ? (
        <div className="section-head2">
          <div>
            <div className="sh-eyebrow"><span className="sh-no">06</span>Continue browsing</div>
            <h2>Recently Viewed</h2>
          </div>
          <Link className="sh-link" href="/products">Shop All <span aria-hidden="true">→</span></Link>
        </div>
      ) : (
        <div className="section-head"><div><div className="eyebrow">Your history</div><h2>Recently Viewed</h2></div></div>
      )}
      <div className="recent-strip" aria-label="Recently viewed products">
        {items.map((item) => (
          <Link key={item.id} href={"/products/" + encodeURIComponent(item.slug)} className="recent-card">
            {item.image && <img src={item.image} alt={item.title} loading="lazy" decoding="async" width={140} height={186} />}
            <div className="recent-info">
              <div className="recent-title">{item.title}</div>
              <div className="recent-price">৳{Number(item.price).toLocaleString("en-IN")}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
