"use client";
import { useEffect } from "react";

/* Admin-only error boundary.
   Root app/error.tsx shows the storefront error card; for the admin panel we
   hard-reload once instead — the usual cause on mobile is a cached OLD page
   referencing chunks that no longer exist after a deploy. A hard reload
   (ignoring caches) re-fetches the fresh HTML + chunk set and recovers
   automatically. If it keeps failing, a plain admin-style retry card shows. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Admin client error:", error);
    let attempts: string[] = [];
    try { attempts = JSON.parse(sessionStorage.getItem("sz_admin_err_reload") || "[]"); } catch {}
    const key = error?.digest || error?.message?.slice(0, 80) || "unknown";
    if (!attempts.includes(key)) {
      try {
        attempts.push(key);
        sessionStorage.setItem("sz_admin_err_reload", JSON.stringify(attempts.slice(-3)));
      } catch {}
      // hard reload: bypass HTTP cache so stale old-build HTML/chunks are replaced
      try { location.replace(location.href + (location.search.includes("_r=") ? "" : (location.search ? "&" : "?") + "_r=" + Date.now())); window.location.reload(); } catch { window.location.reload(); }
    }
  }, [error]);
  return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div style={{ fontSize: 11, letterSpacing: ".18em", color: "var(--muted)", marginBottom: 8 }}>OOPS</div>
        <h1 style={{ fontSize: 24, margin: "0 0 10px", fontFamily: "var(--font-head)" }}>Admin panel load hote pare nai</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 22 }}>
          Notun version load korar jonno page reload hoyeche. Ekhon-o somossa hole nicheTry Again chapun.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="abtn primary" onClick={() => { try { sessionStorage.removeItem("sz_admin_err_reload"); } catch {} window.location.reload(); }}>Try Again</button>
          <a className="abtn" href="/">Storefront</a>
        </div>
      </div>
    </div>
  );
}
