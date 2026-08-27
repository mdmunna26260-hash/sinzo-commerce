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
  const codAmount = Math.max(0, Math.round((order.total - order.deliveryFee > 0 ? order.total - order.deliveryFee : order.total)));
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
      method: "POST", headers: authHeaders(cfg), body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
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
      headers: authHeaders(cfg), signal: AbortSignal.timeout(20000),
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
      headers: authHeaders(cfg), signal: AbortSignal.timeout(20000),
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
    const res = await fetch(cfg.apiUrl + "/get_balance", { headers: authHeaders(cfg), signal: AbortSignal.timeout(20000) });
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
