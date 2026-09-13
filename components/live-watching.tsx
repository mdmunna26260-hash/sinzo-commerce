"use client";
import { useEffect, useState } from "react";

/* Live viewing social proof: a random 40–80 "people viewing now" figure,
   re-rolled every ~15s so the page feels alive. Pure client-side, no backend. */
export default function LiveWatching() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    const pick = () => setN(40 + Math.floor(Math.random() * 41));
    pick();
    const iv = setInterval(pick, 15000);
    return () => clearInterval(iv);
  }, []);
  if (n == null) return null;
  return (
    <div className="live-watching" role="status">
      <span className="live-dot" aria-hidden />
      <span><b>{n}</b> people are viewing this right now</span>
    </div>
  );
}
