"use client";
/* Product-card image.
   - Renders the responsive srcset (same as before)
   - As the customer scrolls, each visible card quietly warms its PDP-size
     image in idle time → clicking any browsed product loads instantly
   - Hover (desktop) / finger-down (mobile):
       1. warms the main image immediately
       2. prefetches the PDP route (RSC) — Next.js then hoists the PDP's
          image preload link, so the hero image starts downloading BEFORE
          the click happens */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { imgSrc, imgSrcSet } from "./img-src";
import { warmImage, warmWhenIdle } from "./img-warm";

export default function CardImg({ url, alt, slug }: { url: string; alt: string; slug?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const router = useRouter();
  const routed = useRef(false);

  const onIntent = () => {
    warmImage(url);
    if (slug && !routed.current) {
      routed.current = true;
      router.prefetch("/products/" + slug);
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !url) return;
    let done = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !done) {
          done = true;
          io.disconnect();
          warmWhenIdle(url, 500); // stagger: let the card's own image load first
        }
      }
    }, { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [url]);

  return (
    <img
      ref={ref}
      src={imgSrc(url, 600)}
      srcSet={imgSrcSet(url, [300, 600, 1000, 1200])}
      sizes="(max-width: 600px) 50vw, (max-width: 1200px) 33vw, 300px"
      alt={alt}
      loading="lazy"
      decoding="async"
      onPointerEnter={onIntent}
      onTouchStart={onIntent}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}

