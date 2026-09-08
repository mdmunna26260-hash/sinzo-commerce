import { db } from "./db";
import { getSettings, envFallback } from "./settings";
import { storeUrl } from "./notify";

/* Abandoned cart recovery — sends ONE recovery email per abandoned checkout.
   Rules:
   - checkout still OPEN, older than 45 minutes (they had time to finish)
   - has email + name + phone (came from checkout form)
   - not already emailed (recoveryEmailedAt marks it)
   - email has a resume link back to the site + optional coupon code
     (set marketing.recoveryCoupon in admin settings → applies at checkout) */

type Sent = { sent: number; skipped: number; failed: number };

export async function sendAbandonedRecoveryEmails(): Promise<Sent> {
  const s = envFallback(await getSettings());
  const n = s.notifications || {};
  const result: Sent = { sent: 0, skipped: 0, failed: 0 };
  if (!n.smtp?.host || !n.smtp?.user || !n.smtp?.pass) return result;

  const since = new Date(Date.now() - 45 * 60 * 1000);
  const rows = await db.abandonedCheckout.findMany({
    where: {
      checkoutStatus: "OPEN",
      email: { not: null },
      name: { not: null },
      phone: { not: null },
      updatedAt: { lte: since },
      recoveryEmailedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });

  const nodemailer = await import("nodemailer");
  const brand = s.store?.name || "SINZO";
  const url = storeUrl(s);
  const coupon = s.marketing?.recoveryCoupon || "";
  const transport = nodemailer.createTransport({
    host: n.smtp.host, port: Number(n.smtp.port) || 587,
    auth: { user: n.smtp.user, pass: n.smtp.pass },
  });

  for (const row of rows) {
    const to = row.email!;
    const name = row.name || "there";
    let items = "";
    try {
      const cart = JSON.parse(row.cartJson || "[]");
      items = cart.map((i: any) => `<tr><td style="padding:6px 0">${i.title} × ${i.qty}</td><td style="text-align:right">৳${Math.round((i.price || 0) * (i.qty || 1)).toLocaleString("en-IN")}</td></tr>`).join("");
    } catch {}
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#141414">
      <div style="font-size:22px;letter-spacing:.25em;border-bottom:2px solid #141414;padding-bottom:12px;margin-bottom:18px">${brand}</div>
      <h2 style="margin:0 0 10px">${name}, apnar cart ta apnar jonno waiting!</h2>
      <p style="font-size:14px;line-height:1.7;color:#444">Apni sundor kichu product cart e add korechilo kintu order ta complete hoy nai. Stock sesh hoye jauar age order kore felun!</p>
      ${items ? `<table style="width:100%;border-collapse:collapse">${items}</table>
      <div style="border-top:2px solid #141414;margin-top:8px;padding-top:8px;font-weight:700">Total: ৳${Math.round(row.total).toLocaleString("en-IN")} (Cash on Delivery)</div>` : ""}
      ${coupon ? `<div style="margin:16px 0;padding:12px;background:#faf5ec;border:1px dashed #c8a15f;border-radius:8px;text-align:center">Coupon code: <b style="font-size:16px;letter-spacing:.1em">${coupon}</b></div>` : ""}
      <div style="margin-top:20px"><a href="${url}/checkout" style="display:inline-block;background:#141414;color:#fff;text-decoration:none;padding:13px 26px;font-size:12px;letter-spacing:.14em;text-transform:uppercase">Complete My Order</a></div>
      <div style="margin-top:22px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">Cash on Delivery all over Bangladesh · Easy 7-day returns · You received this because you started a checkout.</div>
    </div>`;

    try {
      await transport.sendMail({
        from: `${brand} <${n.smtp.user}>`,
        replyTo: n.smtp.user,
        to,
        subject: `${name}, apnar cart toh baki ase! ${coupon ? "Coupon inside" : ""}`.trim(),
        html,
        text: `${name}, apnar cart e product waiting! Order complete korun: ${url}/checkout`,
        headers: { "Auto-Submitted": "auto-generated", "X-Entity-Ref-ID": String(Date.now()) },
      });
      await db.abandonedCheckout.update({ where: { id: row.id }, data: { recoveryEmailedAt: new Date() } });
      result.sent++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
