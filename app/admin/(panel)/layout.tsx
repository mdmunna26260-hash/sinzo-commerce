import { db } from "@/lib/db";
import Sidebar from "@/components/admin-sidebar";

export const dynamic = "force-dynamic";

// NOTE: auth is enforced per-page (requireAdmin) so both cookie sessions and
// URL-token fallback sessions work. This layout only renders the shell.
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const [pending, lowStock] = await Promise.all([
    db.order.count({ where: { status: "PENDING" } }).catch(() => 0),
    db.product.count({ where: { stock: { lte: 5 }, status: "ACTIVE" } }).catch(() => 0),
  ]);
  return (
    <div className="admin-body">
      <Sidebar pending={pending} lowStock={lowStock} />
      <main className="admin-main">{children}</main>
    </div>
  );
}
