"use client";
import { useEffect, useState } from "react";
import { afetch } from "@/lib/afetch";

type Bundle = { id: number; title: string; price: number; active: boolean; items: { product: { id: number; title: string; price: number } }[] };

export default function ComboBundlesClient({ initialBundles, eligibleProducts, allProducts }: { initialBundles: Bundle[]; eligibleProducts: { id: number; title: string; price: number }[]; allProducts?: { id: number; title: string; price: number }[] }) {
  const [bundles, setBundles] = useState<Bundle[]>(initialBundles);
  const [deptEnabled, setDeptEnabled] = useState(true);
  const [deptTiers, setDeptTiers] = useState<{ qty: string; discount: string }[]>([]);
  const [giftEnabled, setGiftEnabled] = useState(true);
  const [giftTiers, setGiftTiers] = useState<{ amount: string; freeQty: string }[]>([]);
  const [giftPool, setGiftPool] = useState<number[]>([]);
  const [giftExclude, setGiftExclude] = useState<number[]>([]);
  useEffect(() => {
    afetch("/api/admin/settings", { method: "GET" }).then((r) => r.json()).then((d) => {
      const c = d?.settings?.combo || {};
      setDeptEnabled(c.enabled !== false);
      setDeptTiers((c.deptTiers || []).map((t: any) => ({ qty: String(t.qty), discount: String(t.discount) })));
      const g = d?.settings?.gift || {};
      setGiftEnabled(g.enabled !== false);
      setGiftTiers((g.tiers || []).map((t: any) => ({ amount: String(t.amount), freeQty: String(t.freeQty) })));
      setGiftPool(g.productIds || []);
      setGiftExclude(g.excludeProductIds || []);
    }).catch(() => {});
  }, []);
  const saveGift = async () => {
    setBusy(true); setMsg("");
    const r = await afetch("/api/admin/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: "gift", value: {
        enabled: giftEnabled,
        tiers: giftTiers.filter((t) => t.amount && t.freeQty).map((t) => ({ amount: Number(t.amount), freeQty: Number(t.freeQty) })),
        productIds: giftPool, excludeProductIds: giftExclude,
      } }),
    });
    setMsg(r.ok ? "Free gift rule saved ✔" : ((await r.json().catch(() => ({}))) as any).error || "Save failed");
    setBusy(false);
  };
  const saveDept = async () => {
    setBusy(true); setMsg("");
    const r = await afetch("/api/admin/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: "combo", value: { enabled: deptEnabled, deptTiers: deptTiers.filter((t) => t.qty && t.discount).map((t) => ({ qty: Number(t.qty), discount: Number(t.discount) })) } }),
    });
    setMsg(r.ok ? "Department rule saved ✔" : ((await r.json().catch(() => ({}))) as any).error || "Save failed");
    setBusy(false);
  };
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const reload = async () => {
    const r = await afetch("/api/admin/combo-bundles", { method: "GET" });
    if (r.ok) setBundles((await r.json()).bundles);
  };

  const create = async () => {
    setBusy(true); setMsg("");
    const r = await afetch("/api/admin/combo-bundles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, price: Number(price), productIds: picked, active: true }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setMsg(d.error || "Could not create bundle");
    else { setMsg("Bundle created ✔"); setTitle(""); setPrice(""); setPicked([]); await reload(); }
    setBusy(false);
  };

  const toggle = async (b: Bundle) => {
    await afetch(`/api/admin/combo-bundles/${b.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !b.active }) });
    await reload();
  };
  const remove = async (b: Bundle) => {
    if (!confirm(`Delete bundle "${b.title}"?`)) return;
    await afetch(`/api/admin/combo-bundles/${b.id}`, { method: "DELETE" });
    await reload();
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Combo Bundles</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 18 }}>
        Cross-product offer: cart e jodi bundle er shob product 1 ta kore thake, oi product gular 1 ta kore er
        price = bundle price. Extra quantity base price e. Shudhu <b>combo department</b> er products (product edit e
        "Combo offer" checkbox) ekhane add kora jay.
      </p>

      <div className="card" style={{ padding: 16, marginBottom: 22 }}>
        <h3 style={{ margin: "0 0 6px" }}>Department combo rule (combo section)</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10 }}>
          Combo department er product theke cart e mot {"{qty}"} ta item nile {"{discount}"} taka discount.
          1 ta item e kono discount nei. Ei amount gula apni set korben.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={deptEnabled} onChange={(e) => setDeptEnabled(e.target.checked)} /> Rule on
        </label>
        {deptEnabled && deptTiers.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <input type="number" min="2" max="99" step="1" placeholder="Items (e.g. 2)" value={t.qty} style={{ width: 120 }}
              onChange={(e) => { const c = [...deptTiers]; c[i] = { ...c[i], qty: e.target.value }; setDeptTiers(c); }} />
            <input type="number" min="0" step="1" placeholder="Discount ৳ (e.g. 200)" value={t.discount} style={{ width: 170 }}
              onChange={(e) => { const c = [...deptTiers]; c[i] = { ...c[i], discount: e.target.value }; setDeptTiers(c); }} />
            <button type="button" className="abtn" onClick={() => setDeptTiers((c) => c.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {deptEnabled && <button type="button" className="abtn" style={{ marginBottom: 10 }} onClick={() => setDeptTiers((c) => [...c, { qty: "", discount: "" }])}>+ Add rule</button>}
        <div>
          <button className="btn" onClick={saveDept} disabled={busy}>Save department rule</button>
          {msg && <span style={{ marginLeft: 10, fontSize: 13 }}>{msg}</span>}
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 22 }}>
        <h3 style={{ margin: "0 0 6px" }}>Free gift rule</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10 }}>
          Order amount (discount er age, excluded product baad) threshold cross korle customer free gift nite parbe.
          E.g. 2500+ → 1 ta free, 5000+ → 2 ta free.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={giftEnabled} onChange={(e) => setGiftEnabled(e.target.checked)} /> Rule on
        </label>
        {giftEnabled && (<>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Thresholds</div>
          {giftTiers.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
              <input type="number" min="1" step="1" placeholder="Order ≥ ৳ (e.g. 2500)" value={t.amount} style={{ width: 170 }}
                onChange={(e) => { const c = [...giftTiers]; c[i] = { ...c[i], amount: e.target.value }; setGiftTiers(c); }} />
              <input type="number" min="1" max="10" step="1" placeholder="Free items (e.g. 1)" value={t.freeQty} style={{ width: 150 }}
                onChange={(e) => { const c = [...giftTiers]; c[i] = { ...c[i], freeQty: e.target.value }; setGiftTiers(c); }} />
              <button type="button" className="abtn" onClick={() => setGiftTiers((c) => c.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="abtn" style={{ marginBottom: 12 }} onClick={() => setGiftTiers((c) => [...c, { amount: "", freeQty: "" }])}>+ Add threshold</button>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Free gift pool (choose products)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12, maxHeight: 160, overflow: "auto" }}>
            {(allProducts || []).map((p) => (
              <button key={p.id} type="button" className="abtn" style={{ opacity: giftPool.includes(p.id) ? 1 : 0.55, fontWeight: giftPool.includes(p.id) ? 700 : 400, fontSize: 12 }}
                onClick={() => setGiftPool((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])}>
                {p.title} (৳{p.price})
              </button>
            ))}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Excluded from threshold (optional)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12, maxHeight: 120, overflow: "auto" }}>
            {(allProducts || []).map((p) => (
              <button key={p.id} type="button" className="abtn" style={{ opacity: giftExclude.includes(p.id) ? 1 : 0.4, fontSize: 12 }}
                onClick={() => setGiftExclude((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])}>
                {p.title}
              </button>
            ))}
          </div>
        </>)}
        <button className="btn" onClick={saveGift} disabled={busy}>Save free gift rule</button>
        {msg && <span style={{ marginLeft: 10, fontSize: 13 }}>{msg}</span>}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 22 }}>
        <h3 style={{ margin: "0 0 10px" }}>New bundle</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input placeholder="Bundle title (e.g. Pant + Shirt Deal)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <input type="number" min="0" step="0.01" placeholder="Bundle price (৳)" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 150 }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {eligibleProducts.map((p) => (
            <button key={p.id} type="button" className="abtn" style={{ opacity: picked.includes(p.id) ? 1 : 0.55, fontWeight: picked.includes(p.id) ? 700 : 400 }}
              onClick={() => setPicked((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])}>
              {p.title} (৳{p.price})
            </button>
          ))}
          {eligibleProducts.length === 0 && <span style={{ color: "var(--muted)", fontSize: 13 }}>Kono combo-department product nei — age product edit theke "Combo offer" checkbox on korun.</span>}
        </div>
        <button className="btn" onClick={create} disabled={busy || !title || !price || picked.length < 2}>Create bundle</button>
        {msg && <span style={{ marginLeft: 10, fontSize: 13 }}>{msg}</span>}
      </div>

      {bundles.length === 0 && <p style={{ color: "var(--muted)" }}>Kono bundle nei.</p>}
      {bundles.map((b) => (
        <div key={b.id} className="card" style={{ padding: 14, marginBottom: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <b>{b.title}</b>
          <span>৳{b.price}</span>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>{b.items.map((i) => i.product.title).join(" + ")}</span>
          <span style={{ flex: 1 }} />
          <button className="abtn" onClick={() => toggle(b)}>{b.active ? "Active" : "Inactive"}</button>
          <button className="abtn" onClick={() => remove(b)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
