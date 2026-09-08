"use client";
import { useEffect, useState } from "react";

/* Admin-only error boundary.
   Most common cause on phones: a deploy happened while the tab was open —
   the cached page references old JS chunks that no longer exist → hydration/
   navigation throws. One automatic hard reload (cache-busting _r= param)
   recovers silently. If it keeps failing, this card shows the REAL error
   message (collapsible) so the exact cause is visible on the phone. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [details, setDetails] = useState("");

  useEffect(() => {
    console.error("Admin client error:", error);
    const msg = [error?.message, error?.digest ? "digest: " + error.digest : "", error?.stack?.split("\n").slice(1, 4).join("\n")]
      .filter(Boolean).join("\n");
    setDetails(msg || "Unknown error");

    let attempts: string[] = [];
    try { attempts = JSON.parse(sessionStorage.getItem("sz_admin_err_reload") || "[]"); } catch {}
    const key = error?.digest || error?.message?.slice(0, 80) || "unknown";
    if (!attempts.includes(key)) {
      try {
        attempts.push(key);
        sessionStorage.setItem("sz_admin_err_reload", JSON.stringify(attempts.slice(-3)));
      } catch {}
      // hard reload: bypass caches so stale old-build HTML/chunks are replaced
      try {
        if (!location.search.includes("_r=")) {
          const u = new URL(window.location.href);
          u.searchParams.set("_r", String(Date.now()));
          window.location.replace(u.toString());
          return;
        }
      } catch {}
      window.location.reload();
    }
  }, [error]);

  return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 460 }}>
        <div style={{ fontSize: 11, letterSpacing: ".18em", color: "var(--muted)", marginBottom: 8 }}>OOPS</div>
        <h1 style={{ fontSize: 24, margin: "0 0 10px", fontFamily: "var(--font-head)" }}>Admin panel load hote pare nai</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>
          Page reload hoyeche kintu somossa thakche. Niche error detail dekhachhe — ei message ta pathio.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 18 }}>
          <button className="abtn primary" onClick={() => { try { sessionStorage.removeItem("sz_admin_err_reload"); } catch {} window.location.reload(); }}>Try Again</button>
          <button className="abtn" onClick={() => { try { sessionStorage.removeItem("sz_admin_err_reload"); } catch {} window.location.href = "/admin/login"; }}>Login page</button>
          <a className="abtn" href="/">Storefront</a>
        </div>
        <div style={{ textAlign: "left", background: "#fff5f2", border: "1px solid #f0d7d0", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: ".14em", color: "var(--danger)", marginBottom: 6 }}>ERROR DETAIL (pathiyo):</div>
          <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, color: "#7a2e1f", fontFamily: "monospace" }}>{details || "…"}</pre>
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
            URL: {typeof location !== "undefined" ? location.pathname + location.search : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
