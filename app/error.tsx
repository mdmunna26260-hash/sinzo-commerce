"use client";
import { useEffect } from "react";

/* Friendly fallback for client-side exceptions — retry without leaving the site. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Client error:", error); }, [error]);
  return (
    <div className="container">
      <div className="empty" style={{ padding: "120px 20px" }}>
        <div className="eyebrow">Oops</div>
        <h1 style={{ fontSize: "clamp(26px,3.4vw,40px)", margin: "10px 0 8px" }}>Kichu ekta bhul hoyeche</h1>
        <p style={{ color: "var(--muted)" }}>Page-ta load korte somossa hocche. Retry korun ar na hole homepage-e jan.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
          <button className="btn" onClick={reset}>Try Again</button>
          <a className="btn btn-outline" href="/">Go to Homepage</a>
        </div>
      </div>
    </div>
  );
}
