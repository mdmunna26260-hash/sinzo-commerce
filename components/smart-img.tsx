"use client";
import { useEffect, useRef, useState } from "react";
import { imgSrc } from "./img-src";

/* Banner image (hero / promo) with responsive variants + broken-image fallback.
   - srcset for /api/media/ and /uploads/seed/ URLs → mobile downloads a
     ~600-1000px WebP instead of the full-size original (big LCP win).
   - subtle fade-in on decode; `v` (cache-bust) changes when admin saves. */
export default function SmartImg({ src, alt, className, fallback = "/uploads/seed/hero.jpg", priority }: {
  src?: string; alt: string; className?: string; fallback?: string; priority?: boolean;
}) {
  const [cur, setCur] = useState(src);
  const [dead, setDead] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { setCur(src); setDead(false); setLoaded(false); }, [src]);
  useEffect(() => { if (ref.current?.complete) setLoaded(true); }, [cur]);
  if (!src || dead) return null; // section gracefully hides (homepage checks src anyway)
  // imgSrc keeps the cache-buster query on every candidate automatically
  const srcSet = [600, 1000, 1200].map((n) => `${imgSrc(cur, n)} ${n}w`).join(", ");
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={priority ? cur : imgSrc(cur, 1000)}
      srcSet={srcSet}
      sizes="100vw"
      alt={alt}
      className={className ? className + " fade-img" + (loaded ? " loaded" : "") : "fade-img" + (loaded ? " loaded" : "")}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      {...(priority ? { fetchPriority: "high" as const } : {})}
      onLoad={() => setLoaded(true)}
      onError={() => { if (cur !== fallback) setCur(fallback); else setDead(true); }}
    />
  );
}
