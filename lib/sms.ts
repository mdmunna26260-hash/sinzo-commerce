import { db } from "./db";
import { logApp } from "./logs";
import type { SettingsMap } from "./settings";

/* SMS through a Bangladeshi gateway.
   Providers are honest about what is configured: without a key nothing is sent and the reason
   is logged, exactly like the courier and SMTP integrations on this site. Two named gateways
   (BulkSMSBD, GreenWeb) cover most BD installs, and "custom" lets an admin paste any GET URL
   with {key} {sender} {to} {msg} placeholders, so switching provider never needs a code change.
   Every attempt — success or failure — lands in AppLog, which is what admin → Logs shows. */

export type SmsCfg = { enabled?: boolean; provider?: string; apiKey?: string; senderId?: string; url?: string };

export function smsCfg(s: SettingsMap): SmsCfg {
  return ((s as any).notifications?.sms || {}) as SmsCfg;
}

export function smsConfigured(s: SettingsMap): boolean {
  const c = smsCfg(s);
  return !!(c.enabled !== false && c.apiKey && (c.provider === "custom" ? c.url : true));
}

/** BD numbers are stored however the customer typed them; gateways want 8801XXXXXXXXX. */
export function normalizeBdPhone(phone: string): string {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("880")) return d;
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) return "880" + d;
  return d;
}

function buildUrl(c: SmsCfg, to: string, message: string): string {
  const fill = (t: string) => t
    .replace(/\{key\}/g, encodeURIComponent(c.apiKey || ""))
    .replace(/\{sender\}/g, encodeURIComponent(c.senderId || ""))
    .replace(/\{to\}/g, encodeURIComponent(to))
    .replace(/\{msg\}/g, encodeURIComponent(message));
  switch ((c.provider || "bulksmsbd").toLowerCase()) {
    case "greenweb":
      return fill("https://api.greenweb.com.bd/api.php?token={key}&to={to}&message={msg}");
    case "mimsms":
      return fill("https://api.mimsms.com/api/SmsSending/SMS?ApiKey={key}&SenderId={sender}&Number={to}&MessageText={msg}");
    case "custom":
      return fill(c.url || "");
    case "bulksmsbd":
    default:
      return fill("https://bulksmsbd.net/api/smsapi?api_key={key}&type=text&number={to}&senderid={sender}&message={msg}");
  }
}

export type SmsResult = { ok: boolean; configured: boolean; provider: string; error?: string; response?: string };

/** Send one SMS and record it. Never throws — a notification must not break an order flow. */
export async function sendSms(s: SettingsMap, phone: string, message: string, kind = "manual"): Promise<SmsResult> {
  const c = smsCfg(s);
  const provider = (c.provider || "bulksmsbd").toLowerCase();
  if (!smsConfigured(s)) {
    const r = { ok: false, configured: false, provider, error: "SMS gateway is not configured (Settings → Notifications → SMS)" };
    await logApp("WARN", "SMS", `${kind}: not sent — ${r.error}`, { to: normalizeBdPhone(phone) });
    return r;
  }
  const to = normalizeBdPhone(phone);
  if (to.length < 11) {
    const r = { ok: false, configured: true, provider, error: "Not a usable BD phone number: " + phone };
    await logApp("WARN", "SMS", `${kind}: bad number (${phone})`);
    return r;
  }
  const url = buildUrl(c, to, message);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = (await res.text().catch(() => "")).slice(0, 300);
    /* the gateways answer with plain text or JSON — anything other than a 2xx, or a body that
       says "error"/"invalid", is treated as a failure rather than a success we made up */
    const bad = !res.ok || /error|invalid|failed|insufficient|not\s*found/i.test(text);
    if (bad) {
      await logApp("ERROR", "SMS", `${kind}: gateway rejected the send (${res.status})`, { to, response: text });
      return { ok: false, configured: true, provider, error: `Gateway replied ${res.status}: ${text.slice(0, 120)}`, response: text };
    }
    await logApp("INFO", "SMS", `${kind}: sent to ${to}`, { provider, response: text });
    return { ok: true, configured: true, provider, response: text };
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 160);
    await logApp("ERROR", "SMS", `${kind}: send failed — ${error}`, { to });
    return { ok: false, configured: true, provider, error };
  }
}

/** Counts for the settings badge / logs screen. */
export async function smsStats() {
  const [sent, failed] = await Promise.all([
    db.appLog.count({ where: { kind: "SMS", level: "INFO" } }),
    db.appLog.count({ where: { kind: "SMS", level: { in: ["WARN", "ERROR"] } } }),
  ]);
  return { sent, failed };
}

/* ---- Templates ---------------------------------------------------------------
   {name} {code} {amount} {courier} {tracking} are filled from the order. Keep them short:
   a BD SMS is billed per 160-character part, so the store pays less for a tight message. */
export const SMS_TEMPLATES: { id: string; label: string; when: string; body: string }[] = [
  { id: "confirm", label: "Order confirmed", when: "CONFIRMED", body: "Sinzo: {name}, apnar order {code} confirm hoyeche. Amount {amount}. Track: " },
  { id: "shipped", label: "Parcel on the way", when: "SHIPPED", body: "Sinzo: order {code} courier-e deya hoyeche ({courier}). Tracking: {tracking}. Delivery somoy phone khola rakhun." },
  { id: "packed", label: "Packed, dispatch today", when: "PACKED", body: "Sinzo: order {code} pack hoyeche, aj dispatch hobe. Dhonnobad!" },
  { id: "delivered", label: "Delivered", when: "DELIVERED", body: "Sinzo: order {code} deliver hoyeche. Dhonnobad! Review din — sinzooffcial.com/products" },
  { id: "cancelled", label: "Order cancelled", when: "CANCELLED", body: "Sinzo: order {code} cancel kora hoyeche. Kono proshno thakle ei number-e reply din." },
  { id: "advance", label: "Advance payment request", when: "manual", body: "Sinzo: order {code} er advance {amount} pathate paren bKash-e. Payment er por parcel dispatch hobe." },
  { id: "waitlist", label: "Back in stock", when: "manual", body: "Sinzo: apni je product er jonno wait korechilen seta abar stock-e ache. Ekhon-i order korun!" },
];

export function fillTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}

/** Auto-SMS on an order status change — only for statuses the admin switched on in Settings.
    Fire-and-forget from the order routes: a gateway outage must never fail a status update. */
export async function autoSmsOnStatus(s: SettingsMap, status: string, order: any): Promise<boolean> {
  const tpl = SMS_TEMPLATES.find((t) => t.when === status);
  if (!tpl) return false;
  const key = "sms_on_" + status.toLowerCase();
  if (((s as any).notifications || {})[key] !== true) return false;
  if (!smsConfigured(s)) return false;
  const msg = fillTemplate(tpl.body, {
    name: order.name, code: order.code, amount: "৳" + Math.round(order.total || 0).toLocaleString("en-IN"),
    courier: order.courierName || "courier", tracking: order.courierConsignmentId || order.code, area: order.area,
  });
  const r = await sendSms(s, order.phone, msg, `auto:${status.toLowerCase()}`);
  return r.ok;
}
