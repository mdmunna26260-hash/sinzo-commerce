"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const j = await r.json();
      if (r.ok && j.ok) {
        // fallback session: if the browser blocked the httpOnly Set-Cookie,
        // set a JS cookie ourselves so the server can still read the session
        if (j.token) {
          document.cookie = `sz_session_fb=${j.token}; path=/; max-age=604800; SameSite=Lax`;
          try { localStorage.setItem("sz_admin_token", j.token); } catch {}
        }
        // probe: did the cookie survive? if not (cross-site preview iframes block
        // cookies AND storage entirely), do a FULL page load with the token in the
        // URL — guaranteed to arrive, and every admin page/API reads it from there.
        try {
          const probe = await fetch("/api/admin/whoami");
          if (probe.ok) { window.location.href = "/admin/dashboard"; return; }
        } catch {}
        if (j.token) { window.location.href = "/admin/dashboard?t=" + encodeURIComponent(j.token); return; }
        window.location.href = "/admin/dashboard";
      } else {
        setErr(j.error === "Too many attempts. Try again in a few minutes."
          ? "Onek bar try kora hoyeche — 2-3 minute por abar chin. (Rate limit)"
          : j.error || "Login failed");
        setBusy(false);
      }
    } catch {
      setErr("Network error — page reload kore abar try korun (server restart hoye thakte pare).");
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <span className="logo">SINZO</span>
        <div className="login-sub">Admin Panel — sign in to continue</div>

        {err && <div className="noti err">{err}</div>}

        <div className="field">
          <label>Email</label>
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </div>
        <div className="field">
          <label>Password</label>
          <div style={{ position: "relative" }}>
            <input type={show ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              style={{ paddingRight: 44 }} />
            <button type="button" onClick={() => setShow(!show)} aria-label="Show password"
              style={{ position: "absolute", right: 10, top: 9, background: "none", border: "none", fontSize: 15, opacity: .6 }}>
              {show ? "🙈" : "👁"}
            </button>
          </div>
        </div>
        <button className="abtn primary" style={{ width: "100%", padding: 13, fontSize: 14 }} disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
