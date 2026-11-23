import { db } from "./db";
import { readyToSendWhere } from "./admin-workflow";

/* Counts are not derived from a capped list or the six-row stock preview.
   A failed count stays unknown; it must never masquerade as an empty queue. */
export async function dashboardWork(permissions: { orders: boolean; products: boolean }) {
  const safely = async (query: () => Promise<number>) => { try { return await query(); } catch { return null; } };
  const [pending, ready, hold, stock] = await Promise.all([
    permissions.orders ? safely(() => db.order.count({ where: { status: "PENDING" } })) : null,
    permissions.orders ? safely(() => db.order.count({ where: readyToSendWhere() })) : null,
    permissions.orders ? safely(() => db.order.count({ where: { status: "ON_HOLD" } })) : null,
    permissions.products ? safely(() => db.product.count({ where: { status: "ACTIVE", stock: { lte: db.product.fields.lowStock } } })) : null,
  ]);
  return { pending, ready, hold, stock };
}
export type DashboardWorkCounts = Awaited<ReturnType<typeof dashboardWork>>;
