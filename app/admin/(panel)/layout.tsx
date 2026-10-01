import { db } from "@/lib/db";
import { getSessionUser, can } from "@/lib/auth";
import Sidebar from "@/components/admin-sidebar";

export const dynamic = "force-dynamic";

// NOTE: auth is enforced per-page (requireAdmin) so both cookie sessions and
// URL-token fallback sessions work. This layout only renders the shell.
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const [pending, lowStock] = await Promise.all([
    can(user, "orders") ? db.order.count({ where: { status: "PENDING" } }).catch(() => 0) : 0,
    can(user, "products") ? db.product.count({ where: { stock: { lte: 5 }, status: "ACTIVE" } }).catch(() => 0) : 0,
  ]);
  return (
    <div className="admin-body">
      <Sidebar pending={pending} lowStock={lowStock} />
      <main className="admin-main">{children}</main>
    </div>
  );
}
