import { db } from "@/lib/db";
import { getSettings, envFallback } from "@/lib/settings";
import MarketingClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing" };
export default async function MarketingPage({ searchParams }: { searchParams: any }) {
  await (await import("@/lib/auth")).requireAdmin(searchParams);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const [abandoned, sources] = await Promise.all([
    db.abandonedCheckout.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
    db.order.groupBy({ by: ["source"], _count: { _all: true }, _sum: { total: true } }),
  ]);
  const sFull = envFallback(await getSettings(true));
  const marketingCfg = sFull.marketing || {};
  return <MarketingClient
    recCouponInit={marketingCfg.recoveryCoupon || ""}
    recSettings={marketingCfg}
    abandoned={abandoned.map((a) => ({
      id: a.id, phone: a.phone, name: a.name, address: a.address, email: a.email,
      cart: JSON.parse(a.cartJson || "[]"),
      total: a.total, status: a.checkoutStatus || (a.recovered ? "RECOVERED" : "OPEN"),
      recoveryEmailedAt: a.recoveryEmailedAt ? a.recoveryEmailedAt.toISOString() : null,
      updatedAt: a.updatedAt.toISOString(),
    }))}
    sources={sources.map((s) => ({ source: s.source, orders: s._count._all, revenue: s._sum.total || 0 }))}
  />;
}
