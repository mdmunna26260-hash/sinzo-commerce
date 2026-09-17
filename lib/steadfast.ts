import { getSettings, envFallback } from "./settings";

/* Steadfast Courier API client (official V1 docs).
   Auth = CUSTOM HEADERS: "Api-Key" + "Secret-Key" (NOT Basic auth).
   Base: https://portal.packzy.com/api/v1 (configurable in Settings > Courier). */
type Cfg = { apiUrl: string; apiKey: string; secretKey: string; configured: boolean };

export async function steadfastCfg(): Promise<Cfg> {
  const s = envFallback(await getSettings());
  const c = s.courier || {};
  const apiUrl = (c.apiUrl || "https://portal.packzy.com/api/v1").replace(/\/+$/, "");
  const apiKey = c.apiKey || "";
  const secretKey = c.secretKey || "";
  return { apiUrl, apiKey, secretKey, configured: !!(apiKey && secretKey) };
}
function authHeaders(cfg: { apiKey: string; secretKey: string }) {
  return { "Api-Key": cfg.apiKey, "Secret-Key": cfg.secretKey, "Content-Type": "application/json", Accept: "application/json" };
}

export async function createConsignment(order: any): Promise<{ ok: boolean; configured: boolean; data?: any; error?: string }> {
  const cfg = await steadfastCfg();
  if (!cfg.configured) return { ok: false, configured: false, error: "Not Configured: add Steadfast API Key & Secret in Admin > Settings > Courier" };
  const codAmount = Math.max(0, Math.round(order.total));
  const body = {
    invoice: order.code,
    recipient_name: order.name,
    recipient_phone: order.phone,
    recipient_address: order.address,
    cod_amount: codAmount,
    note: order.notes || "",
  };
  try {
    const res = await fetch(cfg.apiUrl + "/create_order", {
      method: "POST", headers: authHeaders(cfg), body: JSON.stringify(body), signal: AbortSignal.timeout(30000), cache: "no-store",
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json.status >= 400) return { ok: false, configured: true, error: json.message || `HTTP ${res.status}` };
    // normalize: { status:200, consignment: { consignment_id, tracking_code, delivery status... } }
    const c = json.consignment || {};
    return { ok: true, configured: true, data: {
      consignment_id: c.consignment_id ?? json.consignment_id,
      tracking_code: c.tracking_code ?? json.tracking_code,
      delivery_status: c.status ?? json.delivery_status ?? "in_review",
      raw: json,
    } };
  } catch (e: any) { return { ok: false, configured: true, error: String(e?.message || e) }; }
}

export async function checkStatusByTracking(trackingCode: string): Promise<{ ok: boolean; configured: boolean; data?: any; error?: string }> {
  const cfg = await steadfastCfg();
  if (!cfg.configured) return { ok: false, configured: false, error: "Not Configured" };
  try {
    const res = await fetch(`${cfg.apiUrl}/status_by_trackingcode/${encodeURIComponent(trackingCode)}`, {
      headers: authHeaders(cfg), signal: AbortSignal.timeout(20000), cache: "no-store",
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, configured: true, error: json.message || `HTTP ${res.status}` };
    return { ok: true, configured: true, data: json }; // { status:200, delivery_status }
  } catch (e: any) { return { ok: false, configured: true, error: String(e?.message || e) }; }
}

export async function checkStatusByConsignment(consignmentId: string): Promise<{ ok: boolean; configured: boolean; data?: any; error?: string }> {
  const cfg = await steadfastCfg();
  if (!cfg.configured) return { ok: false, configured: false, error: "Not Configured" };
  try {
    const res = await fetch(`${cfg.apiUrl}/status_by_cid/${encodeURIComponent(consignmentId)}`, {
      headers: authHeaders(cfg), signal: AbortSignal.timeout(20000), cache: "no-store",
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, configured: true, error: json.message || `HTTP ${res.status}` };
    return { ok: true, configured: true, data: json };
  } catch (e: any) { return { ok: false, configured: true, error: String(e?.message || e) }; }
}

export async function checkBalance(): Promise<{ ok: boolean; configured: boolean; data?: any; error?: string }> {
  const cfg = await steadfastCfg();
  if (!cfg.configured) return { ok: false, configured: false, error: "Not Configured" };
  try {
    const res = await fetch(cfg.apiUrl + "/get_balance", { headers: authHeaders(cfg), signal: AbortSignal.timeout(20000), cache: "no-store" });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json.status >= 400) return { ok: false, configured: true, error: json.message || `HTTP ${res.status}`, data: json };
    return { ok: true, configured: true, data: json }; // { status:200, current_balance }
  } catch (e: any) { return { ok: false, configured: true, error: String(e?.message || e) }; }
}

// Health check: real /get_balance call — 200 = credentials accepted.
export async function testConnection(): Promise<{ ok: boolean; configured: boolean; detail: string; data?: any; error?: string }> {
  const cfg = await steadfastCfg();
  if (!cfg.configured) return { ok: false, configured: false, detail: "API Key & Secret Key din" };
  const r = await checkBalance();
  if (r.ok) return { ok: true, configured: true, detail: `Connected ✓ (balance: ৳${r.data?.current_balance ?? "?"})`, data: r.data };
  return { ok: false, configured: true, detail: r.error || "API unreachable", data: r.data };
}

/* Friendly status mapping for customer-facing tracking (Steadfast raw → label). */
export function mapSteadfastStatus(raw?: string | null): { label: string; tone: "ok" | "warn" | "bad" | "info" } {
  const s = (raw || "").toLowerCase();
  if (s === "delivered") return { label: "Delivered", tone: "ok" };
  if (s === "partial_delivered") return { label: "Partially Delivered", tone: "warn" };
  if (s === "cancelled") return { label: "Cancelled", tone: "bad" };
  if (s === "hold") return { label: "On Hold", tone: "warn" };
  if (s === "in_review") return { label: "Pending — Picked Up Soon", tone: "info" };
  if (s === "pending") return { label: "Pending", tone: "info" };
  if (s.endsWith("approval_pending")) return { label: "Processing (Approval Pending)", tone: "info" };
  if (s === "picked_up" || s === "in_transit") return { label: s === "picked_up" ? "Picked Up" : "In Transit", tone: "info" };
  if (s === "unknown") return { label: "Status Unknown — Contact Support", tone: "warn" };
  if (!raw) return { label: "Unknown", tone: "info" };
  const words = raw.replace(/[_-]+/g, " ").trim();
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: "info" };
}

/* ============ FREE Steadfast fraud check (merchant web feature) ============
   Steadfast's own merchant dashboard has a free fraud lookup at
   /user/frauds/check/{phone}. It needs the merchant's WEB login (email +
   password, same as portal.packzy.com) — not the API keys. We reproduce that
   flow server-side: CSRF login → JSON stats {total_delivered, total_cancelled}.
   Session cookies are cached ~25 min so we don't log in on every check. */

type StfSession = { cookie: string; at: number };
let stfSession: StfSession | null = null;

export async function stfWebCfg() {
  const s = envFallback(await getSettings());
  const c = s.courier || {};
  const email = String(c.stfEmail || "").trim();
  const password = String(c.stfPassword || "").trim();
  return { email, password, configured: !!(email && password) };
}

function mergeCookies(...sets: string[]): string {
  const map = new Map<string, string>();
  for (const set of sets) {
    for (const kv of set.split("; ")) {
      const i = kv.indexOf("=");
      if (i > 0) map.set(kv.slice(0, i), kv.slice(i + 1));
    }
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function stfLogin(email: string, password: string): Promise<string> {
  const r0 = await fetch("https://steadfast.com.bd/login", { redirect: "manual", signal: AbortSignal.timeout(20000), cache: "no-store" });
  const html = await r0.text();
  const token = /name="_token"\s+value="(.*?)"/.exec(html)?.[1] || /name="_token" value="(.*?)"/.exec(html)?.[1];
  if (!token) throw new Error("Steadfast login page changed (no CSRF token)");
  const c0 = r0.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const r1 = await fetch("https://steadfast.com.bd/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: c0,
      Referer: "https://steadfast.com.bd/login",
      "User-Agent": "Mozilla/5.0 (compatible; SINZO/1.0)",
    },
    body: new URLSearchParams({ _token: token, email, password }),
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  const c1 = r1.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const cookie = mergeCookies(c0, c1);
  const okLogin = r1.ok || (r1.status >= 300 && r1.status < 400);
  if (!okLogin || !cookie.includes("session")) throw new Error("Steadfast web login failed — check merchant email/password");
  return cookie;
}

export type FreeFraudResult = { configured: boolean; ok: boolean; provider: string; summary?: { total: number; success: number; cancel: number; successRate?: number }; error?: string };

export async function steadfastFreeFraudCheck(phone: string): Promise<FreeFraudResult> {
  const cfg = await stfWebCfg();
  if (!cfg.configured) return { configured: false, ok: false, provider: "Steadfast (free)", error: "Add merchant web email & password in Settings > Courier" };
  const run = async (): Promise<FreeFraudResult> => {
    if (!stfSession) throw new Error("no-session");
    const r = await fetch(`https://steadfast.com.bd/user/frauds/check/${encodeURIComponent(phone)}`, {
      headers: { Cookie: stfSession.cookie, Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; SINZO/1.0)" },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    if (r.status === 302 || r.status === 401 || r.status === 419) throw new Error("session-expired");
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
    const success = Number(j.total_delivered) || 0;
    const cancel = Number(j.total_cancelled) || 0;
    const total = success + cancel;
    return {
      configured: true, ok: true, provider: "Steadfast (free)",
      summary: { total, success, cancel, successRate: total ? Math.round((success / total) * 1000) / 10 : 0 },
    };
  };
  try {
    if (!stfSession || Date.now() - stfSession.at > 25 * 60 * 1000) {
      stfSession = { cookie: await stfLogin(cfg.email, cfg.password), at: Date.now() };
    }
    return await run();
  } catch (e: any) {
    stfSession = null; // force fresh login next time
    // one retry (first attempt may have used a stale session)
    if (String(e?.message) !== "no-session") {
      try {
        stfSession = { cookie: await stfLogin(cfg.email, cfg.password), at: Date.now() };
        return await run();
      } catch (e2: any) {
        return { configured: true, ok: false, provider: "Steadfast (free)", error: String(e2?.message || e2) };
      }
    }
    return { configured: true, ok: false, provider: "Steadfast (free)", error: String(e?.message || e) };
  }
}

/* ============ live status, normalized for the storefront ============
   The courier payload is not stable across API versions: the status can sit at the top
   level or under `data`/`result`, and the event list may be called tracking_history,
   events or status_history with date/time/created_at. So we look the same three things
   up in every place they might be, and read ONLY customer-safe fields — the raw response
   also carries the recipient's name, phone and address, and none of that may leave a
   public tracking endpoint. */
export type LiveEvent = { label: string; at: string | null; location: string | null };
export type LiveStatus = {
  raw: string | null;
  label: string;
  tone: "ok" | "warn" | "bad" | "info";
  events: LiveEvent[];
  courier: string | null;
  consignmentId: string | null;
  trackingCode: string | null;
  updatedAt: string | null;
};

const HISTORY_KEYS = ["tracking_history", "history", "events", "status_history", "trackings", "timeline", "status_list"];
const isObj = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);

function firstString(objs: any[], keys: string[]): string | null {
  for (const o of objs) {
    if (!o) continue;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      // ids are often numeric; keep them as text so the UI can print them verbatim
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  return null;
}

/** "2026-09-15 11:20:00" parses in Chrome but not Safari — normalise the space before Date(). */
export function parseCourierDate(s?: string | null): Date | null {
  if (!s) return null;
  const raw = String(s).trim();
  if (!raw) return null;
  const isoish = /\d{4}-\d{2}-\d{2}[ T]\d{2}:/.test(raw) && !/Z|[+-]\d{2}:?\d{2}$/.test(raw) ? raw.replace(" ", "T") : raw;
  const d = new Date(/^\d+$/.test(isoish) ? Number(isoish) * (isoish.length <= 10 ? 1000 : 1) : isoish);
  return isNaN(d.getTime()) ? null : d;
}

export function readLiveStatus(json: any): LiveStatus | null {
  if (!isObj(json)) return null;
  const objs = [json, isObj(json.data) ? json.data : null, isObj(json.result) ? json.result : null, isObj(json.consignment) ? json.consignment : null].filter(Boolean) as any[];
  // `status` on these payloads is usually the HTTP code (200), so it is deliberately not a status key.
  const raw = firstString(objs, ["delivery_status", "current_status", "courier_status", "order_status", "consignment_status"]);
  let rows: any[] = [];
  for (const o of objs) {
    for (const k of HISTORY_KEYS) {
      if (Array.isArray(o?.[k]) && o[k].length) { rows = o[k]; break; }
    }
    if (rows.length) break;
  }

  const events: LiveEvent[] = rows
    .filter((e: any) => isObj(e) || typeof e === "string")
    .map((e: any) => {
      const one = typeof e === "string" ? { status: e } : e;
      const v = firstString([one], ["status", "state", "delivery_status", "title", "message", "description", "note"]) || "";
      return {
        label: mapSteadfastStatus(v).label,
        at: firstString([one], ["date", "time", "created_at", "updated_at", "status_date", "event_time", "at"]),
        location: firstString([one], ["location", "area", "city", "branch", "station", "center", "from", "warehouse"]),
        _d: parseCourierDate(firstString([one], ["date", "time", "created_at", "updated_at", "status_date", "event_time", "at"]))?.getTime() ?? null,
      };
    });
  // chronological, oldest first — the UI renders a top-down trail with the newest at the end.
  events.sort((a: any, b: any) => (a._d ?? 0) - (b._d ?? 0));
  for (const e of events) delete (e as any)._d;
  const trimmed = (events.length > 14 ? events.slice(-14) : events) as LiveEvent[];

  if (!raw && !trimmed.length) return null;
  const m = mapSteadfastStatus(raw);
  const last = trimmed[trimmed.length - 1];
  return {
    raw: raw ?? null,
    // if the header status is missing but a trail exists, the newest event is the truth.
    label: raw ? m.label : last?.label || "In Transit",
    tone: raw ? m.tone : "info",
    events: trimmed,
    courier: firstString(objs, ["courier_name", "courier", "service_name", "provider"]),
    consignmentId: firstString(objs, ["consignment_id", "consignmentId", "cid"]),
    trackingCode: firstString(objs, ["tracking_code", "trackingCode", "tracking_number", "waybill"]),
    updatedAt: firstString(objs, ["updated_at", "status_updated_at", "last_update", "last_updated"]) || last?.at || null,
  };
}

/* Short-lived live cache, shared by every caller that hits the courier for a status.
   Two reasons: the customer's "refresh" button must not turn into a Steadfast hammer,
   and the public tracking endpoint's per-IP limiter (15/min) would otherwise be burned by
   one impatient shopper. Keyed by whichever identifier we asked about. In-process only —
   a cold instance simply re-reads the courier, which is the correct fallback. */
const LIVE_TTL_MS = 60_000;
const liveCache = new Map<string, { at: number; body: any }>();

export function cachedLiveBody(key: string, force = false): { body: any; at: number } | null {
  if (force) return null;
  const hit = liveCache.get(key);
  return hit && Date.now() - hit.at < LIVE_TTL_MS ? { body: hit.body, at: hit.at } : null;
}

export function rememberLiveBody(key: string, body: any) {
  if (liveCache.size > 500) liveCache.clear(); // cheap bound; keys are shopper-supplied
  liveCache.set(key, { at: Date.now(), body });
}
