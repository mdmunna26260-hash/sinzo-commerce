"use client";
import { useEffect, useMemo, useState } from "react";

/* Live viewing social proof — per-product behaviour:
   - every product gets its own STABLE range (deterministic from product id),
     e.g. 23–80 / 23–55 / 33–90 / 1–60 style spread
   - each visit starts at a fresh random point inside the range
   - while on the page the number drifts ±1..3 every 4–6 seconds (small
     believable steps — never a big jump), clamped to the range */

function rangeFor(id: number): { base: number; max: number } {
  const base = 1 + ((id * 37) % 45); // 1..45
  const span = 25 + ((id * 53) % 50); // 25..74
  const max = Math.min(base + span, 95);
  return { base, max };
}

export default function LiveWatching({ productId }: { productId: number }) {
  const { base, max } = useMemo(() => rangeFor(productId), [productId]);
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    setN(base + Math.floor(Math.random() * (max - base + 1)));
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setN((v) => {
        if (v == null) return v;
        const step = 1 + Math.floor(Math.random() * 3); // 1..3
        const dir = Math.random() < 0.5 ? -1 : 1;
        let next = v + dir * step;
        if (next < base || next > max) next = v - dir * step; // blocked at edge → flip
        return Math.max(base, Math.min(max, next));
      });
      t = setTimeout(tick, 4000 + Math.random() * 2000); // 4–6s
    };
    t = setTimeout(tick, 4000 + Math.random() * 2000);
    return () => clearTimeout(t);
  }, [productId, base, max]);

  if (n == null) return null;
  return (
    <div className="live-watching" role="status">
      <span className="live-dot" aria-hidden />
      <span><b>{n}</b> people are viewing this right now</span>
    </div>
  );
}
