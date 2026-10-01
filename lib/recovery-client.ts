/* Browser-only helpers. Never send a signed recovery bearer token to analytics. */
const CAPTURE_KEY = "sz_checkout_capture_v2";
export const PENDING_RECOVERY_KEY = "sz_pending_recovery_v2";
let memoryKey: string | null = null;
let revision = 0;
export function getCaptureKey(): string | null {
  if (memoryKey) return memoryKey;
  try { const old = sessionStorage.getItem(CAPTURE_KEY); if (old && /^[a-f0-9]{64}$/i.test(old)) return memoryKey = old; } catch {}
  if (!globalThis.crypto?.getRandomValues) return null;
  memoryKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  try { sessionStorage.setItem(CAPTURE_KEY, memoryKey); } catch {}
  return memoryKey;
}
export function clearCaptureKey() {
  memoryKey = null; revision = 0;
  try { sessionStorage.removeItem(CAPTURE_KEY); sessionStorage.removeItem(CAPTURE_KEY + "-revision"); sessionStorage.removeItem(PENDING_RECOVERY_KEY); } catch {}
}
export function safeTrackingUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of ["recover", "recoveryToken"]) url.searchParams.delete(key);
    if (new URLSearchParams(url.hash.slice(1)).has("recover")) url.hash = "";
    return url.toString();
  } catch { return ""; }
}
export function captureSignature(lines: { productId: number; variantId?: number | null; qty: number }[]): string {
  return lines.map(l => `${l.productId}:${l.variantId || 0}:${l.qty}`).sort().join("|");
}

export function nextCaptureRevision(): number {
  try { revision = Math.max(revision, Number(sessionStorage.getItem(CAPTURE_KEY + "-revision")) || 0); } catch {}
  revision++;
  try { sessionStorage.setItem(CAPTURE_KEY + "-revision", String(revision)); } catch {}
  return revision;
}
