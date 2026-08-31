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

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

export async function checkCourierFraud(phone: string): Promise<FraudCheckResult> {
  const cfg = await fraudCheckCfg();
  if (!cfg.configured) return { configured: false, ok: false, error: "Not configured — add the fraud-check API key in Admin > Settings > Courier" };
  try {
    const res = await fetch(cfg.apiUrl, {
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
