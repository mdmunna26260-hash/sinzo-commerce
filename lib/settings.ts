import { db } from "./db";
export type SettingsMap = Record<string, any>;
let cache: { data: SettingsMap; at: number } | null = null;
const TTL = 3000;

export async function getSettings(force = false): Promise<SettingsMap> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  const rows = await db.setting.findMany();
  const out: SettingsMap = {};
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
  cache = { data: out, at: Date.now() };
  return out;
}
export function publicSettings(s: SettingsMap) {
  return {
    store: s.store, theme: s.theme, shipping: {
      insideDhaka: s.shipping?.insideDhaka, outsideDhaka: s.shipping?.outsideDhaka,
      freeShippingThreshold: s.shipping?.freeShippingThreshold,
      estimateInside: s.shipping?.estimateInside, estimateOutside: s.shipping?.estimateOutside,
    },
    homepage: s.homepage, checkout: s.checkout, seo: s.seo,
    integrations: {
      metaPixelId: s.integrations?.metaPixelId || process.env.META_PIXEL_ID || "",
      ga4Id: s.integrations?.ga4Id || process.env.GA4_MEASUREMENT_ID || "",
      gtmId: s.integrations?.gtmId || process.env.GTM_ID || "",
    },
    maintenance: s.maintenance,
  };
}
export async function saveGroup(key: string, value: any) {
  await db.setting.upsert({ where: { key }, update: { value: JSON.stringify(value) }, create: { key, value: JSON.stringify(value) } });
  cache = null;
}
export function envFallback(s: SettingsMap): SettingsMap {
  const out = JSON.parse(JSON.stringify(s));
  out.courier = out.courier || {};
  out.courier.apiUrl = out.courier.apiUrl || process.env.STEADFAST_API_URL || "";
  out.courier.apiKey = out.courier.apiKey || process.env.STEADFAST_API_KEY || "";
  out.courier.secretKey = out.courier.secretKey || process.env.STEADFAST_SECRET_KEY || "";
  out.integrations = out.integrations || {};
  out.integrations.metaAccessToken = out.integrations.metaAccessToken || process.env.META_ACCESS_TOKEN || "";
  out.integrations.metaPixelId = out.integrations.metaPixelId || process.env.META_PIXEL_ID || "";
  out.integrations.metaTestEventCode = out.integrations.metaTestEventCode || process.env.META_TEST_EVENT_CODE || "";
  return out;
}
