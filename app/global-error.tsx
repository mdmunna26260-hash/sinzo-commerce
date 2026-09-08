"use client";
/* Root-level error boundary — catches errors that app/error.tsx cannot
   (errors thrown in the root layout / outside page error boundaries). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#faf9f7", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 460 }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", color: "#6f6a63", marginBottom: 8 }}>OOPS</div>
          <h1 style={{ fontSize: 24, margin: "0 0 10px" }}>Kichu ekta bhul hoyeche</h1>
          <p style={{ color: "#6f6a63", fontSize: 14, marginBottom: 18 }}>Page load korte somossa hocche.</p>
          <button onClick={reset} style={{ background: "#141414", color: "#fff", border: "none", borderRadius: 6, padding: "12px 22px", fontSize: 14, cursor: "pointer", marginRight: 10 }}>Try Again</button>
          <a href="/" style={{ color: "#141414", fontSize: 14 }}>Homepage</a>
          <pre style={{ marginTop: 20, fontSize: 11, textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#b3392f", background: "#fff5f2", padding: 12, borderRadius: 8 }}>{error?.message || "Unknown error"}</pre>
        </div>
      </body>
    </html>
  );
}
