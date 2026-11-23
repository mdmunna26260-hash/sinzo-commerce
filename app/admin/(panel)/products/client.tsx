"use client";
import { afetch, withToken } from "@/lib/afetch";
import { useEffect, useMemo, useRef, useState } from "react";
import { appendSizePreset, productEditorPayload } from "@/lib/product-editor";
import { parseProductInput } from "@/lib/product-input";
import { useRouter } from "next/navigation";

type P = any;

/* Linked color-variant image cell: upload an image for this
   variant; selecting that color on the PDP shows this image first. */
function VariantImgCell({ v, i, uploadImage, removeImage }: { v: any; i: number; removeImage: () => void; uploadImage: (file: File, index: number) => Promise<void> }) {
  return <div className="product-variant-image">
    {v.image && <img src={v.image} alt="Variant preview" width="30" height="38" />}
    <label className="abtn sm">Photo
      <input type="file" accept="image/*" hidden aria-label={"Variant " + (i + 1) + " photo"} onChange={e => {
        const file = e.target.files?.[0]; if (file) void uploadImage(file, i); e.target.value = "";
      }} />
    </label>
    {v.image && <button type="button" className="abtn sm" aria-label={"Remove variant " + (i + 1) + " photo"} onClick={removeImage}>Remove photo</button>}
  </div>;
}

const EMPTY: any = { title: "", slug: "", shortDesc: "", description: "", sku: "", barcode: "", price: "", comparePrice: "", cost: "", stock: "0", lowStock: "5", soldCount: "", saleEnds: "", status: "DRAFT", featured: false, isNew: false, isBestSeller: false, badge: '', sizeChartImage: "", tags: "", categoryId: "", images: [], variants: [], colorGroupId: "", colorName: "", colorImage: "", preorder: false, preorderDate: "", soldMode: "fixed", comboEligible: false, comboTiers: [] as { qty: string; total: string }[], outsideDeliveryFee: "" };
function DescriptionEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after: string) => {
    const ta = ref.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = value.slice(s, e) || "text";
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    setTimeout(() => { ta.focus(); ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; }, 0);
  };
  const linePrefix = (prefix: string) => {
    const ta = ref.current; if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + prefix.length; }, 0);
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <button type="button" className="abtn sm" title="Bold" onClick={() => wrap("**", "**")}><b>B</b></button>
        <button type="button" className="abtn sm" title="Italic" onClick={() => wrap("_", "_")}><i>I</i></button>
        <button type="button" className="abtn sm" title="Large text" onClick={() => wrap("## ", "")} style={{ fontWeight: 700, fontSize: 14 }}>H</button>
        <button type="button" className="abtn sm" title="Small text" onClick={() => wrap("~~", "~~")} style={{ fontSize: 11 }}>small</button>
        <button type="button" className="abtn sm" title="Bullet point" onClick={() => linePrefix("• ")}>• List</button>
        <button type="button" className="abtn sm" title="Tick point" onClick={() => linePrefix("✓ ")}>✓ Tick</button>
      </div>
      <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} style={{ minHeight: 130, fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        <b>**text**</b> = bold · <b>## text</b> = large heading · <b>_text_</b> = italic · <b>~~text~~</b> = small · <b>• / ✓</b> = list items (product page-e auto style hobe)
      </div>
    </div>
  );
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9\u0980-\u09FF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export default function ProductsClient({ initial, categories, initialCreate = false, initialEditId }: { initial: P[]; categories: { id: number; name: string }[]; initialCreate?: boolean; initialEditId?: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<any | null>(() => initialCreate ? { ...EMPTY, images: [], variants: [], comboTiers: [] } : null);
  const [colorGroups, setColorGroups] = useState<any[]>([]);

  const loadColorGroups = () => {
    afetch("/api/admin/color-groups")
      .then((r) => r.json())
      .then((j) => setColorGroups(j.groups || []))
      .catch(() => {});
  };
  useEffect(() => { if (initialCreate) loadColorGroups(); }, [initialCreate]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const mutation = useRef(false);
  const baseline = useRef(JSON.stringify(initialCreate ? { ...EMPTY, images: [], variants: [], comboTiers: [] } : null));
  const dialogRef = useRef<HTMLDivElement>(null);
  const [bulkStock, setBulkStock] = useState("");
  const dirty = !!edit && JSON.stringify(edit) !== baseline.current;
  const beginEditor = (value: any) => { baseline.current = JSON.stringify(value); setEdit(value); setMsg(""); setBulkStock(""); };
  const closeEditor = () => {
    if (mutation.current || (dirty && !confirm("Discard unsaved product changes?"))) return;
    setEdit(null); setMsg("");
  };
  useEffect(() => {
    if (!edit) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const viewport = window.visualViewport;
    const fitKeyboard = () => {
      const overlay = dialogRef.current?.parentElement;
      overlay?.style.setProperty("--product-keyboard-offset", Math.max(0, window.innerHeight - (viewport?.height || window.innerHeight) - (viewport?.offsetTop || 0)) + "px");
    };
    fitKeyboard(); viewport?.addEventListener("resize", fitKeyboard); viewport?.addEventListener("scroll", fitKeyboard);
    return () => {
      document.body.style.overflow = overflow; previous?.focus();
      viewport?.removeEventListener("resize", fitKeyboard); viewport?.removeEventListener("scroll", fitKeyboard);
    };
  }, [!!edit]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const lock = () => { if (mutation.current) return false; mutation.current = true; setBusy(true); return true; };
  const unlock = () => { mutation.current = false; setBusy(false); };
  const [slugTouched, setSlugTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<P[]>(initial);
  const [dragId, setDragId] = useState<number | null>(null);
  useEffect(() => { setItems(initial); }, [initial]);
  const list = useMemo(() => items.filter((p) => !q || (p.title + p.sku + p.tags).toLowerCase().includes(q.toLowerCase())), [items, q]);

  const persistOrder = async (next: P[]) => {
    if (!lock()) return;
    setItems(next);
    try {
      const r = await afetch("/api/admin/products/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: next.map((p) => p.id) }) });
      if (r.ok) { setMsg("✓ Order saved — homepage/listing-e dekhabe"); router.refresh(); }
      else { const j = await r.json(); setMsg(j.error || "Reorder failed"); }
    } catch { setMsg("Network error"); }
    finally { unlock(); }
  };
  const move = (fromId: number | null, toId: number) => {
    if (fromId == null || fromId === toId) return;
    const next = [...items];
    const fi = next.findIndex((p) => p.id === fromId);
    const ti = next.findIndex((p) => p.id === toId);
    if (fi < 0 || ti < 0) return;
    const [m] = next.splice(fi, 1);
    next.splice(ti, 0, m);
    persistOrder(next);
  };
  const moveBy = (id: number, d: number) => {
    const i = items.findIndex((p) => p.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    persistOrder(next);
  };

  const openNew = () => { if (mutation.current) return; setSlugTouched(false); beginEditor({ ...EMPTY, images: [], variants: [], comboTiers: [] }); loadColorGroups(); };
  const openEdit = (p: P) => {
    if (mutation.current) return;
    setSlugTouched(true);
    loadColorGroups();
    // Map old isNew/isBestSeller to badge for backwards compatibility
    const badge = p.badge || (p.isBestSeller ? "hot" : p.isNew ? "new" : "");
    beginEditor({
      ...EMPTY, ...p, badge,
    sku: p.sku || "", barcode: p.barcode || "", tags: p.tags || "",
    shortDesc: p.shortDesc || "", description: p.description || "", categoryId: p.categoryId != null ? String(p.categoryId) : "",
    price: String(p.price), comparePrice: p.comparePrice != null ? String(p.comparePrice) : "",
    cost: p.cost != null ? String(p.cost) : "", stock: String(p.stock), lowStock: String(p.lowStock),
    soldCount: p.soldCount != null ? String(p.soldCount) : "",
    saleEnds: p.saleEnds ? new Date(p.saleEnds).toISOString().slice(0, 16) : "",
    preorder: !!p.preorder, preorderDate: p.preorderDate ? new Date(p.preorderDate).toISOString().slice(0, 10) : "",
    soldMode: p.soldMode || "fixed",
    comboEligible: !!p.comboEligible,
    outsideDeliveryFee: p.outsideDeliveryFee != null ? String(p.outsideDeliveryFee) : "",
    comboTiers: (() => { try { const t = JSON.parse(p.comboOffers || "[]"); return Array.isArray(t) ? t.map((x: any) => ({ qty: String(x.qty), total: String(x.total) })) : []; } catch { return []; } })(),
    colorGroupId: p.colorGroupId != null ? String(p.colorGroupId) : "",
    colorName: p.colorName || "",
    // auto: color thumbnail defaults to the product's main image (admin can replace/remove)
    colorImage: p.colorImage || (p.images && p.images[0] ? p.images[0].url : ""),
    variants: p.variants.map((v: any) => ({ ...v, size: v.size || "", color: v.color || "", sku: v.sku || "", price: v.price != null ? String(v.price) : "", stock: String(v.stock), image: v.image || "" })),
  }); };

  const openedId = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (initialEditId && openedId.current !== initialEditId) {
      const product = initial.find(p => p.id === initialEditId);
      if (product) { openedId.current = initialEditId; openEdit(product); }
    }
  }, [initialEditId, initial]);

  const genVariants = (kind: "alpha" | "numeric") => setEdit((e: any) => ({ ...e, variants: appendSizePreset(e, kind) }));
  const uploadFiles = async (files: File[], target: "gallery" | "chart" | "color" | number = "gallery") => {
    if (!lock()) return;
    setMsg("Uploading photos. Please keep this editor open.");
    let added = 0;
    const failed: string[] = [];
    try {
      for (const file of files) {
        try {
          const fd = new FormData(); fd.append("file", file); if (target === "chart") fd.append("mode", "chart");
          const r = await afetch("/api/admin/upload", { method: "POST", body: fd });
          const j = await r.json();
          if (!r.ok || !j.url) throw new Error(j.error || "Upload failed");
          setEdit((e: any) => {
            if (!e) return e;
            if (target === "chart") return { ...e, sizeChartImage: j.url };
            if (target === "color") return { ...e, colorImage: j.url };
            if (typeof target === "number") return { ...e, variants: e.variants.map((v: any, i: number) => i === target ? { ...v, image: j.url } : v) };
            return { ...e, images: [...e.images, j.url], colorImage: e.colorImage || (e.images.length === 0 ? j.url : "") };
          });
          added++;
        } catch { failed.push(file.name); }
      }
      setMsg(failed.length ? added + " uploaded; failed: " + failed.join(", ") + ". Select failed files to retry. Uploaded photos are kept." : added + " photo(s) uploaded. Save the product to keep these changes.");
    } finally { unlock(); }
  };
  const upload = (files: FileList) => uploadFiles(Array.from(files));
  const uploadChart = (file: File) => uploadFiles([file], "chart");

  const moveImg = (i: number, dir: number) => setEdit((e: any) => {
    const arr = [...e.images]; const j = i + dir;
    if (j < 0 || j >= arr.length) return e;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...e, images: arr };
  });

  const save = async (status: string) => {
    if (mutation.current) return;
    let payload;
    try {
      payload = productEditorPayload(edit, status);
      parseProductInput(payload);
    } catch (error: any) {
      setMsg(error.message || "Check the required fields.");
      dialogRef.current?.querySelector<HTMLInputElement>(!String(edit.title || "").trim() ? "#product-title" : "#product-price")?.focus();
      return;
    }
    const original = JSON.parse(baseline.current || "null");
    if (status === "ACTIVE" && original?.status !== "ACTIVE" && !confirm("Publish this product? It will be visible in the store.")) return;
    if (original?.id && original.status === "ACTIVE" && status !== "ACTIVE" && !confirm("Remove this product from the live store and save it as " + status + "?")) return;
    if (!lock()) return;
    setMsg("");
    try {
      const r = await afetch(edit.id ? "/api/admin/products/" + edit.id : "/api/admin/products", {
        method: edit.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setEdit(null); setMsg(status === "DRAFT" ? "Draft saved. Not visible in the store." : "Product saved successfully."); router.refresh(); }
      else setMsg(j.error || "Save failed");
    } catch {
      setMsg("Could not confirm the save. Your edits are kept. Check the product list before retrying a new product.");
    } finally {
      unlock();
    }
  };

  const duplicate = async (p: P) => {
    if (!confirm('Duplicate "' + p.title + '" as a draft with zero stock?')) return;
    if (!lock()) return;
    try {
      const r = await afetch("/api/admin/products/" + p.id + "/duplicate", { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.product) { setMsg(j.error || "Duplicate failed"); return; }
      unlock();
      openEdit({ ...j.product, images: (j.product.images || []).sort((a: any, b: any) => a.position - b.position).map((image: any) => image.url) });
      setMsg("Duplicated as DRAFT with zero stock. Review photos, details and variants before publishing.");
      router.refresh();
    } catch { setMsg("Could not confirm duplication. Check the product list before retrying."); }
    finally { unlock(); }
  };

  const del = async (p: P) => {
    if (!confirm(`Delete "${p.title}"? Products used in orders will be archived to preserve order history.`)) return;
    if (!lock()) return;
    try {
      const response = await afetch("/api/admin/products/" + p.id, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) setMsg(result.error || "Delete failed");
      else setMsg(result.archived ? "Product had order history and was archived ✓" : "Product deleted ✓");
      router.refresh();
    } catch {
      setMsg("Network error — product was not deleted");
    } finally {
      unlock();
    }
  };
  const exportCsv = () => { window.location.href = withToken("/api/admin/export?type=products"); };

  return (
    <>
      <div className="admin-top">
        <h1>Products <span style={{ fontSize: 14, color: "var(--muted)" }}>({initial.length})</span></h1>
        <div className="admin-actions">
          <button className="abtn" onClick={exportCsv}>⭳ Export CSV</button>
          <button className="abtn primary" onClick={openNew}>+ Add Product</button>
        </div>
      </div>
      {msg && !edit && <div className="noti" role="status">{msg}</div>}
      <input className="asearch" style={{ marginBottom: 14 }} placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px" }}>⠿ handle dhore drag korun — order change hole automatic save hoy ar homepage/listing-e sei order dekhabe</div>
      <div className="acard">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th style={{ width: 60 }}>⠿ Order</th><th></th><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Variants</th><th>Status</th><th>Views</th><th></th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={10} style={{ color: "var(--muted)", padding: 30 }}>No products yet.</td></tr>}
              {list.map((p, idx) => (
                <tr key={p.id}
                  draggable={q === ""}
                  onDragStart={() => setDragId(p.id)}
                  onDragOver={(e) => { if (q === "") e.preventDefault(); }}
                  onDrop={() => { move(dragId, p.id); setDragId(null); }}
                  style={{ cursor: q === "" ? "grab" : undefined, opacity: dragId === p.id ? 0.5 : 1 }}
                >
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span title="Drag to reorder" style={{ cursor: "grab", fontSize: 16, color: "var(--muted)" }}>⠿</span>
                    <button className="abtn sm" style={{ padding: "1px 6px", margin: "0 2px" }} title="Move up" onClick={() => moveBy(p.id, -1)} disabled={idx === 0}>↑</button>
                    <button className="abtn sm" style={{ padding: "1px 6px" }} title="Move down" onClick={() => moveBy(p.id, 1)} disabled={idx === list.length - 1}>↓</button>
                  </td>
                  <td>{p.image ? <img src={p.image} alt="" /> : <div style={{ width: 40, height: 50, background: "#eee", borderRadius: 4 }} />}</td>
                  <td><b>{p.title}</b><br /><span style={{ color: "var(--muted)", fontSize: 12 }}>{p.categoryName || "Uncategorized"}{p.featured ? " · ★ Featured" : ""}</span></td>
                  <td style={{ fontSize: 12 }}>{p.sku || "—"}</td>
                  <td>৳{p.price.toLocaleString("en-IN")}{p.comparePrice ? <><br /><s style={{ color: "var(--muted)", fontSize: 12 }}>৳{p.comparePrice.toLocaleString("en-IN")}</s></> : null}</td>
                  <td>{p.stock <= p.lowStock ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>{p.stock}</span> : p.stock}</td>
                  <td>{p.variants.length || "—"}</td>
                  <td><span className={"pill " + p.status}>{p.status}</span></td>
                  <td>{p.views}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="abtn sm" onClick={() => openEdit(p)}>Edit</button>{" "}
                    <button className="abtn sm" title="Duplicate product" aria-label={"Duplicate " + p.title} disabled={busy} onClick={() => duplicate(p)}>📋</button>{" "}
                    <button className="abtn sm danger" aria-label={"Delete " + p.title} disabled={busy} onClick={() => del(p)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div className="modal-bg product-editor-bg" onClick={closeEditor}>
          <div className="modal product-editor" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="product-editor-title" tabIndex={-1} style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()} onKeyDown={e => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeEditor(); }
            if (e.key === "Tab") {
              const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(n => n.getClientRects().length);
              const first = focusable[0], last = focusable[focusable.length - 1];
              if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); last?.focus(); }
              else if (!e.shiftKey && (document.activeElement === last || document.activeElement === e.currentTarget)) { e.preventDefault(); first?.focus(); }
            }
          }}>
            <header className="product-editor-header"><div><h3 id="product-editor-title">{edit.id ? "Edit Product" : "New Product"}</h3><p>Title and price are required. New products start as drafts.</p></div><button className="abtn" aria-label="Close product editor" disabled={busy} onClick={closeEditor}>Close</button></header>
            <div className="product-editor-feedback" role="status" aria-live="polite">{msg || (dirty ? "Unsaved changes" : "Ready to edit")}</div>
            <fieldset className="product-editor-fields" disabled={busy}>
            <h4 className="product-section-title">Product basics</h4>
            <div className="form-grid">
              <div className="af full"><label htmlFor="product-title">Title *</label>
                <input id="product-title" aria-required="true" maxLength={200} value={edit.title} onChange={(e) => { const title = e.target.value; setEdit((x: any) => ({ ...x, title, slug: slugTouched ? x.slug : slugify(title) })); }} />
              </div>
              <div className="af full">
                <label>URL / Slug (auto-generates from title)</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={edit.slug} onChange={(e) => { setSlugTouched(true); setEdit({ ...edit, slug: slugify(e.target.value) }); }} placeholder="auto-generates…" />
                  <button type="button" className="abtn" title="Auto-generate from title" onClick={() => { setSlugTouched(false); setEdit({ ...edit, slug: slugify(edit.title) }); }}>Auto</button>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Store URL: /products/<b>{edit.slug || "…"}{edit.id ? "" : " (visibility follows saved status)"}</b></div>
              </div>
              <div className="af"><label htmlFor="product-price">Price (BDT) *</label><input id="product-price" aria-required="true" inputMode="decimal" type="number" min="0" step="0.01" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></div>
              <div className="af"><label>Compare-at price (BDT)</label><input type="number" min="0" step="0.01" value={edit.comparePrice} onChange={(e) => setEdit({ ...edit, comparePrice: e.target.value })} placeholder="Original price for discounts" /></div>
              <div className="af"><label>Cost per item (BDT)</label><input type="number" min="0" step="0.01" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })} placeholder="For profit margin" /></div>
              <div className="af"><label htmlFor="product-sku">SKU</label><input id="product-sku" value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} /></div>
              <div className="af"><label htmlFor="product-barcode">Barcode</label><input id="product-barcode" value={edit.barcode || ""} onChange={e => setEdit({ ...edit, barcode: e.target.value })} /></div>
              <div className="af"><label htmlFor="product-stock">Stock</label><input id="product-stock" inputMode="numeric" type="number" min="0" step="1" value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: e.target.value })} /></div>
              <div className="af"><label>Low-stock alert at</label><input type="number" min="0" step="1" value={edit.lowStock} onChange={(e) => setEdit({ ...edit, lowStock: e.target.value })} /></div>
              <details className="product-editor-options af full"><summary>Offers, delivery and pre-order options</summary><div className="form-grid">
              <div className="af"><label>Outside Dhaka delivery (BDT)</label><input type="number" min="0" step="1" value={edit.outsideDeliveryFee} onChange={(e) => setEdit({ ...edit, outsideDeliveryFee: e.target.value })} placeholder="e.g. 150 — blank = default" />
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Per-product override: outside-Dhaka orders pay THIS fee instead of the global setting (highest in cart wins).</div>
              </div>
              <div className="af full"><label>Flash sale countdown (optional)</label>
                <input type="datetime-local" value={edit.saleEnds || ""} onChange={(e) => setEdit({ ...edit, saleEnds: e.target.value })} />
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Compare-at price beshi hole countdown dekhabe (PDP + card e "Sale ends in 2h 34m"). Time hole automatic off.
                </div>
              </div>
              <div className="af full"><label>Combo offer (combo department)</label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginBottom: 8 }}>
                  <input type="checkbox" checked={!!edit.comboEligible} onChange={(e) => setEdit({ ...edit, comboEligible: e.target.checked })} />
                  Ei product ta combo department e — shudhu er upor e combo offer kaj korbe
                </label>
                {edit.comboEligible && (
                  <div>
                    {(edit.comboTiers || []).map((t: any, i: number) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                        <input type="number" min="2" max="99" step="1" placeholder="Qty (e.g. 2)" value={t.qty} style={{ width: 110 }}
                          onChange={(e) => { const c = [...edit.comboTiers]; c[i] = { ...c[i], qty: e.target.value }; setEdit({ ...edit, comboTiers: c }); }} />
                        <input type="number" min="0" step="0.01" placeholder="Total price (e.g. 1600)" value={t.total} style={{ width: 170 }}
                          onChange={(e) => { const c = [...edit.comboTiers]; c[i] = { ...c[i], total: e.target.value }; setEdit({ ...edit, comboTiers: c }); }} />
                        <button type="button" className="abtn" onClick={() => setEdit({ ...edit, comboTiers: edit.comboTiers.filter((_: any, j: number) => j !== i) })}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="abtn" onClick={() => setEdit({ ...edit, comboTiers: [...(edit.comboTiers || []), { qty: "", total: "" }] })}>+ Add tier</button>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      Udahoron: price 900 hole — 2 ta = 1600 (save 200), 3 ta = 2300 (save 400). 1 ta te kono discount nei.
                    </div>
                  </div>
                )}
              </div>
              <div className="af full"><label>Sold count (product page e "Sold: N" dekhabe)</label>
                <div style={{ display: "flex", gap: 18, marginBottom: 8, fontSize: 13 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="soldmode" checked={edit.soldMode !== "random"} onChange={() => setEdit({ ...edit, soldMode: "fixed" })} />
                    Fixed (exact number)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="soldmode" checked={edit.soldMode === "random"} onChange={() => setEdit({ ...edit, soldMode: "random" })} />
                    Random (auto, din boro hoy)
                  </label>
                </div>
                <input type="number" value={edit.soldCount} disabled={edit.soldMode === "random"}
                  onChange={(e) => setEdit({ ...edit, soldCount: e.target.value })} placeholder="khaali = dekhabe na" />
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  {edit.soldMode === "random"
                    ? "Random mode e number auto-generated hoy ar bishesh-khon e +1..+3 hoye boro hoy (aj 958 → 961 → 965…). Number field ei mode e ignore hoy."
                    : "Fixed mode e soho ei number dekhabe. Khaali rakhle sold count dekhabe na."}
                </div>
              </div>
              <div className="af full"><label>Pre-order (stock ashe na, age order nito jay)</label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!edit.preorder} onChange={(e) => setEdit({ ...edit, preorder: e.target.checked })} />
                  <span>Pre-order on koro — stock 0 thakleo customer order dite parbe (stock komabe na)</span>
                </label>
                {edit.preorder && (
                  <>
                    <input type="date" value={edit.preorderDate || ""} onChange={(e) => setEdit({ ...edit, preorderDate: e.target.value })} />
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      PDP e <b>Pre-order</b> badge + "Expected delivery (date)" dekhabe. Admin order list e PRE-ORDER tag thakbe.
                    </div>
                  </>
                )}
              </div>
              </div></details>
              <div className="af"><label>Category</label>
                <select value={edit.categoryId} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value })}>
                  <option value="">— None —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="af"><label htmlFor="product-status">Status</label>
                <select id="product-status" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  <option>ACTIVE</option><option>DRAFT</option><option>ARCHIVED</option>
                </select>
              </div>
              <div className="af full"><label>Short description</label><input value={edit.shortDesc} onChange={(e) => setEdit({ ...edit, shortDesc: e.target.value })} /></div>
              <div className="af full">
                <label>Full description (formatting supported)</label>
                <DescriptionEditor value={edit.description || ""} onChange={(v: string) => setEdit({ ...edit, description: v })} />
              </div>
              <div className="af full"><label>Tags (comma separated)</label><input value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} placeholder="linen, summer, new" /></div>
            </div>

            <h4 className="product-section-title">Photos ({edit.images.length})</h4>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              {edit.images.map((u: string, i: number) => (
                <div key={i} className="product-photo" style={{ position: "relative", textAlign: "center" }}>
                  <img src={u} alt="" style={{ width: 64, height: 80, objectFit: "cover", borderRadius: 4, border: i === 0 ? "2px solid var(--text)" : "1px solid #ddd" }} title={i === 0 ? "Main image" : "Image " + (i + 1)} />
                  {i === 0 && <span style={{ position: "absolute", top: 4, left: 4, background: "var(--text)", color: "#fff", fontSize: 9, padding: "1px 6px", borderRadius: 99 }}>MAIN</span>}
                  <button aria-label={"Remove photo " + (i + 1)} onClick={() => setEdit({ ...edit, images: edit.images.filter((_: any, x: number) => x !== i) })} style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: 99, border: "none", background: "#b3392f", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
                  <div style={{ display: "flex", gap: 2, marginTop: 4, justifyContent: "center" }}>
                    <button type="button" className="abtn sm" style={{ padding: "2px 8px" }} disabled={i === 0} aria-label={"Move photo " + (i + 1) + " earlier"} onClick={() => moveImg(i, -1)}>←</button>
                    <button type="button" className="abtn sm" style={{ padding: "2px 8px" }} disabled={i === edit.images.length - 1} aria-label={"Move photo " + (i + 1) + " later"} onClick={() => moveImg(i, 1)}>→</button>
                  </div>
                </div>
              ))}
              <button className="abtn" onClick={() => fileRef.current?.click()} type="button">⬆ Upload images</button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
              <div style={{ fontSize: 12, color: "var(--muted)", width: "100%" }}>Select multiple photos from your phone. First photo is the main image. Use arrows to reorder.</div>
            </div>

            <div className="var-head">
              <span>Variants (size / color / stock)</span>
              <span className="var-head-btns">
                <button className="abtn sm" type="button" title="S M L XL XXL auto-generate" onClick={() => genVariants("alpha")}>Add S-XXL</button>
                <button className="abtn sm" type="button" title="28–40 numeric sizes auto-generate" onClick={() => genVariants("numeric")}>Add 28-40</button>
                <button className="abtn sm" type="button" onClick={() => setEdit({ ...edit, variants: [...(edit.variants || []), { size: "", color: "", sku: "", price: "", stock: "0" }] })}>+ Add</button>
              </span>
            </div>
            <p className="product-editor-hint">Size presets add missing sizes with zero stock. Existing variants are kept. Blank variant price uses the product price.</p>
            {!!edit.variants.length && <div className="product-bulk-stock"><label htmlFor="variant-bulk-stock">Set all variant stock</label><input id="variant-bulk-stock" type="number" min="0" step="1" inputMode="numeric" value={bulkStock} onChange={e => setBulkStock(e.target.value)} placeholder="Quantity" /><button type="button" className="abtn" onClick={() => {
              const value = Number(bulkStock);
              if (!bulkStock.trim() || !Number.isSafeInteger(value) || value < 0) { setMsg("Enter a non-negative whole stock quantity."); return; }
              if (!confirm("Set all " + edit.variants.length + " variant quantities to " + value + "? Current: " + edit.variants.map((v: any) => (v.size || v.color || "Variant") + ": " + v.stock).join(", ") + ". Changes apply when you save.")) return;
              setEdit((e: any) => ({ ...e, variants: e.variants.map((v: any) => ({ ...v, stock: String(value) })) }));
            }}>Apply to all</button></div>}
            {(edit.variants || []).map((v: any, i: number) => (
              <div key={i} className="var-row">
                <label className="product-variant-field"><span>Size</span><input placeholder="Size" aria-label={"Variant " + (i + 1) + " size"} value={v.size} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, size: e.target.value }; setEdit({ ...edit, variants: vs }); }} /></label>
                <label className="product-variant-field"><span>Color</span><input placeholder="Color" aria-label={"Variant " + (i + 1) + " color"} value={v.color} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, color: e.target.value }; setEdit({ ...edit, variants: vs }); }} /></label>
                <label className="product-variant-field"><span>SKU</span><input placeholder="SKU" aria-label={"Variant " + (i + 1) + " SKU"} value={v.sku} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, sku: e.target.value }; setEdit({ ...edit, variants: vs }); }} /></label>
                <label className="product-variant-field"><span>Price</span><input placeholder="Price" aria-label={"Variant " + (i + 1) + " price"} min="0" step="0.01" type="number" inputMode="decimal" value={v.price} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, price: e.target.value }; setEdit({ ...edit, variants: vs }); }} /></label>
                <label className="product-variant-field"><span>Stock</span><input placeholder="Stock" aria-label={"Variant " + (i + 1) + " stock"} min="0" step="1" type="number" inputMode="numeric" value={v.stock} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, stock: e.target.value }; setEdit({ ...edit, variants: vs }); }} /></label>
                {/* linked color image: oi color select korle PDP gallery ei image dekhabe */}
                <VariantImgCell v={v} i={i} removeImage={() => setEdit((e: any) => ({ ...e, variants: e.variants.map((row: any, index: number) => index === i ? { ...row, image: "" } : row) }))} uploadImage={(file, index) => uploadFiles([file], index)} />
                <button className="abtn sm danger var-del" type="button" aria-label={"Remove variant " + (i + 1)} onClick={() => { if (confirm("Remove this variant? Changes apply when you save.")) setEdit({ ...edit, variants: edit.variants.filter((_: any, x: number) => x !== i) }); }}>✕</button>
              </div>
            ))}

            <details className="product-editor-options"><summary>Linked colors, size chart and badge</summary>
            {/* ---- COLOR GROUP (linked color products) ---- */}
            <div className="af full" style={{ marginTop: 18, borderTop: "1px solid #e4e7ec", paddingTop: 14 }}>
              <label style={{ fontWeight: 600, fontSize: 13.5 }}>Color Group (linked color products)</label>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 10 }}>
                Ek rokom product er different color alada product hishebe thakbe (alada URL, stock, size) — kintu product page e circular color thumbnail diye linked thakbe. Khali rakhle kono link hobe na.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                <select
                  value={edit.colorGroupId || ""}
                  onChange={(e) => setEdit({ ...edit, colorGroupId: e.target.value })}
                >
                  <option value="">— No color group (standalone) —</option>
                  {(colorGroups || []).map((cg: any) => (
                    <option key={cg.id} value={String(cg.id)}>{cg.name} ({(cg.products || []).length} color{((cg.products || []).length) === 1 ? "" : "s"})</option>
                  ))}
                </select>
                <button type="button" className="abtn" onClick={async () => {
                  const name = prompt("New color group name:");
                  if (!name || name.trim().length < 2 || !lock()) return;
                  try {
                    const r = await afetch("/api/admin/color-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
                    const j = await r.json();
                    if (!r.ok || !j.group) { setMsg(j.error || "Could not create color group."); return; }
                    setColorGroups(cur => [{ ...j.group, products: [] }, ...cur]);
                    setEdit((e: any) => ({ ...e, colorGroupId: String(j.group.id) }));
                    setMsg("Color group created. Save the product to link it.");
                  } catch { setMsg("Could not create color group. Your product edits are kept."); }
                  finally { unlock(); }
                }}>+ New group</button>
              </div>
              {edit.colorGroupId && (
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)" }}>This product's color label (thumbnail er niche / alt text e dekhabe)</label>
                    <input value={edit.colorName || ""} onChange={(e) => setEdit({ ...edit, colorName: e.target.value })} placeholder="e.g. Black" style={{ width: "100%", marginTop: 4 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)" }}>Color thumbnail (circular swatch)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      {edit.colorImage ? (
                        <div style={{ position: "relative" }}>
                          <img src={edit.colorImage} alt="" style={{ width: 44, height: 44, borderRadius: 99, objectFit: "cover", border: "2px solid #ddd" }} />
                          <button type="button" onClick={() => setEdit({ ...edit, colorImage: "" })} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 99, border: "none", background: "#b3392f", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
                        </div>
                      ) : <div style={{ width: 44, height: 44, borderRadius: 99, border: "1px dashed #ccc" }} />}
                      <label className="abtn sm" style={{ cursor: "pointer" }}>
                        ⬆ Upload
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          await uploadFiles([f], "color"); e.target.value = "";
                        }} />
                      </label>
                    </div>
                  </div>
                </div>
              )}
              {edit.colorGroupId && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>
                  {(colorGroups || []).find((cg: any) => String(cg.id) === String(edit.colorGroupId))?.products?.length
                    ? "Linked products: " + (colorGroups || []).find((cg: any) => String(cg.id) === String(edit.colorGroupId))!.products.map((pp: any) => pp.colorName || pp.title).join(", ")
                    : "Ei group e ekhono onno product nai — onno color product gulote ei group select korlei linked hobe."}
                </div>
              )}
            </div>

            <div className="af full" style={{ marginTop: 16 }}>
              <label>Size chart image (optional — product page-er "Size chart" button e dekhabe)</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {edit.sizeChartImage ? (
                  <div style={{ position: "relative" }}>
                    <img src={edit.sizeChartImage} alt="" style={{ maxHeight: 90, borderRadius: 4, border: "1px solid #ddd" }} />
                    <button type="button" onClick={() => setEdit({ ...edit, sizeChartImage: "" })} style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: 99, border: "none", background: "#b3392f", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
                  </div>
                ) : null}
                <label className="abtn" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  ⬆ Upload size chart
                  <input type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.[0]) uploadChart(e.target.files[0]); e.target.value = ""; }} />
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center", flexWrap: "wrap" }}>
              <div className="af" style={{ minWidth: 200 }}>
                <label>Badge</label>
                <select value={edit.badge || ""} onChange={(e) => setEdit({ ...edit, badge: e.target.value })}>
                  <option value="">No Badge</option>
                  <option value="trending">TRENDING NOW</option>
                  <option value="hot">HOT PICK</option>
                  <option value="new">NEW</option>
                  <option value="signature">SIGNATURE</option>
                  <option value="limited">LIMITED</option>
                </select>
              </div>
              <span style={{ flex: 1 }} />
            </div>
            </details>
            </fieldset>
            <footer className="product-editor-savebar">
              <div><strong>{edit.status}</strong><small>{busy ? "Working. Please wait." : dirty ? "Unsaved changes" : "No unsaved changes"}</small></div>
              <button className="abtn" onClick={() => save("DRAFT")} disabled={busy}>Save draft</button>
              <button className="abtn primary" onClick={() => save(edit.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE")} disabled={busy} aria-busy={busy || undefined}>{busy ? "Working..." : edit.status === "ARCHIVED" ? "Save archived" : edit.id && edit.status === "ACTIVE" && JSON.parse(baseline.current || "null")?.status === "ACTIVE" ? "Save changes" : "Publish product"}</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
