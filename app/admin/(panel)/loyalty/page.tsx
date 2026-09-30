import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import { loyaltyCfg, pointsValue } from "@/lib/loyalty";
import LoyaltyClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loyalty & Referral" };

/* Points + referrals.
   Repeat customers are the cheapest sales a shop has: points make the second order feel earned,
   and a referral code turns a happy customer into a channel. Both pay out on DELIVERED orders
   only, so a returned parcel never costs anything. */
export default async function LoyaltyPage({ searchParams }: { searchParams: { t?: string } }) {
  const user = await requireAdmin(searchParams);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const s = envFallback(await getSettings());
  const cfg = loyaltyCfg(s);

  const [top, referrals, totals, delivered, earned] = await Promise.all([
    db.customer.findMany({ where: { points: { gt: 0 } }, orderBy: { points: "desc" }, take: 25, select: { id: true, name: true, phone: true, points: true, referralCode: true } }),
    db.customer.findMany({ where: { referredBy: { not: null } }, orderBy: { id: "desc" }, take: 40, select: { id: true, name: true, phone: true, referredBy: true, referralRewardedAt: true } }),
    db.customer.aggregate({ _sum: { points: true }, _count: { _all: true } }),
    db.order.count({ where: { status: "DELIVERED" } }),
    db.auditLog.count({ where: { action: "LOYALTY_EARN" } }),
  ]);
  const referrerIds = Array.from(new Set(referrals.map((r) => r.referredBy!).filter(Boolean)));
  const referrers = await db.customer.findMany({ where: { id: { in: referrerIds } }, select: { id: true, name: true, phone: true } });
  const byId = new Map(referrers.map((r) => [r.id, r]));
  const codes = await db.customer.count({ where: { referralCode: { not: null } } });
  const rewarded = referrals.filter((r) => r.referralRewardedAt).length;

  return (
    <>
      <div className="admin-top">
        <div><h1>Loyalty &amp; Referral</h1><div className="who">{cfg.enabled ? "active" : "switched off"} · {user.name}</div></div>
        <a className="abtn" href="/api/admin/export?type=loyalty">CSV</a>
      </div>

      <div className="kpis kpis-5" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="kpi"><div className="k-label">Points outstanding</div><div className="k-val">{totals._sum.points || 0}</div><div className="k-sub">≈ ৳{pointsValue(totals._sum.points || 0, cfg)} of future discount</div></div>
        <div className="kpi"><div className="k-label">Members with points</div><div className="k-val">{top.length}</div><div className="k-sub">{codes} referral codes issued</div></div>
        <div className="kpi"><div className="k-label">Referrals</div><div className="k-val">{referrals.length}</div><div className="k-sub">{rewarded} rewarded · {referrals.length - rewarded} pending delivery</div></div>
        <div className="kpi"><div className="k-label">Orders credited</div><div className="k-val">{earned}</div><div className="k-sub">{delivered} delivered in total</div></div>
        <div className="kpi"><div className="k-label">Earning rate</div><div className="k-val">{cfg.earnPer100} pts / ৳100</div><div className="k-sub">{cfg.redeemPoints} pts = ৳100 off</div></div>
      </div>

      <LoyaltyClient
        cfg={cfg}
        backfill={Math.max(0, delivered - earned)}
        top={top.map((c) => ({ id: c.id, name: c.name || "-", phone: c.phone, points: c.points, code: c.referralCode || "" }))}
        referrals={referrals.map((r) => ({
          id: r.id, name: r.name || "-", phone: r.phone, rewarded: !!r.referralRewardedAt,
          referrer: byId.get(r.referredBy!) ? `${byId.get(r.referredBy!)!.name || "-"} (${byId.get(r.referredBy!)!.phone})` : "#" + r.referredBy,
        }))}
      />

      <div className="cfg-note" style={{ marginTop: 16 }}>
        Points rule: <b>{cfg.earnPer100} points per ৳100</b> spent, credited when the parcel is delivered
        ({cfg.referralPoints} points to each side of a referral). Redemption makes a one-time coupon of
        the same value ({cfg.redeemPoints} points = ৳100) and takes the points out of the balance in the
        same operation, so a code cannot be issued twice for the same points. Customers see their balance
        on <b>/account</b> together with their own referral code.
      </div>
    </>
  );
}
