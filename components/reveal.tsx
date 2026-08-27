"use client";
import { useEffect } from "react";

/* Scroll-reveal that WORKS across client-side navigation.
   (Inline <script> tags don't re-execute on Next.js client navigations,
   so this lives in a persistent client component with a MutationObserver.) */
export default function RevealInit() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.08 }
    );
    const scan = () => document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));
    scan();
    let scheduled = false;
    const mo = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; scan(); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
  return null;
}
