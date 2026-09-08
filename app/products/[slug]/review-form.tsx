"use client";
import { useState } from "react";
import { toast } from "@/components/store";

export default function ReviewForm({ productId }: { productId: number }) {
  const [rating, setRating] = useState(5);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [upBusy, setUpBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (done) return <div className="noti ok" style={{ maxWidth: 520 }}>Thank you! Your review is pending moderation and will appear shortly.</div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, rating, name, phone, text, photos }) });
      const j = await r.json();
      if (r.ok) { setDone(true); } else { toast(j.error || "Could not submit review"); }
    } catch { toast("Network error"); }
    setBusy(false);
  };

  return (
    <form className="review-form" onSubmit={submit}>
      <h3 style={{ fontSize: 18 }}>Write a review</h3>
      <div className="stars-pick" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= rating ? "on" : ""} onClick={() => setRating(n)}>{n <= rating ? "★" : "☆"}</span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <input required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Phone (for verified purchase)" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <textarea required placeholder="Share your experience…" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 90 }} />
      <div>
        <label style={{ fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 6 }}>Add photos (optional, max 3)</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {photos.map((u) => (
            <div key={u} style={{ position: "relative" }}>
              <img src={u} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
              <button type="button" onClick={() => setPhotos((p) => p.filter((x) => x !== u))} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 99, border: "none", background: "#b3392f", color: "#fff", fontSize: 10, cursor: "pointer" }}>✕</button>
            </div>
          ))}
          {photos.length < 3 && (
            <label style={{ width: 54, height: 54, borderRadius: 6, border: "1px dashed var(--line)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, color: "var(--muted)" }}>
              {upBusy ? "…" : "+"}
              <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUpBusy(true);
                try {
                  const fd = new FormData(); fd.append("file", f);
                  const r = await fetch("/api/reviews/upload", { method: "POST", body: fd });
                  const j = await r.json();
                  if (j.url) setPhotos((p) => [...p, j.url]); else toast(j.error || "Upload failed");
                } catch { toast("Upload failed"); }
                setUpBusy(false);
              }} />
            </label>
          )}
        </div>
      </div>
      <button className="btn" style={{ justifySelf: "start" }} disabled={busy} type="submit">{busy ? "Submitting…" : "Submit Review"}</button>
    </form>
  );
}
