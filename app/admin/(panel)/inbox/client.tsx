"use client";
import { afetch } from "@/lib/afetch";
import { useEffect, useRef, useState } from "react";

/* WhatsApp inbox (Phase 2).
   A reply can now carry photos (compressed on upload), a product card from the catalogue and the
   shop coupon — and when the thread is linked to an order, the six order updates are one click:
   the body comes from the very template the worker would use, so a manual "shipped" message is
   identical to the automatic one. */
type Conv = { waId: string; name: string | null; last: string; lastAt: string; lastDirection: string; count: number; inbound: number; order?: { id: number; code: string; name: string; status: string } | null };
type Msg = { id: number; waId: string; direction: string; body: string; status: string; createdAt: string };
type Order = { id: number; code: string; name: string; status: string; total: number };
type Hit = { id: number; title: string; slug: string; price: number; comparePrice: number | null; stock: number; status: string; image: string | null };
type Img = { url: string; text?: string };
type Ctx = {
  order: { id: number; code: string; name: string; status: string; waId: string; total: number; area: string; items: { title: string; qty: number }[] };
  events: { key: string; name: string; enabled: boolean; mediaMode: string }[];
  suggestedEvent: string; preview: string; images: string[];
};

const money = (n: number) => "৳" + Math.round(n || 0).toLocaleString("en-IN");

export default function InboxClient({ initialConversations, status, autoReply, quick, couponCode, stopLine }: {
  initialConversations: Conv[];
  status: { running: boolean; connected: boolean; me?: string | null };
  autoReply: string;
  quick: string[];
  couponCode: string;
  stopLine: boolean;
}) {
  const [convs, setConvs] = useState<Conv[]>(initialConversations);
  const [active, setActive] = useState<string | null>(initialConversations[0]?.waId || null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState<Img[]>([]);
  const [product, setProduct] = useState<Hit | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [uploading, setUploading] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [tplKey, setTplKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState("");
  const [live, setLive] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadList = async () => {
    const r = await afetch("/api/admin/inbox");
    const j = await r.json().catch(() => ({}));
    if (r.ok) setConvs(j.conversations || []);
  };
  const loadThread = async (wa: string) => {
    const r = await afetch("/api/admin/inbox?wa=" + encodeURIComponent(wa));
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMessages(j.rows || []); setOrders(j.orders || []); }
  };
  const loadOrderCtx = async (wa: string, event = "") => {
    const r = await afetch(`/api/admin/whatsapp/order?wa=${encodeURIComponent(wa)}${event ? `&event=${event}` : ""}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { setCtx(null); return; }
    setCtx(j);
    if (event) { setText(j.preview); setImages((j.images || []).map((u: string) => ({ url: u }))); }
  };

  useEffect(() => { if (active) { loadThread(active); loadOrderCtx(active); setTplKey(""); } }, [active]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { loadList(); if (active) loadThread(active); }, 20000);
    return () => clearInterval(t);
  }, [live, active]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  useEffect(() => {
    if (!picking) return;
    const t = setTimeout(async () => {
      const r = await afetch(`/api/admin/whatsapp/preview?q=${encodeURIComponent(q)}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok) setHits(j.products || []);
    }, 220);
    return () => clearTimeout(t);
  }, [q, picking]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setMsg(null);
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    const r = await afetch("/api/admin/whatsapp/media", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setUploading(false);
    if (!r.ok || !j.ok) { setMsg({ ok: false, text: j.error || "Upload failed" }); return; }
    setImages((cur) => [...cur, ...(j.images || []).map((i: any) => ({ url: i.url, text: i.text }))].slice(0, 10));
    setMsg({ ok: true, text: (j.images || []).map((i: any) => i.text).join(" · ") });
    if (fileRef.current) fileRef.current.value = "";
  };

  const pickTemplate = async (key: string) => {
    if (!active) return;
    setTplKey(key);
    await loadOrderCtx(active, key);
    setMsg({ ok: true, text: `Template "${key}" preview bosano holo — pathate "Send" chapun.` });
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || (!text.trim() && !images.length)) return;
    setBusy(true); setMsg(null);
    let r: Response;
    if (tplKey && ctx) {
      r = await afetch("/api/admin/whatsapp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: ctx.order.id, templateKey: tplKey, to: active, images: images.map((i) => i.url), immediate: true }),
      });
    } else {
      r = await afetch("/api/admin/inbox", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: active, body: text, images: images.map((i) => i.url), productId: product?.id || null, couponCode, includeStopLine: stopLine }),
      });
    }
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.ok === false) { setMsg({ ok: false, text: j.error || "Send failed" }); return; }
    setText(""); setImages([]); setProduct(null); setTplKey("");
    setMsg({ ok: true, text: j.sent === false ? "Queue te gelo — worker pathabe ✓" : "Sent ✓" });
    loadThread(active); loadList();
  };

  const link = async () => {
    if (!active) return;
    const code = prompt("Order code din (ORD-1042):");
    if (!code) return;
    const r = await afetch("/api/admin/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "link", wa: active, orderCode: code }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ text: j.error || "Link failed", ok: false }); return; }
    setMsg({ text: `Linked to ${j.order.code} ✓`, ok: true });
    loadThread(active); loadList(); loadOrderCtx(active);
  };

  const shown = convs.filter((c) => !filter || (c.waId + " " + (c.name || "") + " " + (c.order?.code || "")).toLowerCase().includes(filter.toLowerCase()));
  const cur = convs.find((c) => c.waId === active);
  const local = (wa: string) => (wa.startsWith("880") ? "0" + wa.slice(3) : wa);

  return (
    <>
      {!status.connected && (
        <div className="noti err" style={{ marginBottom: 14 }}>
          {status.running
            ? "Bridge chalche kintu WhatsApp linked na — Devices page the QR scan korun. Ekhon reply pathate gele fail korbe."
            : "Bridge service off — server-e `npm run wa` chalan (WA_BRIDGE_PORT 3001 dev server-e busy thakle onno port din)."}
        </div>
      )}

      <div className="wa-wrap">
        <div className="acard wa-list">
          <div className="acard-h"><h3>Conversations</h3><label style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> live
          </label></div>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search number / order…" style={{ width: "100%", padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
          </div>
          <div className="wa-list-body">
            {shown.length === 0 ? <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>Kono conversation nei. Customer message pathale ekhane ashbe.</div> : shown.map((c) => (
              <button key={c.waId} className={"wa-conv" + (c.waId === active ? " on" : "")} onClick={() => setActive(c.waId)}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <b style={{ fontSize: 13, flex: 1, textAlign: "left" }}>{c.name || local(c.waId)}</b>
                  <span style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(c.lastAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "left" }}>{local(c.waId)}{c.order ? ` · ${c.order.code}` : ""}</div>
                <div className="wa-conv-last" style={{ color: c.lastDirection === "OUT" ? "var(--muted)" : undefined }}>
                  {c.lastDirection === "OUT" ? "You: " : ""}{c.last}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="acard wa-thread">
          {!active ? <div style={{ padding: 20, color: "var(--muted)" }}>Ekta conversation select korun.</div> : (
            <>
              <div className="acard-h">
                <h3>{cur?.name || local(active)}</h3>
                <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
                  {cur?.order ? <a href={`/admin/orders/${cur.order.id}`}>{cur.order.code} · {cur.order.status}</a> : <button className="abtn sm" onClick={link}>Link order</button>}
                  <a className="abtn sm" href={`/admin/whatsapp/compose?to=${active}`}>Full composer</a>
                  <a className="abtn sm" href={`https://wa.me/${active}`} target="_blank" rel="noreferrer">Open in WhatsApp</a>
                </span>
              </div>

              {ctx && (
                <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--ad-line-soft)" }}>
                  <div style={{ fontSize: 12.5, marginBottom: 6 }}>
                    <b>Order {ctx.order.code}</b> · {ctx.order.status} · {money(ctx.order.total)} ·{" "}
                    {ctx.order.items.map((i) => `${i.title} ×${i.qty}`).join(", ").slice(0, 90)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Order update:</span>
                    {ctx.events.map((e) => (
                      <button key={e.key} type="button" className={"abtn sm" + (tplKey === e.key ? " primary" : "")} onClick={() => pickTemplate(e.key)} title={e.enabled ? "automatic" : "template OFF"}>
                        {e.name}{e.mediaMode !== "NONE" ? " 📷" : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="wa-thread-body">
                {messages.map((m) => (
                  <div key={m.id} className={"wa-msg " + (m.direction === "OUT" ? "out" : "in")} title={new Date(m.createdAt).toLocaleString("en-GB")}>
                    {m.body}
                    {m.status === "failed" && <div style={{ fontSize: 10.5, color: "var(--danger)" }}>send failed</div>}
                  </div>
                ))}
                {messages.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>Ei thread e kono message nei.</div>}
                <div ref={endRef} />
              </div>

              <form className="wa-reply" onSubmit={send}>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={status.connected ? "Reply likhun…" : "Bridge off — reply pathate parbena"} />
                <button className="abtn primary" type="submit" disabled={busy || (!text.trim() && !images.length)}>{busy ? "…" : "Send"}</button>
              </form>

              {/* attachments */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "0 12px" }}>
                <button type="button" className="abtn sm" onClick={() => fileRef.current?.click()} disabled={uploading || images.length >= 10}>
                  {uploading ? "Compressing…" : `📷 Photo (${images.length}/10)`}
                </button>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
                <button type="button" className="abtn sm" onClick={() => setPicking((v) => !v)}>{product ? `Product: ${product.title.slice(0, 22)}` : "Product card"}</button>
                {product && <button type="button" className="abtn sm" onClick={() => setProduct(null)}>×</button>}
                {tplKey && <button type="button" className="abtn sm" onClick={() => { setTplKey(""); setText(""); setImages([]); }}>Template {tplKey} ✕</button>}
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{couponCode ? `coupon ${couponCode} jabe` : "coupon set nei"}</span>
              </div>

              {picking && (
                <div style={{ padding: "10px 12px", borderTop: "1px solid var(--line)" }}>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product search (name / SKU)…" autoFocus style={{ width: "100%", padding: "8px 10px", border: "1px solid #d0d5dd", borderRadius: 5 }} />
                  <div className="wa2-pick" style={{ marginTop: 6 }}>
                    {hits.map((h) => (
                      <button key={h.id} type="button" className="wa2-pick-row" onClick={() => { setProduct(h); setPicking(false); if (!images.length && h.image) setImages([{ url: h.image }]); }}>
                        {h.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={h.image} alt="" /> : <span className="wa2-pick-noimg" />}
                        <span style={{ flex: 1, textAlign: "left" }}>
                          <b style={{ fontSize: 12.5 }}>{h.title}</b>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{money(h.price)} · stock {h.stock}</div>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {images.length > 0 && (
                <div className="wa2-thumbs" style={{ padding: "10px 12px 0" }}>
                  {images.map((im) => (
                    <div key={im.url} className="wa2-thumb" title={im.text || im.url}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.url} alt="" />
                      <button type="button" onClick={() => setImages((c) => c.filter((x) => x.url !== im.url))} aria-label="remove">×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="wa-quick">
                {quick.slice(0, 8).map((t) => <button key={t} className="abtn sm" onClick={() => setText((v) => (v ? v + "\n\n" + t : t))} type="button">{t.slice(0, 26)}…</button>)}
              </div>

              {(msg || autoReply) && (
                <div className={"noti " + (msg ? (msg.ok ? "ok" : "err") : "")} style={{ margin: "8px 12px 12px" }}>
                  {msg ? msg.text : `Auto-reply on: “${autoReply.slice(0, 80)}”`}
                </div>
              )}
              {orders.length > 0 && (
                <div style={{ padding: "0 12px 12px", fontSize: 12, color: "var(--muted)" }}>
                  Ei number er order: {orders.map((o) => <a key={o.id} href={`/admin/orders/${o.id}`} style={{ marginRight: 8 }}>{o.code}</a>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
