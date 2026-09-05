"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

/* Shows recently viewed products from localStorage (excluding current PDP).
   Server component can't access localStorage, so this must be a client component. */

export default function RecentlyViewedServer({ currentId }: { currentId: number }) {
  const [items, setItems] = useState<{ id: number; slug: string; title: string; image?: string; price: number }[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const items = JSON.parse(localStorage.getItem("sz_recent") || "[]");
      setItems(items.filter((i: any) => i.id !== currentId).slice(0, 6));
    } catch {}
  }, [currentId]);

  if (!mounted || !items.length) return null;

  return (
    <section className="section" style={{ paddingTop: 10 }}>
      <div className="section-head"><div><div className="eyebrow">Your history</div><h2>Recently Viewed</h2></div></div>
      <div className="recent-strip">
        {items.map((item) => (
          <Link key={item.id} href={"/products/" + item.slug} className="recent-card">
            {item.image && <img src={item.image} alt={item.title} loading="lazy" decoding="async" width={140} height={186} />}
            <div className="recent-info">
              <div className="recent-title">{item.title}</div>
              <div className="recent-price">৳{item.price?.toLocaleString("en-IN")}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
