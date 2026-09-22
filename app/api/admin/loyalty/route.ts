import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { getSettings, envFallback, saveGroup } from "@/lib/settings";
import { loyaltyCfg, pointsValue, ensureReferralCode, redeemPointsAsCoupon, awardForDeliveredOrder } from "@/lib/loyalty";
export const dynamic = "force-dynamic";

/* Referral + loyalty points.
   Points are earned on DELIVERED orders and spent as a single-use coupon; a referral pays both
   sides once the invited friend's first parcel is delivered. This route is the admin side:
   the ledger, the settings, manual adjustments, and the backfill for orders that shipped
   before the programme existed. */
export async function GET(req: Request) {
  const g = await requirePerm("customers", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const s = envFallback(await getSettings());
  const cfg = loyaltyCfg(s);

  const [top, referrals, earnRows, redeemRows, totals] = await Promise.all([
    db.customer.findMany({ where: { points: { gt: 0 } }, orderBy: { points: "desc" }, take: 25, select: { id: true, name: true, phone: true, points: true, referralCode: true } }),
    db.customer.findMany({ where: { referredBy: { not: null } }, orderBy: { id: "desc" }, take: 50, select: { id: true, name: true, phone: true, referredBy: true, referralRewardedAt: true, points: true } }),
    db.auditLog.findMany({ where: { action: "LOYALTY_EARN" }, orderBy: { id: "desc" }, take: 15 }),
    db.auditLog.findMany({ where: { action: "LOYALTY_REDEEM" }, orderBy: { id: "desc" }, take: 10 }),
    db.customer.aggregate({ _sum: { points: true }, _count: { _all: true } }),
  ]);
  const referrers = await db.customer.findMany({ where: { id: { in: referrals.map((r) => r.referredBy!).filter(Boolean) } }, select: { id: true, name: true, phone: true } });
  const byId = new Map(referrers.map((r) => [r.id, r]));
  const deliveredSince = await db.order.count({ where: { status: "DELIVERED" } });
  const earned = await db.auditLog.count({ where: { action: "LOYALTY_EARN" } });

  return NextResponse.json({
    ok: true,
    cfg,
    totals: { points: totals._sum.points || 0, customers: totals._count._all, value: pointsValue(totals._sum.points || 0, cfg) },
    top, referrals: referrals.map((r) => ({ ...r, referrer: byId.get(r.referredBy!) || null })),
    earnRows: earnRows.map((r) => ({ detail: r.detail, at: r.createdAt })),
    redeemRows: redeemRows.map((r) => ({ detail: r.detail, at: r.createdAt })),
    pendingBackfill: Math.max(0, deliveredSince - earned),
  });
}

export async function POST(req: Request) {
  const g = await requirePerm("customers", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await req.json().catch(() => ({}));
  const s = envFallback(await getSettings());
  const action = String(b.action || "");

  if (action === "settings") {
    const current = (await getSettings(true) as any).loyalty || {};
    const next = {
      ...current,
      enabled: b.enabled !== undefined ? !!b.enabled : current.enabled !== false,
      earnPer100: b.earnPer100 !== undefined ? Number(b.earnPer100) : current.earnPer100,
      redeemPoints: b.redeemPoints !== undefined ? Number(b.redeemPoints) : current.redeemPoints,
      referralPoints: b.referralPoints !== undefined ? Number(b.referralPoints) : current.referralPoints,
      minRedeem: b.minRedeem !== undefined ? Number(b.minRedeem) : current.minRedeem,
    };
    await saveGroup("loyalty", next);
    await logAudit(g.user.email, "LOYALTY_SETTINGS", JSON.stringify(next));
    return NextResponse.json({ ok: true, cfg: loyaltyCfg({ loyalty: next } as any) });
  }

  if (action === "adjust") {
    const customerId = Number(b.customerId);
    const points = Math.round(Number(b.points));
    if (!customerId || !points) return NextResponse.json({ error: "customerId ar points dorkar" }, { status: 400 });
    const c = await db.customer.findUnique({ where: { id: customerId } });
    if (!c) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    if (c.points + points < 0) return NextResponse.json({ error: `${c.name || c.phone} er ${c.points} points ache — ${Math.abs(points)} katar jonno enough na.` }, { status: 400 });
    await db.customer.update({ where: { id: customerId }, data: { points: { increment: points } } });
    await db.auditLog.create({ data: { userEmail: g.user.email, action: "LOYALTY_ADJUST", detail: `${c.phone}: ${points > 0 ? "+" : ""}${points} points${b.note ? " — " + String(b.note).slice(0, 120) : ""}` } }).catch(() => {});
    return NextResponse.json({ ok: true, points: c.points + points });
  }

  if (action === "redeem") {
    const r = await redeemPointsAsCoupon(Number(b.customerId), Math.round(Number(b.points)), s);
    await logAudit(g.user.email, "LOYALTY_REDEEM_ADMIN", `customer #${b.customerId}: ${b.points} points → ${r.code || r.error}`);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (action === "backfill") {
    /* Turn the programme on without losing the customers who already bought: award points for
       delivered orders that never earned any. Capped per run — this is a chore, not a button
       that holds a request open for five minutes. */
    const limit = Math.min(50, Math.max(1, Number(b.limit) || 25));
    const delivered = await db.order.findMany({ where: { status: "DELIVERED" }, orderBy: { id: "asc" }, take: 400, select: { id: true, code: true } });
    let awarded = 0; let skipped = 0;
    for (const o of delivered) {
      if (awarded >= limit) break;
      const res = await awardForDeliveredOrder(o.id, s);
      if (res.awarded > 0) awarded++; else skipped++;
    }
    await logAudit(g.user.email, "LOYALTY_BACKFILL", `${awarded} orders awarded, ${skipped} already had points`);
    return NextResponse.json({ ok: true, awarded, skipped });
  }

  if (action === "codes") {
    // make sure every existing customer has a referral code to share
    const missing = await db.customer.findMany({ where: { referralCode: null }, take: 200, select: { id: true, name: true } });
    for (const c of missing) await ensureReferralCode(c.id, c.name);
    await logAudit(g.user.email, "LOYALTY_CODES", `${missing.length} referral code generated`);
    return NextResponse.json({ ok: true, generated: missing.length });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
