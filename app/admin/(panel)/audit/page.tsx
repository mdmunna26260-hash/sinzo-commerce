import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Log" };
export default async function AuditPage(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  await requireAdmin(searchParams, "audit");
  const logs = await db.auditLog.findMany({ orderBy: { id: "desc" }, take: 300 });
  return (
    <>
      <div className="admin-top"><h1>Audit Log</h1><span className="who">Sensitive admin actions are recorded automatically.</span></div>
      <div className="acard">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)", padding: 30 }}>No audit entries yet.</td></tr>}
              {logs.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{new Date(l.createdAt).toLocaleString("en-GB")}</td>
                  <td>{l.userEmail}</td>
                  <td><span className="pill CONFIRMED">{l.action}</span></td>
                  <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{l.detail || "—"}{l.ip ? ` · ${l.ip}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
