"use client";
import { useEffect } from "react";

/* Storefront error boundary.
   Most common cause on phones: a deploy happened while the tab was open —
   the cached page references old JS chunks that no longer exist → hydration/
   navigation throws. One automatic hard reload (cache-busting _r= param)
   recovers silently; repeated failures show the friendly retry card.

   The budget is per error AND time-based: up to 3 reloads, never two inside 15s, and an attempt
   stops counting after 10 minutes — a tab that lives through a later deploy heals again instead
   of sitting on this card forever. (Verified live: the dev preview used to stay stuck on this card
   after a rebuild, because the same error key had already been recorded once in the session.) */
const KEY = "sz_err_reload";
const MAX = 3;        // reloads per error, per tab
const GAP = 15_000;   // never reload twice inside 15s
const TTL = 600_000;  // an attempt older than 10 min no longer counts against the budget

type Attempt = { k: string; at: number };

function attempts(): Attempt[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((a: unknown) => (typeof a === "string" ? { k: a, at: 0 } : (a as Attempt)))  // pre-2026-09 format
      .filter((a) => a && typeof a.k === "string" && Date.now() - (a.at || 0) < TTL);
  } catch { return []; }
}

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Client error:", error);
    const key = error?.digest || error?.message?.slice(0, 80) || "unknown";
    const seen = attempts();
    const mine = seen.filter((a) => a.k === key);
    const last = mine.reduce((m, a) => Math.max(m, a.at || 0), 0);
    if (mine.length < MAX && Date.now() - last > GAP) {
      try { sessionStorage.setItem(KEY, JSON.stringify([...seen, { k: key, at: Date.now() }].slice(-12))); } catch {}
      try {
        const u = new URL(window.location.href);
        if (!u.searchParams.has("_r")) { u.searchParams.set("_r", String(Date.now())); window.location.replace(u.toString()); return; }
      } catch {}
      window.location.reload();
      return;
    }
  }, [error]);

  return (
    <div className="container">
      <div className="empty" style={{ padding: "120px 20px" }}>
        <div className="eyebrow">Oops</div>
        <h1 style={{ fontSize: "clamp(26px,3.4vw,40px)", margin: "10px 0 8px" }}>Kichu ekta bhul hoyeche</h1>
        <p style={{ color: "var(--muted)" }}>Page-ta load korte somossa hocche. Retry korun ar na hole homepage-e jan.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => { try { sessionStorage.removeItem("sz_err_reload"); } catch {} window.location.reload(); }}>Try Again</button>
          <a className="btn btn-outline" href="/">Go to Homepage</a>
        </div>
      </div>
    </div>
  );
}
