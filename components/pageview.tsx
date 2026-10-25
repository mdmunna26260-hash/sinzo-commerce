"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackPageView } from "@/components/store";

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
    /* Previously this only POSTed to /api/track/event, which does not forward PageView to
       Meta — so the pixel never received a pageview at all. Same dedup still applies. */
    /* One dispatch for both destinations: trackPageView sends the standard PageView to the
       pixel and POSTs /api/track/event with the sid/path the funnel dashboard reads.
       This used to be a separate trackEvent() AND a raw fetch → every pageview was
       written to the tracking table twice. /checkout has its own tracker, so skip it
       here to keep the count honest. */
    if (path.startsWith("/checkout")) return;
    trackPageView(path, { sid: getSid() });
  }, [path]);
  return null;
}
