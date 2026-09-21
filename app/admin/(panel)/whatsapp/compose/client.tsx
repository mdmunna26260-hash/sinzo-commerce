"use client";
import { afetch } from "@/lib/afetch";
import { useCallback, useEffect, useRef, useState } from "react";

/* Message composer — the Phase 2 toolkit in one screen:
     • free text (with a live WhatsApp-style preview)
     • up to 10 photos, compressed server-side on upload
     • a product card (photo + name + price + link) picked from the catalogue
     • the shop's coupon code + the STOP line
     • order mode: pick any automatic event for a real order and send it as-is
   Everything is composed by the server (the same function the worker uses), so the bubble on the
   right is literally the message — no second implementation to drift. */

type Hit = { id: number; title: string; slug: string; price: number; comparePrice: number | null; stock: number; status: string; image: string | null };
type Img = { url: string; text?: string };
type Ev = { key: string; name: string; enabled: boolean; mediaMode: string; body: string };
type Ctx = {
  order: {
    id: number; code: string; name: string; status: string; phone: string; waId: string; total: number; paymentMethod: string;
    area: string; address: string; couponCode: string | null; createdAt: string; courierConsignmentId: string | null;
    items: { title: string; qty: number; price: number; slug: string | null; image: string | null }[];
  };
  events: Ev[]; suggestedEvent: string; preview: string; images: string[];
  recent: { id: number; templateKey: string | null; status: string; sentAt: string | null }[];
};

const money = (n: number) => "৳" + Math.round(n || 0).toLocaleString("en-IN");
const pretty = (wa: string) => (wa || "").replace(/^880/, "0").replace(/\D/g, "");
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function ComposeClient({ quick, rules, initialTo, orderCode, waConnected, bridgeRunning }: {
  quick: string[];
  rules: { couponCode: string; stopLine: boolean; testMode: boolean; testNumber: string; enabled: boolean };
  initialTo: string; orderCode: string; waConnected: boolean; bridgeRunning: boolean;
}) {
  const [to, setTo] = useState(initialTo);
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState("");
  const [images, setImages] = useState<Img[]>([]);
  const [product, setProduct] = useState<Hit | null>(null);
  const [coupon, setCoupon] = useState(rules.couponCode || "");
  const [stopLine, setStopLine] = useState(rules.stopLine);
  const [chars, setChars] = useState(0);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [event, setEvent] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── order mode ────────────────────────────────────────────────────────────── */
  const loadOrder = useCallback(async (key: string) => {
    const r = await afetch(`/api/admin/whatsapp/order?code=${encodeURIComponent(orderCode)}${key ? `&event=${key}` : ""}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { setMsg({ ok: false, text: j.error || "Order load hoy ni" }); return; }
    setCtx(j);
    setEvent(j.suggestedEvent);
    if (j.suggestedEvent) setBody(j.preview);
    setImages((j.images || []).map((u: string) => ({ url: u })));
    setTo(j.order.waId);
  }, [orderCode]);
  useEffect(() => { if (orderCode) loadOrder(""); }, [orderCode, loadOrder]);
  const switchEvent = async (key: string) => { setEvent(key); setBusy(false); setMsg(null); await loadOrder(key); };

  /* ── live preview (server-rendered, debounced) ─────────────────────────────── */
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await afetch("/api/admin/whatsapp/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, productId: product?.id || null, couponCode: coupon, includeStopLine: stopLine }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { setPreview(j.body); setChars(j.chars); }
      else { setPreview(body); setChars(body.length); }
    }, 250);
    return () => clearTimeout(t);
  }, [body, product, coupon, stopLine]);

  /* ── product picker ───────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!picking) return;
    const t = setTimeout(async () => {
      const r = await afetch(`/api/admin/whatsapp/preview?q=${encodeURIComponent(q)}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok) setHits(j.products || []);
    }, 220);
    return () => clearTimeout(t);
  }, [q, picking]);

  const pickProduct = (h: Hit) => {
    setProduct(h);
    setPicking(false);
    if (!images.length && h.image) setImages([{ url: h.image }]);
    setMsg({ ok: true, text: `Product card attach holo: ${h.title}` });
  };

  /* ── uploads (server compresses) ───────────────────────────────────────────── */
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setUploadNote(""); setMsg(null);
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    const r = await afetch("/api/admin/whatsapp/media", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setUploading(false);
    if (!r.ok || !j.ok) { setMsg({ ok: false, text: j.error || "Upload failed" }); return; }
    const added: Img[] = (j.images || []).map((i: any) => ({ url: i.url, text: i.text }));
    setImages((cur) => [...cur, ...added].slice(0, 10));
    setUploadNote(added.map((a) => a.text).filter(Boolean).join(" · "));
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeImage = async (url: string) => {
    setImages((cur) => cur.filter((i) => i.url !== url));
    if (url.startsWith("/uploads/wa/")) afetch(`/api/admin/whatsapp/media?url=${encodeURIComponent(url)}`, { method: "DELETE" }).catch(() => {});
  };

  /* ── send ─────────────────────────────────────────────────────────────────── */
  const send = async () => {
    setBusy(true); setMsg(null);
    const payload = ctx
      ? { orderId: ctx.order.id, templateKey: event, to, images: images.map((i) => i.url) }
      : { to, body, images: images.map((i) => i.url), productId: product?.id || null, couponCode: coupon, includeStopLine: stopLine };
    const r = await afetch("/api/admin/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !j.ok) { setMsg({ ok: false, text: j.error || "Pathate parlam na" }); return; }
    setMsg({
      ok: true,
      text: `${j.message}${j.tick?.notes?.length ? " · " + j.tick.notes.join("; ") : ""}${j.images?.length ? ` · ${j.images.length} photo` : ""}`,
    });
    if (ctx) await loadOrder(event);
  };

  const reset = () => { setBody(""); setImages([]); setProduct(null); setMsg(null); setCtx(null); setEvent(""); setUploadNote(""); };

  return (
    <>
      {!waConnected && (
        <div className="noti err" style={{ marginBottom: 14 }}>
          {bridgeRunning
            ? "Bridge chalche kintu kono number connected na — message queue-te jabe, worker device pele pathabe."
            : "Bridge service off — `npm run wa` chara message jabe na (queue-te thakbe, hariye jabe na)."}
        </div>
      )}
      {rules.testMode && (
        <div className="noti" style={{ marginBottom: 14, background: "#fff7e6", borderColor: "#e8c98a" }}>
          <b>Test mode ON</b> — shob message {rules.testNumber ? pretty(rules.testNumber) : "(test number set korun)"} e jabe, customer kichu pabena.
        </div>
      )}

      <div className="wa2-grid">
        {/* ── left: the form ─────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gap: 16 }}>
          {ctx && (
            <div className="acard">
              <div className="acard-h">
                <h3>Order {ctx.order.code} · {ctx.order.status}</h3>
                <a className="abtn sm" href={`/admin/orders/${ctx.order.id}`}>Order kholun</a>
              </div>
              <div className="acard-b" style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 13 }}>
                  <b>{ctx.order.name}</b> · {pretty(ctx.order.waId)} · {ctx.order.area === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"} ·{" "}
                  {money(ctx.order.total)} ({ctx.order.paymentMethod})
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {ctx.order.items.map((i) => `${i.title} ×${i.qty}`).join(" · ")}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Kon update ta pathaben? (template theke ready)</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {ctx.events.map((e) => (
                      <button key={e.key} type="button" className={"abtn sm" + (e.key === event ? " primary" : "")} onClick={() => switchEvent(e.key)}>
                        {e.name}{e.mediaMode === "PRODUCT" ? " 📷" : e.mediaMode === "ORDER_ITEMS" ? " 📷📷" : ""}{!e.enabled ? " (off)" : ""}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                    Template OFF thakle automatic pathabe na, kintu ekhane theke pathate parben.
                    {ctx.recent?.length ? ` · last: ${ctx.recent.map((r) => `${r.templateKey || "manual"} ${when(r.sentAt)}`).join(", ")}` : ""}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="acard">
            <div className="acard-h">
              <h3>{ctx ? "Message" : "Write a message"}</h3>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{chars}/4000 · {Math.max(1, Math.ceil(chars / 1000))} part</span>
            </div>
            <div className="acard-b" style={{ display: "grid", gap: 12 }}>
              <div className="form-grid">
                <div className="af">
                  <label>Recipient number</label>
                  <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="01712 345678" inputMode="tel" disabled={!!ctx} />
                </div>
                <div className="af">
                  <label>Coupon code (optional)</label>
                  <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="SAVE100 — khali rakhle line jabe na" disabled={!!ctx} />
                </div>
              </div>

              <div className="af">
                <label>Message</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  placeholder={"Hi Rakib! 🛒\n\nApnar jonno notun collection ashche…"}
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #d0d5dd", borderRadius: 6, font: "inherit", lineHeight: 1.55, resize: "vertical" }}
                />
              </div>

              {!ctx && (
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Quick replies (Settings → Hub-e edit korun)</div>
                  <div className="wa-quick" style={{ padding: 0 }}>
                    {quick.map((t) => (
                      <button key={t} type="button" className="abtn sm" onClick={() => { setBody((b) => (b ? b + "\n\n" + t : t)); }}>{t.slice(0, 34)}{t.length > 34 ? "…" : ""}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* photos */}
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" className="abtn sm" onClick={() => fileRef.current?.click()} disabled={uploading || images.length >= 10}>
                    {uploading ? "Compressing…" : `📷 Photo add (${images.length}/10)`}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Upload-er shomoy-i compress hoy — max 1600px, ~950KB er niche.</span>
                </div>
                {uploadNote && <div style={{ fontSize: 11.5, color: "var(--ad-green, #067647)", marginTop: 6 }}>{uploadNote}</div>}
                {images.length > 0 && (
                  <div className="wa2-thumbs" style={{ marginTop: 8 }}>
                    {images.map((im, i) => (
                      <div key={im.url} className="wa2-thumb" title={im.text || im.url}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={im.url} alt={`attachment ${i + 1}`} />
                        <button type="button" onClick={() => removeImage(im.url)} aria-label="remove">×</button>
                        {i === 0 && <span className="wa2-thumb-tag">caption</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* product card */}
              {!ctx && (
                <div className="acard" style={{ boxShadow: "none" }}>
                  <div className="acard-h" style={{ padding: "12px 14px" }}>
                    <h3 style={{ fontSize: 13.5 }}>Product card</h3>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="abtn sm" onClick={() => setPicking((v) => !v)}>{picking ? "Close" : "Pick product"}</button>
                      {product && <button type="button" className="abtn sm" onClick={() => setProduct(null)}>Remove</button>}
                    </div>
                  </div>
                  {picking && (
                    <div className="acard-b" style={{ display: "grid", gap: 8, padding: 14 }}>
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product (name / SKU)…" autoFocus
                        style={{ padding: "9px 12px", border: "1px solid #d0d5dd", borderRadius: 6, font: "inherit" }} />
                      <div className="wa2-pick">
                        {hits.map((h) => (
                          <button key={h.id} type="button" className="wa2-pick-row" onClick={() => pickProduct(h)}>
                            {h.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={h.image} alt="" /> : <span className="wa2-pick-noimg">—</span>}
                            <span style={{ flex: 1, textAlign: "left" }}>
                              <b style={{ fontSize: 13 }}>{h.title}</b>
                              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{money(h.price)} · stock {h.stock}{h.status !== "ACTIVE" ? ` · ${h.status}` : ""}</div>
                            </span>
                          </button>
                        ))}
                        {!hits.length && <div style={{ fontSize: 12.5, color: "var(--muted)", padding: 8 }}>Kichu paoa gelo na.</div>}
                      </div>
                    </div>
                  )}
                  {product && (
                    <div className="acard-b" style={{ padding: 14, fontSize: 12.5, color: "var(--muted)" }}>
                      Attached: <b style={{ color: "inherit" }}>{product.title}</b> — card e name, price, sale price ar link jabe.
                    </div>
                  )}
                </div>
              )}

              {!ctx && (
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" checked={stopLine} onChange={(e) => setStopLine(e.target.checked)} />
                  Sheshe &ldquo;Offer bondho korte STOP likhun&rdquo; line din
                </label>
              )}

              {msg && <div className={"noti " + (msg.ok ? "ok" : "err")} style={{ margin: 0 }}>{msg.text}</div>}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="abtn primary" onClick={send} disabled={busy || !to.trim() || (!ctx && !body.trim())}>
                  {busy ? "Pathacchi…" : ctx ? `Send "${ctx.events.find((e) => e.key === event)?.name || event}"` : "Send now"}
                </button>
                <button className="abtn" onClick={reset} disabled={busy}>Clear</button>
                {to.trim() && <a className="abtn" href={`/admin/inbox?wa=${pretty(to)}`}>Inbox-e dekhun</a>}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                Send korle message outbox-e jay ar worker sathe sathe ek tick chalay. Daily cap / quiet hours / device choice
                ei niyom gulo ekhano kaj kore — tai kichu message &ldquo;queue te ache&rdquo; dekhatе pare.
              </div>
            </div>
          </div>
        </div>

        {/* ── right: what the customer actually reads ────────────────────────── */}
        <div className="acard" style={{ position: "sticky", top: 12 }}>
          <div className="acard-h"><h3>Preview</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{ctx ? "server-rendered" : "live"}</span></div>
          <div className="acard-b">
            <div className="wa2-phone">
              <div className="wa2-bubble">
                {images.length > 0 && (
                  <div className="wa2-bubble-imgs">
                    {images.slice(0, 4).map((im) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={im.url} src={im.url} alt="" />
                    ))}
                    {images.length > 4 && <span className="wa2-more">+{images.length - 4}</span>}
                  </div>
                )}
                <div className="wa2-text">{ctx ? body : preview || "…"}</div>
                <div className="wa2-time">now ✓✓</div>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10 }}>
              {product ? "Product card + " : ""}{images.length} photo · {chars} character. {stopLine ? "STOP line ache." : ""}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
