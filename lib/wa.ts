import crypto from "crypto";
import { getSettings } from "./settings";
import { db } from "./db";

/* Client for the local WhatsApp bridge (scripts/whatsapp-bridge.js, binds 127.0.0.1).
   The bridge runs Baileys (WhatsApp linked-device protocol) — status is always real.

   Multi-device: the bridge runs one session per phone (`.wa-auth/<sessionId>/`). Every call here
   can name a session; without one the bridge uses its default device (what the older screens —
   inbox, settings, admin alerts — keep doing). Nothing else in the app talks to WhatsApp. */
const FALLBACK = "http://127.0.0.1:3001";
/* The key the bridge expects. Settings win over env so the admin panel stays the single place a
   shop owner configures things — the bridge itself is started with the same value
   (`WA_BRIDGE_KEY=… npm run wa`); both sides falling back to "local-bridge" keeps a local
   machine working with no configuration at all. */
/* The well-known development default. It is documented in this repo, so on an
   internet-facing webhook it is not a secret — it is a password printed on the box.
   See verifyBridgeKey() for why production refuses it outright. */
export const DEFAULT_BRIDGE_KEY = "local-bridge";
const IS_PROD = process.env.NODE_ENV === "production";

export async function bridgeKey(): Promise<string> {
  try {
    const s = await getSettings();
    const configured = (s as any).notifications?.waBridgeKey;
    if (configured) return String(configured);
  } catch {}
  return process.env.WA_BRIDGE_KEY || DEFAULT_BRIDGE_KEY;
}

/* True when the effective key is something the operator actually chose. */
export async function bridgeKeyIsConfigured(): Promise<boolean> {
  return (await bridgeKey()) !== DEFAULT_BRIDGE_KEY;
}

/* Constant-time comparison that tolerates differing lengths. timingSafeEqual throws on a
   length mismatch, which would itself leak whether the key was even close — so both sides
   are hashed to a fixed width first. Same shape as lib/recovery-security.ts uses. */
function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) =>
    new TextEncoder().encode(crypto.createHash("sha256").update(String(s || "")).digest("hex"));
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/* Single place that decides whether a bridge/worker webhook caller is authentic.

   /api/wa/inbound, /api/wa/device, /api/wa/receipt and /api/wa/tick are all reachable
   from the public internet. Each of them fell back to "local-bridge" when neither
   Settings nor WA_BRIDGE_KEY was set, and compared with `!==`, so on any deployment
   that had not configured the key an anonymous caller could:

     · forge inbound customer messages into the admin inbox;
     · run the STOP/opt-out branch for arbitrary numbers, unsubscribing the whole
       customer base from marketing;
     · flip device state (mark the shop's WhatsApp BANNED) and fire admin alerts;
     · rewrite delivery receipts;
     · force-run the outbound broadcast queue via /api/wa/tick.

   Production therefore requires a real key. A weak one is rejected too, so the fix
   cannot be satisfied by typing "password". */
export async function verifyBridgeKey(req: Request, header = "x-bridge-key"): Promise<boolean> {
  const sent = req.headers.get(header) || "";
  if (!sent || sent.length > 512) return false;
  const expected = await bridgeKey();
  if (expected === DEFAULT_BRIDGE_KEY || expected.length < 16) {
    if (IS_PROD) return false;
    // Dev/preview keeps working with no configuration at all, as before.
    return safeEqual(sent, expected);
  }
  return safeEqual(sent, expected);
}
async function base(): Promise<string> {
  try {
    const s = await getSettings();
    return s.notifications?.waBridgeUrl || process.env.WA_BRIDGE_URL || FALLBACK;
  } catch { return FALLBACK; }
}
async function call(pathname: string, init?: RequestInit, timeoutMs = 30000): Promise<any> {
  try {
    const res = await fetch((await base()) + pathname, {
      ...init,
      headers: { "Content-Type": "application/json", "x-bridge-key": await bridgeKey(), ...(init?.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, data: {} }; // bridge not running
  }
}
function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? "?" + s : "";
}

/* The device the app uses when a caller does not name one: the owner's default (Settings →
   WhatsApp → Devices → "set default"), else the first connected number. Falls back to the
   bridge's own default when the table is empty. */
export async function waDefaultSession(): Promise<string | undefined> {
  try {
    const { ensureExtraTables } = await import("./db-ensure");
    await ensureExtraTables().catch(() => {});
    const byDefault = await db.waDevice.findFirst({ where: { isDefault: true, status: "CONNECTED" }, orderBy: { id: "asc" }, select: { sessionId: true } });
    if (byDefault?.sessionId) return byDefault.sessionId;
    const any = await db.waDevice.findFirst({ where: { status: "CONNECTED" }, orderBy: { id: "asc" }, select: { sessionId: true } });
    return any?.sessionId || undefined;
  } catch {
    return undefined;
  }
}

/* ── single (legacy) device: what the inbox / settings / admin alerts use ─────────────── */
export async function waStatus(): Promise<{ running: boolean; connected: boolean; me?: string | null; qrPending?: boolean }> {
  const r = await call("/status");
  return { running: r.status === 200, connected: !!r.data.connected, me: r.data.me || null, qrPending: !!r.data.qrPending };
}
export async function waGetQr(): Promise<{ connected: boolean; qr: string | null; hint?: string }> {
  const r = await call("/qr");
  return { connected: !!r.data.connected, qr: r.data.qr || null, hint: r.data.hint };
}
export async function waSend(to: string, message: string, sessionId?: string): Promise<{ ok: boolean; connected: boolean; error?: string; id?: string | null }> {
  const r = await call("/send", { method: "POST", body: JSON.stringify({ to, message, sessionId: sessionId || (await waDefaultSession()) }) });
  if (r.status === 0) return { ok: false, connected: false, error: "Bridge service cholche na (npm run wa)" };
  if (r.status === 503) return { ok: false, connected: false, error: r.data.error || "WhatsApp not connected" };
  return { ok: !!r.data.ok, connected: true, error: r.data.error, id: r.data.id || null };
}
export async function waLogout(sessionId?: string): Promise<{ ok: boolean }> {
  const r = await call("/logout", { method: "POST", body: JSON.stringify({ sessionId }) });
  return { ok: r.status === 200 };
}

/* ── multi-device ─────────────────────────────────────────────────────────────────────── */
export type BridgeDevice = {
  sessionId: string; name?: string | null; status: string; connected: boolean;
  me?: string | null; phone?: string | null; qrPending?: boolean;
};
export async function waDevices(): Promise<{ running: boolean; devices: BridgeDevice[]; error?: string }> {
  const r = await call("/devices", undefined, 10000);
  if (r.status !== 200) return { running: false, devices: [], error: r.status === 0 ? "Bridge service cholche na" : r.data.error };
  return { running: true, devices: Array.isArray(r.data.devices) ? r.data.devices : [] };
}
/** Boot a session (creates the auth folder and the pairing QR). */
export async function waDeviceBoot(sessionId: string, name?: string): Promise<{ ok: boolean; error?: string; status?: string }> {
  const r = await call("/devices", { method: "POST", body: JSON.stringify({ sessionId, name }) }, 20000);
  if (r.status === 0) return { ok: false, error: "Bridge service cholche na" };
  return { ok: r.status === 200 && r.data.ok !== false, error: r.data.error, status: r.data.status };
}
export async function waDeviceQr(sessionId: string): Promise<{ connected: boolean; qr: string | null; status?: string; hint?: string }> {
  const r = await call(`/devices/${encodeURIComponent(sessionId)}/qr`, undefined, 15000);
  return { connected: !!r.data.connected, qr: r.data.qr || null, status: r.data.status, hint: r.data.hint };
}
export async function waDeviceLogout(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await call(`/devices/${encodeURIComponent(sessionId)}/logout`, { method: "POST" });
  return { ok: r.status === 200, error: r.data.error };
}
/** Images + caption. Phase 1 sent one photo (the order confirmation); the panel can now attach up
    to 10 — the first one carries the caption, the rest ride along as a gallery. */
export async function waSendMedia(opts: { to: string; image?: string; images?: string[]; caption?: string; sessionId?: string }): Promise<{ ok: boolean; connected: boolean; error?: string; id?: string | null; ids?: string[]; sentImages?: number; failedImages?: number }> {
  const images = (opts.images && opts.images.length ? opts.images : opts.image ? [opts.image] : []).slice(0, 10);
  const r = await call("/send-media", { method: "POST", body: JSON.stringify({ ...opts, images }) }, 90000);
  if (r.status === 0) return { ok: false, connected: false, error: "Bridge service cholche na (npm run wa)" };
  if (r.status === 503) return { ok: false, connected: false, error: r.data.error || "WhatsApp not connected" };
  const ids: string[] = [];
  if (r.data.id) ids.push(r.data.id);
  if (Array.isArray(r.data.ids)) for (const id of r.data.ids) if (id) ids.push(id);
  return {
    ok: !!r.data.ok, connected: true, error: r.data.error,
    id: ids[0] || r.data.id || null, ids,
    sentImages: Number(r.data.sentImages ?? images.length) || 0,
    failedImages: Number(r.data.failedImages ?? 0) || 0,
  };
}
export async function waHealth(): Promise<{ running: boolean; uptimeSec?: number; sessions?: number; connected?: number }> {
  const r = await call("/health", undefined, 8000);
  return { running: r.status === 200, uptimeSec: r.data.uptimeSec, sessions: r.data.sessions, connected: r.data.connected };
}

/** Key scripts/wa-worker.js uses to call the tick endpoint (Settings → WhatsApp, or env). */
export async function waWorkerKey(): Promise<string> {
  try {
    const s = await getSettings();
    const k = (s as any).whatsapp?.workerKey;
    if (k) return String(k);
  } catch {}
  return process.env.WA_WORKER_KEY || (await bridgeKey());
}
/* True when the request carries the worker key (or the bridge key — same trust level).
   Same hardened comparison as the bridge webhooks: constant-time, and a default/weak
   key is refused in production so /api/wa/tick cannot be driven by an anonymous caller. */
export async function waWorkerAuthorized(req: Request): Promise<boolean> {
  const sent = req.headers.get("x-wa-worker-key") || "";
  if (!sent || sent.length > 512) return false;
  const expected = await waWorkerKey();
  // An unconfigured (or trivially guessable) worker key is not acceptable on a
  // public endpoint in production — /api/wa/tick drains the outbound broadcast queue.
  if (IS_PROD && (expected === DEFAULT_BRIDGE_KEY || expected.length < 16)) return false;
  if (safeEqual(sent, expected)) return true;
  // The bridge key is accepted at the same trust level, through the same checks.
  return await verifyBridgeKey(req, "x-wa-worker-key");
}
