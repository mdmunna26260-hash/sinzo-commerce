import { getSettings, envFallback } from "./settings";
import { awardForDeliveredOrder } from "./loyalty";
import { sendReviewRequest, autoReviewRequestEnabled } from "./review-request";
import { notifyAdmin } from "./notify";
import { logApp } from "./logs";

/* Everything that should happen exactly when a parcel is confirmed delivered.
   Both delivery paths (manual status change and the courier sync) call this one function, so
   "delivered" means the same thing everywhere: stock down (separate, atomic), points credited,
   and the review ask sent if the shop switched it on. */
export async function onOrderDelivered(orderId: number): Promise<{ points: number; reviewSent: boolean }> {
  const s = envFallback(await getSettings());
  let points = 0;
  try {
    const r = await awardForDeliveredOrder(orderId, s);
    points = r.awarded;
    if (r.awarded > 0) {
      await logApp("INFO", "CRON", `loyalty: +${r.awarded} points for delivered order #${orderId}${r.referral ? " (incl. referral bonus)" : ""}`, { orderId });
    }
  } catch (e: any) {
    await logApp("WARN", "CRON", `loyalty award failed for order #${orderId}: ${String(e?.message || e).slice(0, 160)}`, { orderId });
  }

  let reviewSent = false;
  if (autoReviewRequestEnabled(s)) {
    try {
      const r = await sendReviewRequest(orderId, s);
      reviewSent = !!r.ok;
    } catch (e: any) {
      await logApp("WARN", "WHATSAPP", `auto review request failed for order #${orderId}: ${String(e?.message || e).slice(0, 160)}`, { orderId });
    }
  }

  if (points > 0) {
    const order = await import("./db").then((m) => m.db.order.findUnique({ where: { id: orderId }, select: { code: true, name: true } }));
    notifyAdmin("payment", "🎁 Loyalty points credited", `${order?.code}: ${points} points → ${order?.name}`, order?.code).catch(() => {});
  }
  return { points, reviewSent };
}
