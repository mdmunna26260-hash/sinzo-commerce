import { getSettings, envFallback } from "./settings";

/* Courier fraud check via a provider API (default: fraudbd.com — documented API).
   Checks a customer's phone across Steadfast/Pathao/RedX/Paperfly delivery
   histories. Provider API key stays server-side; runs only from admin routes.
   If unconfigured → honest { configured:false }; NEVER faked. */

export type CourierStat = {
  name: string;
  total: number;
  success: number;
  cancel: number;
  successRate?: number;
  risk?: string;
  message?: string;
};

export type FraudCheckResult = {
  configured: boolean;
  ok: boolean;
  provider?: string;
  summary?: { total: number; success: number; cancel: number; successRate?: number; cancelRate?: number };
  couriers?: CourierStat[];
  error?: string;
};

export async function fraudCheckCfg() {
  const s = envFallback(await getSettings());
  const c = s.courier || {};
  const apiUrl = String(c.fraudApiUrl || "https://fraudbd.com/api/check-courier-info").trim();
  const apiKey = String(c.fraudApiKey || "").trim();
  const providerName = String(c.fraudProviderName || "FraudBD").trim() || "FraudBD";
  return { apiUrl, apiKey, providerName, configured: !!apiKey };
}

/* Default: only the documented provider. Extra hosts can be added with a
   comma-separated FRAUD_API_ALLOWLIST env var (host or full origin).
   The URL is stored in Admin → Settings → Courier, so without this an admin-editable
   field is a server-side request forgery primitive aimed at the store's own network. */
const DEFAULT_FRAUD_HOSTS = ["fraudbd.com"];

function fraudHostAllowed(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  const extra = String(process.env.FRAUD_API_ALLOWLIST || "").split(/[,\s]+/).filter(Boolean);
  const allowed = [...DEFAULT_FRAUD_HOSTS, ...extra];
  return allowed.some((entry) => {
    let h = entry.toLowerCase();
    try { h = new URL(h.includes("://") ? h : "https://" + h).hostname; } catch { /* keep raw */ }
    return host === h || host.endsWith("." + h);
  });
}

/* Returns the validated absolute URL, or null when the stored value must not be fetched. */
export function safeFraudApiUrl(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // plain http is only tolerable on loopback (a local mock during development)
  if (url.protocol === "http:" && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return null;
  if (!fraudHostAllowed(url.hostname)) return null;
  return url.toString();
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

export async function checkCourierFraud(phone: string): Promise<FraudCheckResult> {
  const cfg = await fraudCheckCfg();
  if (!cfg.configured) return { configured: false, ok: false, error: "Not configured — add the fraud-check API key in Admin > Settings > Courier" };
  const apiUrl = safeFraudApiUrl(cfg.apiUrl);
  if (!apiUrl) {
    return { configured: true, ok: false, provider: cfg.providerName, error: "Blocked fraud-check URL: the host is not allowlisted (FRAUD_API_ALLOWLIST) or the URL is not http(s)." };
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", api_key: cfg.apiKey },
      body: JSON.stringify({ phone_number: phone }),
      signal: AbortSignal.timeout(25000),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j?.status === false) return { configured: true, ok: false, provider: cfg.providerName, error: j?.message || `HTTP ${res.status}` };

    const summaries = j?.data?.Summaries || {};
    const couriers: CourierStat[] = [];
    for (const [name, v] of Object.entries<any>(summaries)) {
      const total = Number(v?.total) || 0;
      const success = Number(v?.success) || 0;
      const cancel = Number(v?.cancel) || 0;
      if (v?.data_type === "rating" && !total) {
        // rating-only entry (no delivery counts) — still useful risk info
        couriers.push({ name, total: 0, success: 0, cancel: 0, risk: v?.risk_level || v?.customer_rating, message: v?.message });
        continue;
      }
      if (!total && !success && !cancel) continue;
      couriers.push({ name, total, success, cancel, successRate: v?.success_rate != null ? Number(v.success_rate) : pct(success, total), risk: v?.risk_level, message: v?.message });
    }
    const ts = j?.data?.totalSummary || {};
    return {
      configured: true,
      ok: true,
      provider: cfg.providerName,
      couriers,
      summary: {
        total: Number(ts.total) || couriers.reduce((a, c) => a + c.total, 0),
        success: Number(ts.success) || couriers.reduce((a, c) => a + c.success, 0),
        cancel: Number(ts.cancel) || couriers.reduce((a, c) => a + c.cancel, 0),
        successRate: ts.successRate != null ? Number(ts.successRate) : undefined,
        cancelRate: ts.cancelRate != null ? Number(ts.cancelRate) : undefined,
      },
    };
  } catch (e: any) {
    return { configured: true, ok: false, provider: cfg.providerName, error: String(e?.message || e) };
  }
}

/* Our own store's history for this phone — always available, zero cost, real data */
export async function ownCustomerStats(phone: string) {
  const orders = await (await import("./db")).db.order.findMany({
    where: { phone },
    select: { status: true, total: true },
  });
  const delivered = orders.filter((o) => o.status === "DELIVERED").length;
  const cancelled = orders.filter((o) => o.status === "CANCELLED").length;
  const returned = orders.filter((o) => o.status === "RETURNED").length;
  const active = orders.filter((o) => !["CANCELLED", "RETURNED", "DELIVERED"].includes(o.status)).length;
  const known = delivered + cancelled + returned;
  return {
    totalOrders: orders.length,
    delivered,
    cancelled,
    returned,
    active,
    successRate: known ? pct(delivered, known) : null,
    spent: orders.filter((o) => o.status === "DELIVERED").reduce((a, o) => a + o.total, 0),
  };
}
