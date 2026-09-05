import { db } from "@/lib/db";
import MarketingClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing" };
export default async function MarketingPage({ searchParams }: { searchParams: any }) {
  await (await import("@/lib/auth")).requireAdmin(searchParams);
  const [abandoned, subscribers, sources, pushTotal, pushWithPhone] = await Promise.all([
    db.abandonedCheckout.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
    db.subscriber.findMany({ orderBy: { id: "desc" }, take: 200 }),
    db.order.groupBy({ by: ["source"], _count: { _all: true }, _sum: { total: true } }),
    db.pushSubscription.count().catch(() => 0),
    db.pushSubscription.count({ where: { phone: { not: null } } }).catch(() => 0),
  ]);
  return <MarketingClient
    abandoned={abandoned.map((a) => ({
      id: a.id, phone: a.phone, name: a.name, address: a.address,
      cart: JSON.parse(a.cartJson || "[]"),
      total: a.total, status: a.checkoutStatus || (a.recovered ? "RECOVERED" : "OPEN"),
      updatedAt: a.updatedAt.toISOString(),
    }))}
    subscribers={subscribers.map((s) => ({ id: s.id, email: s.email }))}
    sources={sources.map((s) => ({ source: s.source, orders: s._count._all, revenue: s._sum.total || 0 }))}
    push={{ total: pushTotal, withPhone: pushWithPhone }}
  />;
}
