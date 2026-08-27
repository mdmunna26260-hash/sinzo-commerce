"use client";
/* Admin API helper: attaches the session token (URL fallback) to every request. */
export function adminToken(): string {
  if (typeof location !== "undefined") {
    const t = new URLSearchParams(location.search).get("t");
    if (t) return t;
  }
  try { return localStorage.getItem("sz_admin_token") || ""; } catch { return ""; }
}
export function withToken(url: string): string {
  const t = adminToken();
  if (!t) return url;
  return url + (url.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(t);
}
export async function afetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers || {});
  const t = adminToken();
  if (t) headers.set("Authorization", "Bearer " + t);
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
