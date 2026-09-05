import crypto from "crypto";
import { db } from "./db";
import { getSettings, envFallback } from "./settings";

export type CapiEvent = {
  eventName: string; // e.g. "Purchase"
  eventId: string;
  eventSourceUrl?: string;
  userData?: {
    phone?: string;
    email?: string;
    name?: string; // full name — split into fn/ln automatically
    clientIp?: string;
    userAgent?: string;
    fbp?: string;
    fbc?: string;
    externalId?: string;
  };
  customData?: Record<string, any>;
};
const sha256 = (v?: string) => {
  if (!v) return undefined;
  const clean = v.trim().toLowerCase();
  if (!clean) return undefined;
  // already a sha256 hex? send as-is (client-side pre-hashed)
  return /^[0-9a-f]{64}$/.test(clean) ? clean : crypto.createHash("sha256").update(clean).digest("hex");
};

export function metaConfigured(): boolean {
  return !!(process.env.META_PIXEL_ID || process.env.META_ACCESS_TOKEN) || false;
}
export async function sendCapi(evt: CapiEvent): Promise<{ ok: boolean; configured: boolean; error?: string }> {
  const s = envFallback(await getSettings());
  const pixelId = s.integrations?.metaPixelId;
  const token = s.integrations?.metaAccessToken;
  const testCode = s.integrations?.metaTestEventCode;
  if (!pixelId || !token) {
    await db.trackingEvent.create({ data: { name: evt.eventName, eventId: evt.eventId, source: "capi", payload: JSON.stringify(evt.customData || {}), ok: false, error: "Not Configured: missing Pixel ID or Access Token" } }).catch(() => {});
    return { ok: false, configured: false, error: "Not Configured" };
  }
  // Advanced matching boosts Event Match Quality (EMQ):
  // external_id + ph (phone) + em (email) + fn/ln (name) + country + fbp/fbc.
  // external_id = normalized phone, consistent with the browser pixel's
  // advanced matching payload so both sides land on the SAME Meta persona.
  const phone = evt.userData?.phone?.trim();
  const nameParts = (evt.userData?.name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts.length ? nameParts[0] : undefined;
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined;
  const userData: Record<string, any> = {
    ph: [sha256(phone)].filter(Boolean),
    em: [sha256(evt.userData?.email)].filter(Boolean),
    fn: [sha256(firstName)].filter(Boolean),
    ln: [sha256(lastName)].filter(Boolean),
    external_id: evt.userData?.externalId ? [sha256(evt.userData.externalId)] : undefined,
    country: ["bd"], // plain ISO-2 lowercase (Meta: country is NOT hashed)
    client_ip_address: evt.userData?.clientIp,
    client_user_agent: evt.userData?.userAgent,
    fbp: evt.userData?.fbp,
    fbc: evt.userData?.fbc,
  };
  for (const k of Object.keys(userData)) if (userData[k] === undefined || (Array.isArray(userData[k]) && !userData[k].length)) delete userData[k];
  const payload: any = {
    data: [{
      event_name: evt.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: evt.eventId,
      action_source: "website",
      event_source_url: evt.eventSourceUrl,
      user_data: userData,
      custom_data: evt.customData,
    }],
  };
  if (testCode) payload.test_event_code = testCode;
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const json: any = await res.json().catch(() => ({}));
    const ok = res.ok && !json.error;
    await db.trackingEvent.create({ data: { name: evt.eventName, eventId: evt.eventId, source: "capi", payload: JSON.stringify({ custom: evt.customData, matchKeys: Object.keys(userData), response: json }), ok, error: json.error?.message } }).catch(() => {});
    return { ok, configured: true, error: json.error?.message };
  } catch (e: any) {
    await db.trackingEvent.create({ data: { name: evt.eventName, eventId: evt.eventId, source: "capi", payload: JSON.stringify(evt.customData || {}), ok: false, error: String(e?.message || e) } }).catch(() => {});
    return { ok: false, configured: true, error: String(e?.message || e) };
  }
}
