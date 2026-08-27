"use client";
import { afetch, withToken } from "@/lib/afetch";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function ReviewsClient({ initial }: { initial: any[] }) {
  const router = useRouter();
  const [tab, setTab] = useState("PENDING");
  const [msg, setMsg] = useState("");
  const act = async (id: number, body: any, method = "PUT") => {
    const r = await afetch("/api/admin/reviews/" + id, { method, headers: { "Content-Type": "application/json" }, body: method === "PUT" ? JSON.stringify(body) : undefined });
    if (r.ok) { setMsg("Done ✓"); router.refresh(); setTimeout(() => setMsg(""), 1500); }
  };
  const list = initial.filter((r) => r.status === tab);
  return (
    <>
      <div className="admin-top">
        <h1>Reviews</h1>
        <div style={{ display: "flex", gap: 6 }}>
          {["PENDING", "APPROVED", "REJECTED"].map((t) => (
            <button key={t} className={"abtn" + (tab === t ? " primary" : "")} onClick={() => setTab(t)}>{t} ({initial.filter((r) => r.status === t).length})</button>
          ))}
        </div>
      </div>
      {msg && <div className="noti ok">{msg}</div>}
      <div className="acard">
        <table className="tbl">
          <thead><tr><th>Product</th><th>Customer</th><th>Rating</th><th>Review</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", padding: 30 }}>Nothing here.</td></tr>}
            {list.map((r) => (
              <tr key={r.id}>
                <td style={{ fontSize: 13 }}>{r.product?.title}</td>
                <td>{r.name}<br /><span style={{ fontSize: 12, color: "var(--muted)" }}>{r.phone || ""}{r.verified ? " · ✓ verified" : ""}</span></td>
                <td style={{ color: "#9a7b4f", letterSpacing: 2 }}>{"★".repeat(r.rating)}</td>
                <td style={{ maxWidth: 380 }}>{r.text}</td>
                <td><span className={"pill " + r.status}>{r.status}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {r.status !== "APPROVED" && <button className="abtn sm" onClick={() => act(r.id, { status: "APPROVED" })}>✓ Approve</button>}{" "}
                  {r.status !== "REJECTED" && <button className="abtn sm danger" onClick={() => act(r.id, { status: "REJECTED" })}>Reject</button>}{" "}
                  <button className="abtn sm danger" onClick={() => confirm("Delete review?") && act(r.id, null, "DELETE")}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
