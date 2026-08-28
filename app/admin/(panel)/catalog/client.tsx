"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CatalogClient({ categories, collections, products }: any) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [newCat, setNewCat] = useState({ name: "", description: "", image: "" });
  const [editCatId, setEditCatId] = useState<number | null>(null);
  const [editCatImg, setEditCatImg] = useState("");

  const uploadCatImg = async (file: File, catId?: number) => {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) { setMsg("Upload failed"); return; }
    if (catId) {
      await fetch("/api/admin/categories/" + catId, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: j.url }) });
      setMsg("Category image updated ✓"); router.refresh();
    } else {
      setNewCat((c) => ({ ...c, image: j.url }));
    }
  };

  const [newCol, setNewCol] = useState({ title: "", subtitle: "", productIds: [] as number[] });

  const api = async (url: string, method: string, body?: any) => {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (r.ok) { setMsg("Saved ✓"); router.refresh(); } else setMsg(j.error || "Failed");
    setTimeout(() => setMsg(""), 2200);
    return j;
  };

  return (
    <>
      <div className="admin-top"><h1>Categories &amp; Collections</h1></div>
      {msg && <div className="noti ok">{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* CATEGORIES */}
        <div className="acard">
          <div className="acard-h"><h3>Categories ({categories.length})</h3></div>
          <table className="tbl">
            <thead><tr><th>Name</th><th>Slug</th><th>Products</th><th></th></tr></thead>
            <tbody>
              {categories.map((c: any) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>/{c.slug}</td>
                  <td>{c.productCount}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="abtn sm" title="Upload category image" onClick={() => { setEditCatId(editCatId === c.id ? null : c.id); setEditCatImg(""); }}>🖼</button>{" "}
                    <button className="abtn sm danger" onClick={() => confirm("Delete " + c.name + "?") && api("/api/admin/categories/" + c.id, "DELETE")}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="acard-b" style={{ borderTop: "1px solid #eeedea" }}>
            {editCatId && (
              <div style={{ marginBottom: 12, padding: 10, background: "#f8f7f5", borderRadius: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Upload image for category #{editCatId}</div>
                <input type="file" accept="image/*" onChange={(e) => { if (e.target.files?.[0]) uploadCatImg(e.target.files[0], editCatId); }} style={{ fontSize: 13 }} />
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input placeholder="New category name" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} style={{ flex: 1, border: "1px solid #ddd9d2", padding: "9px 12px", borderRadius: 5 }} />
              <button className="abtn primary" onClick={async () => { if (newCat.name) { await api("/api/admin/categories", "POST", { ...newCat, image: newCat.image || undefined }); setNewCat({ name: "", description: "", image: "" }); } }}>Add</button>
            </div>
          </div>
        </div>
        {/* COLLECTIONS */}
        <div className="acard">
          <div className="acard-h"><h3>Collections ({collections.length})</h3></div>
          <table className="tbl">
            <thead><tr><th>Collection</th><th>Slug</th><th>Products</th><th></th></tr></thead>
            <tbody>
              {collections.map((c: any) => (
                <tr key={c.id}>
                  <td><b>{c.title}</b><br /><span style={{ fontSize: 12, color: "var(--muted)" }}>{c.subtitle}</span></td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>/{c.slug}</td>
                  <td>{c.productCount}</td>
                  <td><button className="abtn sm danger" onClick={() => confirm("Delete " + c.title + "?") && api("/api/admin/collections/" + c.id, "DELETE")}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="acard-b" style={{ borderTop: "1px solid #eeedea" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input placeholder="Collection title (e.g. Best Sellers)" value={newCol.title} onChange={(e) => setNewCol({ ...newCol, title: e.target.value })} style={{ flex: 1, border: "1px solid #ddd9d2", padding: "9px 12px", borderRadius: 5 }} />
                <button className="abtn primary" onClick={async () => { if (newCol.title) { await api("/api/admin/collections", "POST", newCol); setNewCol({ title: "", subtitle: "", productIds: [] }); } }}>Add</button>
              </div>
              <select multiple value={newCol.productIds.map(String)} onChange={(e) => setNewCol({ ...newCol, productIds: Array.from(e.target.selectedOptions).map((o) => Number(o.value)) })} style={{ height: 110, border: "1px solid #ddd9d2", borderRadius: 5, padding: 8, fontSize: 13 }}>
                {products.map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Hold Ctrl/Cmd to select multiple products for this new collection.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
