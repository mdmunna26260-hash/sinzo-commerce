import { db } from "@/lib/db";
import { getSettings, envFallback } from "@/lib/settings";
import MarketingClient from "./client";
import { displaySavedItems } from "@/lib/abandoned-cart";
export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing" };
export default async function MarketingPage(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  await (await import("@/lib/auth")).requireAdmin(searchParams, "marketing");
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
      cart: displaySavedItems(a.cartJson || "[]"),
      legacy: !a.captureKeyHash, recoveryError: a.recoveryError,
      recoveryAttemptedAt: a.recoveryAttemptedAt?.toISOString() || null,
      convertedOrderId: a.convertedOrderId,
      total: a.total, status: a.checkoutStatus || (a.recovered ? "RECOVERED" : "OPEN"),
      recoveryEmailedAt: a.recoveryEmailedAt ? a.recoveryEmailedAt.toISOString() : null,
      updatedAt: a.updatedAt.toISOString(),
    }))}
    sources={sources.map((s) => ({ source: s.source, orders: s._count._all, revenue: s._sum.total || 0 }))}
  />;
}
