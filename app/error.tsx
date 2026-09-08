"use client";
import { useEffect } from "react";

/* Storefront error boundary.
   Most common cause on phones: a deploy happened while the tab was open —
   the cached page references old JS chunks that no longer exist → hydration/
   navigation throws. One automatic hard reload (cache-busting _r= param)
   recovers silently; repeated failures show the friendly retry card. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Client error:", error);
    let attempts: string[] = [];
    try { attempts = JSON.parse(sessionStorage.getItem("sz_err_reload") || "[]"); } catch {}
    const key = error?.digest || error?.message?.slice(0, 80) || "unknown";
    if (!attempts.includes(key)) {
      try {
        attempts.push(key);
        sessionStorage.setItem("sz_err_reload", JSON.stringify(attempts.slice(-3)));
      } catch {}
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
