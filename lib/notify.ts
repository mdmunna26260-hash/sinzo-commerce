import { db } from "./db";
import { getSettings, envFallback } from "./settings";
import { waSend, waStatus } from "./wa";

/* Notification abstraction (PDF §38): in-app center (always) + Telegram + SMTP email.
   Channels are independent; unconfigured channels are skipped honestly (never faked). */
export type NotifyEvent = "order.placed" | "order.confirmed" | "order.cancelled" | "order.shipped" | "order.delivered" | "test";

async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j: any = await res.json().catch(() => ({}));
    return res.ok && j.ok;
  } catch { return false; }
}

async function sendMail(cfg: any, to: string, subject: string, html: string): Promise<boolean> {
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: cfg.host, port: Number(cfg.port) || 587, secure: !!cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transport.sendMail({ from: cfg.from || cfg.user, to, subject, html });
    return true;
  } catch { return false; }
}

function emailHtml(title: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#141414">
    <div style="font-size:22px;letter-spacing:.25em;border-bottom:2px solid #141414;padding-bottom:12px;margin-bottom:18px">SINZO</div>
    <h2 style="margin:0 0 10px">${title}</h2>
    <div style="font-size:14px;line-height:1.7;color:#444;white-space:pre-line">${body}</div>
    <div style="margin-top:26px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">Sinzo Commerce Platform — automated notification</div>
  </div>`;
}

export async function notifyAdmin(evt: NotifyEvent, title: string, body: string, ref?: string): Promise<{ inApp: boolean; telegram: boolean | null; email: boolean | null; whatsapp: boolean | null }> {
  // 1) in-app notification center (always)
  let inApp = true;
  try { await db.notification.create({ data: { type: evt, title, body, ref } }); } catch { inApp = false; }
  // 2) channels
  let telegram: boolean | null = null;
  let email: boolean | null = null;
  let whatsapp: boolean | null = null;
  try {
    const s = envFallback(await getSettings());
    const n = s.notifications || {};
    const key = evt.replace(".", "_");
    const eventOn = evt === "test" || n[key] !== false;
    if (n.enabled !== false && eventOn) {
      if (n.telegramBotToken && n.telegramChatId) {
        telegram = await sendTelegram(n.telegramBotToken, n.telegramChatId, `<b>${title}</b>\n${body}`);
      }
      if (n.smtp?.host && n.smtp?.user && n.smtp?.pass && n.notifyEmail) {
        email = await sendMail(n.smtp, n.notifyEmail, `[Store] ${title}`, emailHtml(title, body));
      }
      if (n.waEnabled !== false && n.waNotifyNumber) {
        const st = await waStatus();
        if (st.connected) {
          const lines = body.replace(/<[^>]+>/g, "");
          whatsapp = (await waSend(n.waNotifyNumber, `*${title}*\n${lines}${ref ? `\nRef: ${ref}` : ""}`)).ok;
        } else whatsapp = false;
      }
    }
  } catch {}
  return { inApp, telegram, email, whatsapp };
}

/* Customer order-confirmation via WhatsApp (linked device). */
export async function whatsappCustomerOrder(to: string, name: string, order: { code: string; total: number; area: string; items: { title: string; qty: number; price: number }[] }) {
  try {
    const s = envFallback(await getSettings());
    const n = s.notifications || {};
    if (n.waCustomerEnabled === false) return { configured: false };
    const lines = order.items.map((i) => `• ${i.title} × ${i.qty} — ৳${Math.round(i.price * i.qty).toLocaleString("en-IN")}`).join("\n");
    const msg = `Hi ${name}! 🛒\n\nApnar order confirm hoyeche *${order.code}*\n\n${lines}\n\n*Total: ৳${Math.round(order.total).toLocaleString("en-IN")}* (COD)\nDelivery: ${order.area === "INSIDE_DHAKA" ? "1–2 din (Inside Dhaka)" : "2–4 din (Outside Dhaka)"}\n\nDhonnobad! 🙏`;
    return { configured: true, result: await waSend(to, msg) };
  } catch { return { configured: false }; }
}

/* Customer-facing order confirmation email (used at checkout when email is given). */
export async function emailCustomerOrder(to: string, name: string, order: { code: string; total: number; area: string; items: { title: string; qty: number; price: number }[] }) {
  try {
    const s = envFallback(await getSettings());
    const n = s.notifications || {};
    if (!n.smtp?.host || !n.smtp?.user || !n.smtp?.pass) return { configured: false };
    const rows = order.items.map((i) => `<tr><td style="padding:6px 0">${i.title} × ${i.qty}</td><td style="text-align:right">৳${Math.round(i.price * i.qty).toLocaleString("en-IN")}</td></tr>`).join("");
    const html = emailHtml(
      `Thank you for your order, ${name}!`,
      `Order <b>${order.code}</b> received. We'll call you shortly to confirm.<br><br>
       <table style="width:100%;border-collapse:collapse">${rows}</table>
       <div style="border-top:2px solid #141414;margin-top:8px;padding-top:8px;font-weight:700">Total: ৳${Math.round(order.total).toLocaleString("en-IN")} (COD)</div>
       <div style="margin-top:8px;color:#666">Estimated delivery: ${order.area === "INSIDE_DHAKA" ? "1–2 days (Inside Dhaka)" : "2–4 days (Outside Dhaka)"}</div>`
    );
    const ok = await sendMail(n.smtp, to, `Order ${order.code} confirmed — ${s.store?.name || "Store"}`, html);
    return { configured: true, ok };
  } catch { return { configured: false, ok: false }; }
}
