"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

/* Tracks last 8 viewed products in localStorage, shows horizontal strip on PDP */

export function trackRecentlyViewed(product: { id: number; slug: string; title: string; image?: string; price: number }) {
  try {
    const key = "sz_recent";
    const items = JSON.parse(localStorage.getItem(key) || "[]") as typeof product[];
    const filtered = items.filter((i) => i.id !== product.id);
    filtered.unshift(product);
    localStorage.setItem(key, JSON.stringify(filtered.slice(0, 8)));
  } catch {}
}

export default function RecentlyViewed({ currentId }: { currentId: number }) {
  const [items, setItems] = useState<{ id: number; slug: string; title: string; image?: string; price: number }[]>([]);

  useEffect(() => {
    try {
      const items = JSON.parse(localStorage.getItem("sz_recent") || "[]") as typeof items;
      setItems(items.filter((i) => i.id !== currentId).slice(0, 6));
    } catch {}
  }, [currentId]);

  if (!items.length) return null;

  return (
    <section className="section" style={{ paddingTop: 10 }}>
      <div className="section-head"><div><div className="eyebrow">Your history</div><h2>Recently Viewed</h2></div></div>
      <div className="recent-strip">
        {items.map((item) => (
          <Link key={item.id} href={"/products/" + item.slug} className="recent-card">
            {item.image && <img src={item.image} alt={item.title} loading="lazy" decoding="async" width={120} height={160} />}
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
