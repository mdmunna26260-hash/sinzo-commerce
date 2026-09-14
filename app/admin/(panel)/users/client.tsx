"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
const ROLES = ["SUPER_ADMIN", "ADMIN", "ORDER_MANAGER", "PRODUCT_MANAGER", "MARKETING", "SUPPORT"];
/* SECURITY NOTE: the UI restrictions below are convenience only —
   the real authorization is server-side (only SUPER_ADMIN mutations accepted;
   self role/status change rejected; last SUPER_ADMIN protected). */
export default function UsersClient({ initial, meId, meRole, perms }: any) {
  const canManage = meRole === "SUPER_ADMIN";
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [pwUser, setPwUser] = useState<number | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [nu, setNu] = useState({ name: "", email: "", password: "", role: "ORDER_MANAGER" });
  const api = async (url: string, method: string, body?: any) => {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (r.ok) { setMsg("Saved ✓"); router.refresh(); } else setMsg(j.error || "Failed");
    setTimeout(() => setMsg(""), 2200);
  };
  return (
    <>
      <div className="admin-top"><h1>Team &amp; Roles</h1></div>
      {msg && <div className="noti ok">{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="acard">
          <div className="acard-h"><h3>Users ({initial.length})</h3></div>
          <table className="tbl">
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Permissions</th><th></th></tr></thead>
            <tbody>
              {initial.map((u: any) => (
                <tr key={u.id}>
                  <td><b>{u.name}</b><br /><span style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</span></td>
                  <td>
                    {canManage && u.id !== meId ? (
                      <select className="abtn sm" value={u.role} onChange={(e) => api("/api/admin/users/" + u.id, "PUT", { role: e.target.value })}>
                        {ROLES.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span className={"pill " + (u.role === "SUPER_ADMIN" ? "DELIVERED" : "PROCESSING")} title="Only a SUPER_ADMIN can change roles">{u.role}{u.id === meId ? " (you)" : ""}</span>
                    )}
                  </td>
                  <td><span className={"pill " + (u.active ? "ACTIVE" : "DRAFT")}>{u.active ? "Active" : "Disabled"}</span></td>
                  <td style={{ fontSize: 11, color: "var(--muted)", maxWidth: 220 }}>{(perms[u.role] || []).join(", ")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canManage && u.id !== meId && <button className="abtn sm" onClick={() => api("/api/admin/users/" + u.id, "PUT", { active: !u.active })}>{u.active ? "Disable" : "Enable"}</button>}{" "}
                    {canManage && u.id !== meId && (
                      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <button className="abtn sm" title="Change password" onClick={() => { setPwUser(pwUser === u.id ? null : u.id); setPwValue(""); }}>🔑</button>
                        {pwUser === u.id && (
                          <>
                            <input type="password" placeholder="New password (min 6)" value={pwValue} onChange={(e) => setPwValue(e.target.value)}
                              style={{ width: 150, border: "1px solid #d0d5dd", padding: "4px 8px", borderRadius: 4, fontSize: 12 }} autoFocus />
                            <button className="abtn sm primary" onClick={() => { if (pwValue.length >= 6) { api("/api/admin/users/" + u.id, "PUT", { password: pwValue }); setPwUser(null); setPwValue(""); } }}>Save</button>
                          </>
                        )}
                      </span>
                    )}{" "}
                    {canManage && u.id !== meId && <button className="abtn sm danger" onClick={() => confirm("Delete " + u.email + "?") && api("/api/admin/users/" + u.id, "DELETE")}>✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="acard">
          <div className="acard-h"><h3>Add Team Member</h3>{!canManage && <span className="pill DRAFT">SUPER_ADMIN only</span>}</div>
          <div className="acard-b form-grid" style={canManage ? undefined : { display: "none" }}>
            <div className="af full"><label>Name</label><input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} /></div>
            <div className="af full"><label>Email</label><input type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} /></div>
            <div className="af full"><label>Password (min 6)</label><input type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></div>
            <div className="af full"><label>Role</label>
              <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            </div>
            <div className="full"><button className="abtn primary" style={{ width: "100%" }} onClick={() => api("/api/admin/users", "POST", nu)}>Create User</button></div>
          </div>
        </div>
      </div>
    </>
  );
}
