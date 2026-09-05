"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCompare, COMPARE_MAX } from "./store";

/* Floating compare bar — appears once products are picked.
   Desktop: bottom-right pill. Mobile: sits above the tab bar. */
export default function CompareBar() {
  const cmp = useCompare();
  const pathname = usePathname();
  const router = useRouter();
  const [thumbs, setThumbs] = useState<{ id: number; img: string | null }[]>([]);

  useEffect(() => {
    if (cmp.ids.length === 0) { setThumbs([]); return; }
    try {
      const map = JSON.parse(localStorage.getItem("sz_compare_meta") || "{}");
      setThumbs(cmp.ids.map((id) => ({ id, img: map[id] || null })));
    } catch { setThumbs(cmp.ids.map((id) => ({ id, img: null }))); }
  }, [cmp.ids]);

  if (pathname.startsWith("/admin") || pathname === "/compare" || cmp.ids.length === 0) return null;

  return (
    <div className="cmp-bar" role="region" aria-label="Compare bar">
      <div className="cmp-bar-thumbs">
        {thumbs.map((t) => (
          <span key={t.id} className="cmp-thumb">
            {t.img ? <img src={t.img} alt="" width={30} height={38} loading="lazy" /> : <i />}
            <button
              className="cmp-thumb-x"
              aria-label="Remove from compare"
              onClick={() => cmp.toggle(t.id)}
            >
              ×
            </button>
          </span>
        ))}
        {Array.from({ length: Math.max(0, 2 - thumbs.length) }).map((_, i) => (
          <span key={"e" + i} className="cmp-thumb empty"><i /></span>
        ))}
      </div>
      <button
        className="cmp-bar-go"
        disabled={cmp.ids.length < 2}
        onClick={() => router.push("/compare?ids=" + cmp.ids.join(","))}
      >
        Compare ({cmp.ids.length}/{COMPARE_MAX})
      </button>
      <button className="cmp-bar-clear" aria-label="Clear compare" onClick={() => cmp.clear()}>✕</button>
    </div>
  );
}
