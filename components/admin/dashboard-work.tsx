import Link from "next/link";
import { adminWorkflowHref } from "@/lib/admin-workflow";
import type { DashboardWorkCounts } from "@/lib/dashboard-work";

export default function DashboardWork({ counts, productsAllowed, token }: { counts: DashboardWorkCounts; productsAllowed: boolean; token: string }) {
  const tasks = [
    { key: "pending", count: counts.pending, title: "Pending orders", detail: "Review and confirm", href: "/admin/orders?tab=PENDING&queue=pending", icon: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", tone: "amber" },
    { key: "ready", count: counts.ready, title: "Ready to send", detail: "No courier booking yet", href: "/admin/orders?tab=READY&queue=ready", icon: "M2 5h12v12H2zM14 9h4l4 4v4h-8M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4m12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4", tone: "indigo" },
    { key: "hold", count: counts.hold, title: "On hold", detail: "Review before dispatch", href: "/admin/orders?tab=ON_HOLD&queue=hold", icon: "M9 8v8M15 8v8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", tone: "amber" },
    ...(productsAllowed ? [{ key: "stock", count: counts.stock, title: "Stock attention", detail: "At or below alert level", href: "/admin/stock?attention=1#stock-restock", icon: "m3 7 9-4 9 4-9 5-9-5v10l9 4 9-4V7M12 12v9", tone: "red" }] : []),
  ];
  const allClear = tasks.every(task => task.count === 0);
  const unknown = tasks.some(task => task.count === null);
  const href = (path: string) => adminWorkflowHref(path, token);
  return <section className="dashboard-work" aria-labelledby="dashboard-work-title">
    <div className="dashboard-work-heading"><div><p className="dashboard-work-eyebrow">Your work queues</p><h2 id="dashboard-work-title">What needs attention</h2></div><span className="dashboard-work-live">Current snapshot</span></div>
    <div className="dashboard-work-grid">{tasks.map(task => <Link className={"dashboard-work-card tone-" + task.tone} key={task.key} href={href(task.href)} aria-label={task.title + ": " + (task.count === null ? "count unavailable" : task.count)}>
      <div className="dashboard-work-card-top"><span className="dashboard-work-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={task.icon} /></svg></span><span className="dashboard-work-arrow" aria-hidden="true">&rarr;</span></div>
      <strong>{task.count === null ? "--" : task.count.toLocaleString("en-IN")}</strong><h3>{task.title}</h3><p>{task.detail}</p>
    </Link>)}</div>
    <p className="dashboard-work-note" role="status">{unknown ? "Some counts could not load. Open the queue to review it." : allClear ? "These work queues are clear right now." : "Tap a card to open its matching list. Nothing is sent automatically."}</p>
    <nav className="dashboard-work-shortcuts" aria-label="Dashboard shortcuts">
      <Link href={href("/admin/orders")}>All orders <span aria-hidden="true">&rarr;</span></Link>
      {productsAllowed && <><Link href={href("/admin/products?new=1")}>Add product <span aria-hidden="true">+</span></Link><Link href={href("/admin/stock#stock-restock")}>Update stock <span aria-hidden="true">&rarr;</span></Link></>}
    </nav>
    <p className="dashboard-work-limit">Order queues show up to 200 matching orders per view. Counts include all matching orders. Refresh this page for new counts.</p>
  </section>;
}
