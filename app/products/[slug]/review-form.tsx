"use client";
import { useState } from "react";
import { toast } from "@/components/store";

export default function ReviewForm({ productId }: { productId: number }) {
  const [rating, setRating] = useState(5);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (done) return <div className="noti ok" style={{ maxWidth: 520 }}>Thank you! Your review is pending moderation and will appear shortly.</div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, rating, name, phone, text }) });
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
      <button className="btn" style={{ justifySelf: "start" }} disabled={busy} type="submit">{busy ? "Submitting…" : "Submit Review"}</button>
    </form>
  );
}
