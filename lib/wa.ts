import { getSettings } from "./settings";

/* Client for the local WhatsApp bridge (scripts/whatsapp-bridge.js, binds 127.0.0.1).
   The bridge runs Baileys (WhatsApp linked-device protocol) — status is always real. */
const FALLBACK = "http://127.0.0.1:3001";
function key() { return process.env.WA_BRIDGE_KEY || "local-bridge"; }
async function base(): Promise<string> {
  try {
    const s = await getSettings();
    return s.notifications?.waBridgeUrl || process.env.WA_BRIDGE_URL || FALLBACK;
  } catch { return FALLBACK; }
}
async function call(pathname: string, init?: RequestInit): Promise<any> {
  try {
    const res = await fetch((await base()) + pathname, {
      ...init,
      headers: { "Content-Type": "application/json", "x-bridge-key": key(), ...(init?.headers || {}) },
      signal: AbortSignal.timeout(15000),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, data: {} }; // bridge not running
  }
}
export async function waStatus(): Promise<{ running: boolean; connected: boolean; me?: string | null; qrPending?: boolean }> {
  const r = await call("/status");
  return { running: r.status === 200, connected: !!r.data.connected, me: r.data.me || null, qrPending: !!r.data.qrPending };
}
export async function waGetQr(): Promise<{ connected: boolean; qr: string | null; hint?: string }> {
  const r = await call("/qr");
  return { connected: !!r.data.connected, qr: r.data.qr || null, hint: r.data.hint };
}
export async function waSend(to: string, message: string): Promise<{ ok: boolean; connected: boolean; error?: string }> {
  const r = await call("/send", { method: "POST", body: JSON.stringify({ to, message }) });
  if (r.status === 0) return { ok: false, connected: false, error: "Bridge service cholche na (npm run wa)" };
  if (r.status === 503) return { ok: false, connected: false, error: r.data.error || "WhatsApp not connected" };
  return { ok: !!r.data.ok, connected: true, error: r.data.error };
}
export async function waLogout(): Promise<{ ok: boolean }> {
  const r = await call("/logout", { method: "POST" });
  return { ok: r.status === 200 };
}
