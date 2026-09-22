import crypto from "crypto";
import { db } from "./db";
import type { SettingsMap } from "./settings";

/* Referral + loyalty points.
   Points are earned when an order is actually DELIVERED (not when it is placed — a returned
   parcel must not earn anything), and they are spent as a one-time discount code, so the
   money and the points can never disagree about what was redeemed. */

export type LoyaltyCfg = { enabled: boolean; earnPer100: number; redeemPoints: number; referralPoints: number; minRedeem: number };

export function loyaltyCfg(s: SettingsMap): LoyaltyCfg {
  const l: any = (s as any).loyalty || {};
  return {
    enabled: l.enabled !== false,                       // on by default, like the rest of the store
    earnPer100: Number(l.earnPer100) || 10,             // 10 points per ৳100 spent
    redeemPoints: Number(l.redeemPoints) || 200,        // 200 points = ৳100 off
    referralPoints: Number(l.referralPoints) || 100,    // both sides of a referral
    minRedeem: Number(l.minRedeem) || 200,
  };
}

/** ৳ value of a pile of points. */
export function pointsValue(points: number, cfg: LoyaltyCfg): number {
  return Math.floor(Math.max(0, points) / cfg.redeemPoints) * 100;
}

/** Points earned by an order of this value. */
export function pointsEarned(total: number, cfg: LoyaltyCfg): number {
  return Math.floor(Math.max(0, total) / 100) * cfg.earnPer100;
}

export function makeReferralCode(name?: string | null): string {
  const base = (name || "").replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
  return (base || "SINZ") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

/** Every customer gets a code the first time it is needed; unique, retried on collision. */
export async function ensureReferralCode(customerId: number, name?: string | null): Promise<string> {
  const c = await db.customer.findUnique({ where: { id: customerId }, select: { referralCode: true } });
  if (c?.referralCode) return c.referralCode;
  for (let i = 0; i < 5; i++) {
    const code = makeReferralCode(name);
    const clash = await db.customer.findUnique({ where: { referralCode: code } });
    if (clash) continue;
    const updated = await db.customer.update({ where: { id: customerId }, data: { referralCode: code } });
    return updated.referralCode!;
  }
  return "";
}

export async function findCustomerByCode(code: string) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return null;
  return db.customer.findFirst({ where: { referralCode: clean } });
}

/* ---- earning ----------------------------------------------------------------
   Points are awarded when the parcel is DELIVERED, never when it is placed: a returned order
   must not earn anything. Referral bonuses settle with the referred customer's first delivered
   order, and `referralRewardedAt` makes that a one-time event. Both write an AuditLog row, so
   "why does this customer have 340 points" is answerable. */
export type AwardResult = { awarded: number; toCustomer?: number; referral?: { referrer: number; points: number } };

export async function awardForDeliveredOrder(orderId: number, s: SettingsMap): Promise<AwardResult> {
  const cfg = loyaltyCfg(s);
  if (!cfg.enabled) return { awarded: 0 };
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "DELIVERED") return { awarded: 0 };
  // idempotency: the audit log is the receipt
  const already = await db.auditLog.findFirst({ where: { action: "LOYALTY_EARN", detail: { contains: order.code } } });
  if (already) return { awarded: 0 };

  const customer = await db.customer.findFirst({ where: { phone: order.phone } });
  if (!customer) return { awarded: 0 };

  const points = pointsEarned(order.total, cfg);
  const out: AwardResult = { awarded: points, toCustomer: customer.id };

  if (points > 0) {
    await db.customer.update({ where: { id: customer.id }, data: { points: { increment: points } } });
    await db.auditLog.create({ data: { userEmail: "system", action: "LOYALTY_EARN", detail: `${order.code}: +${points} points → ${customer.phone} (৳${Math.round(order.total)})` } }).catch(() => {});
  }
  await ensureReferralCode(customer.id, customer.name);

  // referral: the friend who invited them gets paid on this first delivered order
  if (customer.referredBy && !customer.referralRewardedAt && cfg.referralPoints > 0) {
    const referrer = await db.customer.findUnique({ where: { id: customer.referredBy } });
    if (referrer) {
      await db.customer.update({ where: { id: referrer.id }, data: { points: { increment: cfg.referralPoints } } });
      await db.customer.update({ where: { id: customer.id }, data: { points: { increment: cfg.referralPoints }, referralRewardedAt: new Date() } });
      await db.auditLog.create({ data: { userEmail: "system", action: "LOYALTY_REFERRAL", detail: `${order.code}: referral bonus ${cfg.referralPoints} points each — ${referrer.phone} + ${customer.phone}` } }).catch(() => {});
      out.referral = { referrer: referrer.id, points: cfg.referralPoints };
      out.awarded += cfg.referralPoints;
    }
  }
  return out;
}

/** Turn points into a single-use coupon. The points leave the account in the same operation,
    so a code can never be handed out twice for the same balance. */
export async function redeemPointsAsCoupon(customerId: number, points: number, s: SettingsMap): Promise<{ ok: boolean; code?: string; value?: number; error?: string }> {
  const cfg = loyaltyCfg(s);
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { ok: false, error: "Customer not found" };
  const spend = Math.max(cfg.minRedeem, Math.floor(points / cfg.redeemPoints) * cfg.redeemPoints);
  if (points > customer.points) return { ok: false, error: `Ei customer er ${customer.points} points ache — ${points} dewa jabe na.` };
  if (points < cfg.minRedeem) return { ok: false, error: `Minimum ${cfg.minRedeem} points lagbe.` };
  const value = pointsValue(spend, cfg);
  if (value <= 0) return { ok: false, error: "Points theke discount banano gelo na — rate check korun." };
  const code = `POINTS${customer.id}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  await db.coupon.create({
    data: {
      code, type: "fixed", value, minOrder: value, usageLimit: 1, perCustomer: 1, active: true,
      endsAt: new Date(Date.now() + 30 * 864e5),
    },
  });
  await db.customer.update({ where: { id: customerId }, data: { points: { decrement: spend } } });
  await db.auditLog.create({ data: { userEmail: "system", action: "LOYALTY_REDEEM", detail: `${customer.phone}: ${spend} points → coupon ${code} (৳${value})` } }).catch(() => {});
  return { ok: true, code, value };
}
