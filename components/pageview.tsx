"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/* Lightweight session + pageview tracking (feeds the Analytics funnel honestly).
   sid lives in sessionStorage when available, in-memory fallback otherwise. */
let sidMemory: string | null = null;
function getSid(): string {
  const gen = () => "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try {
    let sid = sessionStorage.getItem("sz_sid");
    if (!sid) { sid = gen(); sessionStorage.setItem("sz_sid", sid); }
    return sid;
  } catch { if (!sidMemory) sidMemory = gen(); return sidMemory!; }
}
export default function PageViewTracker() {
  const path = usePathname();
  useEffect(() => {
    if (!path || path.startsWith("/admin")) return; // admin panel not tracked
    try {
      const key = "sz_pv_" + path;
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 30 * 60 * 1000) return; // dedup per path per session
      sessionStorage.setItem(key, String(Date.now()));
    } catch {}
    fetch("/api/track/event", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ name: "PageView", data: { sid: getSid(), path } }),
    }).catch(() => {});
  }, [path]);
  return null;
}
