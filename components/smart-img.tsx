"use client";
import { useEffect, useState } from "react";

/* Banner image with cache-busting version + broken-image fallback.
   `v` changes whenever admin saves homepage settings → browser refetches. */
export default function SmartImg({ src, alt, className, fallback = "/uploads/seed/hero.jpg", priority }: {
  src?: string; alt: string; className?: string; fallback?: string; priority?: boolean;
}) {
  const [cur, setCur] = useState(src);
  const [dead, setDead] = useState(false);
  useEffect(() => { setCur(src); setDead(false); }, [src]);
  if (!src || dead) return null; // section gracefully hides (homepage checks src anyway)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cur}
      alt={alt}
      className={className}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={() => { if (cur !== fallback) setCur(fallback); else setDead(true); }}
    />
  );
}
