"use client";
/* Admin API helper: attaches the session token (URL fallback) to every request. */
export function adminToken(): string {
  if (typeof location !== "undefined") {
    const t = new URLSearchParams(location.search).get("t");
    if (t) return t;
  }
  try { return localStorage.getItem("sz_admin_token") || ""; } catch { return ""; }
}
// Only relative, same-origin admin routes may receive an app session token.
function adminTarget(url: string): URL | null {
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  try {
    const target = new URL(url, "http://preview.invalid");
    if (target.origin !== "http://preview.invalid") return null;
    return /^\/(?:admin|api\/admin)(?:\/|$)/.test(target.pathname) ? target : null;
  } catch { return null; }
}
export function withToken(url: string): string {
  const target = adminTarget(url);
  if (!target) return url;
  const token = adminToken();
  if (!token) return url;
  target.searchParams.set("t", token);
  return target.pathname + target.search + target.hash;
}
export async function afetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers || {});
  const target = adminTarget(url);
  const token = target ? adminToken() : "";
  // Embedded dev-preview proxies may consume Authorization before forwarding.
  // Production keeps cookie/Bearer authentication; never append tokens externally.
  if (token && process.env.NODE_ENV !== "production" && target!.pathname.startsWith("/api/admin/")) {
    headers.delete("Authorization");
    target!.searchParams.set("t", token);
    return fetch(target!.pathname + target!.search, { ...opts, headers, referrerPolicy: "no-referrer" });
  }
  if (token) headers.set("Authorization", "Bearer " + token);
  return fetch(url, { ...opts, headers });
}

/* Clipboard copy with fallback for non-secure contexts (preview iframes). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}
