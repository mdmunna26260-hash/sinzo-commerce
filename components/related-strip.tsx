import Link from "next/link";
import { imgSrc, imgSrcSet } from "./img-src";

type Item = { id: number; slug: string; title: string; price: number; image?: string };

/* Match Recently Viewed: one compact, natively scrollable row on every screen.
   No nested photo gestures or duplicate mobile/desktop product trees. */
export default function RelatedStrip({ items }: { items: Item[] }) {
  if (!items.length) return null;
  return (
    <div className="recent-strip related-strip" role="region" aria-label="Recommended products" tabIndex={0}>
      {items.slice(0, 40).map((item, index) => (
        <Link key={item.id} href={"/products/" + encodeURIComponent(item.slug)} className="recent-card" style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
          {item.image && <img src={imgSrc(item.image, 300)} srcSet={imgSrcSet(item.image, [200, 300, 400, 600])} sizes="140px" alt={item.title} loading="lazy" decoding="async" width={140} height={186} />}
          <div className="recent-info">
            <div className="recent-title">{item.title}</div>
            <div className="recent-price">{"\u09f3"}{Number(item.price).toLocaleString("en-IN")}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
