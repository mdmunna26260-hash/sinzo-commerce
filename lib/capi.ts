import crypto from "crypto";
import { db } from "./db";
import { getSettings, envFallback } from "./settings";

export type CapiEvent = {
  eventName: string; // e.g. "Purchase"
  eventId: string;
  eventSourceUrl?: string;
  userData?: { phone?: string; clientIp?: string; userAgent?: string; fbp?: string; fbc?: string; externalId?: string };
  customData?: Record<string, any>;
};
const sha256 = (v?: string) => (v ? crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex") : undefined);

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
  const payload: any = {
    data: [{
      event_name: evt.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: evt.eventId,
      action_source: "website",
      event_source_url: evt.eventSourceUrl,
      user_data: {
        ph: [sha256(evt.userData?.phone)].filter(Boolean),
        client_ip_address: evt.userData?.clientIp,
        client_user_agent: evt.userData?.userAgent,
        fbp: evt.userData?.fbp,
        fbc: evt.userData?.fbc,
        external_id: evt.userData?.externalId ? [sha256(evt.userData.externalId)] : undefined,
      },
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
    await db.trackingEvent.create({ data: { name: evt.eventName, eventId: evt.eventId, source: "capi", payload: JSON.stringify({ custom: evt.customData, response: json }), ok, error: json.error?.message } }).catch(() => {});
    return { ok, configured: true, error: json.error?.message };
  } catch (e: any) {
    await db.trackingEvent.create({ data: { name: evt.eventName, eventId: evt.eventId, source: "capi", payload: JSON.stringify(evt.customData || {}), ok: false, error: String(e?.message || e) } }).catch(() => {});
    return { ok: false, configured: true, error: String(e?.message || e) };
  }
}
