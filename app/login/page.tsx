"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function CustomerLoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/auth/" + mode, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json();
      if (r.ok && j.ok) {
        if (j.token) document.cookie = `sz_customer_fb=${j.token}; path=/; max-age=2592000; SameSite=Lax`;
        try {
          const probe = await fetch("/api/auth/me");
          if (probe.ok) { router.push("/account"); router.refresh(); return; }
        } catch {}
        router.push("/account?ct=" + encodeURIComponent(j.token));
        router.refresh();
      } else { setErr(j.error || "Failed"); setBusy(false); }
    } catch { setErr("Network error"); setBusy(false); }
  };

  return (
    <div style={{ minHeight: "72vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 20px" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div className="eyebrow">Welcome</div>
          <h1 style={{ fontSize: "clamp(28px,4vw,40px)", margin: "6px 0 4px" }}>{mode === "login" ? "Sign in to your account" : "Create your account"}</h1>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Order history, faster checkout, exclusive offers.</p>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          <button className={"chip" + (mode === "login" ? " active" : "")} style={{ cursor: "pointer", flex: 1 }} onClick={() => { setMode("login"); setErr(""); }}>Login</button>
          <button className={"chip" + (mode === "register" ? " active" : "")} style={{ cursor: "pointer", flex: 1 }} onClick={() => { setMode("register"); setErr(""); }}>Register</button>
        </div>
        <form onSubmit={submit} className="acard" style={{ padding: 26, display: "grid", gap: 14 }}>
          {err && <div className="noti err">{err}</div>}
          {mode === "register" && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Full Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Rahim Ahmed" autoCapitalize="words" />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Mobile Number *</label>
            <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01XXXXXXXXX" inputMode="numeric" autoCapitalize="none" spellCheck={false} />
          </div>
          {mode === "register" && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Email (optional)</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Password * {mode === "register" && <span style={{ textTransform: "none", letterSpacing: 0 }}>(min 6)</span>}</label>
            <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
          </div>
          <button className="btn" style={{ width: "100%" }} disabled={busy}>{busy ? "…" : mode === "login" ? "Sign In" : "Create Account"}</button>
          <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
            Order track korte login lagbe na — <Link href="/track" className="link-underline" style={{ textTransform: "none", letterSpacing: 0 }}>Track Order</Link> page use korun.
          </p>
        </form>
      </div>
    </div>
  );
}
