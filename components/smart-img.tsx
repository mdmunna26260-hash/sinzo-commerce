"use client";
import { useEffect, useState } from "react";
import { imgSrc } from "./parts";

/* Banner image (hero / promo) with responsive variants + broken-image fallback.
   - srcset for /api/media/ and /uploads/seed/ URLs → mobile downloads a
     ~600-1000px WebP instead of the full-size original (big LCP win).
   - `v` (cache-bust) changes whenever admin saves homepage settings. */
export default function SmartImg({ src, alt, className, fallback = "/uploads/seed/hero.jpg", priority }: {
  src?: string; alt: string; className?: string; fallback?: string; priority?: boolean;
}) {
  const [cur, setCur] = useState(src);
  const [dead, setDead] = useState(false);
  useEffect(() => { setCur(src); setDead(false); }, [src]);
  if (!src || dead) return null; // section gracefully hides (homepage checks src anyway)
  // imgSrc/imgSrcSet keep the cache-buster query on every candidate automatically
  const srcSet = [600, 1000, 1200].map((n) => `${imgSrc(cur, n)} ${n}w`).join(", ");
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={priority ? cur : imgSrc(cur, 1000)}
      srcSet={srcSet}
      sizes="100vw"
      alt={alt}
      className={className}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      {...(priority ? { fetchPriority: "high" as const } : {})}
      onError={() => { if (cur !== fallback) setCur(fallback); else setDead(true); }}
    />
  );
}
