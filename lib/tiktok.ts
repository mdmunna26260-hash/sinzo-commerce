import crypto from "crypto";
import { db } from "./db";
import { getSettings, envFallback } from "./settings";

/* TikTok Events API — the server-side twin of the TikTok Pixel.
   Same contract as lib/capi.ts: the browser pixel and this call MUST use the same
   event_id, and TikTok dedups the pair on (pixel id, event name, event_id). So the
   browser copy is not "double counting" — it is the thing that makes the server copy
   deduplicate. */
export type TikTokEvent = {
  event: string; // TikTok standard event, e.g. "Purchase" (NOT "CompletePayment" — renamed in 2025)
  eventId: string;
  eventSourceUrl?: string;
  userData?: {
    phone?: string;
    email?: string;
    externalId?: string;
    clientIp?: string;
    userAgent?: string;
    ttclid?: string; // TikTok click id from the ad landing URL
  };
  properties?: Record<string, any>;
};

const sha256 = (v?: string) => {
  if (!v) return undefined;
  const clean = v.trim().toLowerCase();
  if (!clean) return undefined;
  return /^[0-9a-f]{64}$/.test(clean) ? clean : crypto.createHash("sha256").update(clean).digest("hex");
};

export function tiktokConfigured(): boolean {
  return !!(process.env.TIKTOK_PIXEL_ID || process.env.TIKTOK_ACCESS_TOKEN) || false;
}

export async function sendTikTokEvent(evt: TikTokEvent): Promise<{ ok: boolean; configured: boolean; error?: string }> {
  const s = envFallback(await getSettings());
  const pixelId = s.integrations?.tiktokPixelId;
  const token = s.integrations?.tiktokAccessToken;
  if (!pixelId || !token) {
    await db.trackingEvent.create({ data: { name: evt.event, eventId: evt.eventId, source: "tiktok", payload: JSON.stringify(evt.properties || {}), ok: false, error: "Not Configured: missing TikTok Pixel ID or Access Token" } }).catch(() => {});
    return { ok: false, configured: false, error: "Not Configured" };
  }
  /* TikTok matches on email / phone / external_id, all SHA-256 of the lowercased value.
     ip + user_agent are sent raw (they are not PII-hashed fields on TikTok). */
  const user: Record<string, any> = {
    email: sha256(evt.userData?.email),
    phone: sha256(evt.userData?.phone),
    external_id: sha256(evt.userData?.externalId),
    ttclid: evt.userData?.ttclid,
    ip: evt.userData?.clientIp,
    user_agent: evt.userData?.userAgent,
  };
  for (const k of Object.keys(user)) if (user[k] === undefined || user[k] === "") delete user[k];
  const payload: any = {
    event_source: "web",
    event_source_id: pixelId,
    data: [{
      event: evt.event,
      event_time: Math.floor(Date.now() / 1000),
      event_id: evt.eventId,
      user,
      ...(evt.eventSourceUrl ? { page: { url: evt.eventSourceUrl } } : {}),
      ...(evt.properties ? { properties: evt.properties } : {}),
    }],
  };
  const testCode = s.integrations?.tiktokTestEventCode;
  if (testCode) payload.test_event_code = testCode;
  try {
    const res = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Access-Token": token },
      body: JSON.stringify(payload),
    });
    const json: any = await res.json().catch(() => ({}));
    // TikTok answers 200 even for rejected events; code 0 is the only real success.
    const ok = res.ok && (json.code === 0 || json.code === undefined);
    const error = ok ? undefined : (json.message || json.msg || `HTTP ${res.status}`);
    await db.trackingEvent.create({ data: { name: evt.event, eventId: evt.eventId, source: "tiktok", payload: JSON.stringify({ properties: evt.properties, matchKeys: Object.keys(user), response: json }), ok, error } }).catch(() => {});
    return { ok, configured: true, error };
  } catch (e: any) {
    await db.trackingEvent.create({ data: { name: evt.event, eventId: evt.eventId, source: "tiktok", payload: JSON.stringify(evt.properties || {}), ok: false, error: String(e?.message || e) } }).catch(() => {});
    return { ok: false, configured: true, error: String(e?.message || e) };
  }
}
