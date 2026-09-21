"use client";
import { afetch } from "@/lib/afetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type Post = {
  id: number; title: string; slug: string; excerpt: string | null; content: string;
  image: string | null; published: boolean; createdAt: string; updatedAt: string;
};

const EMPTY = { id: 0, title: "", slug: "", excerpt: "", content: "", image: "", published: false };

/* Blog editor. The content box takes plain text: a blank line starts a new paragraph, lines
   starting with "## " become headings. That keeps the stored content free of trusted HTML (so
   nothing a writer types can inject script into the public page) while still reading properly. */
export default function BlogEditor({ posts }: { posts: Post[] }) {
  const router = useRouter();
  const [e, setE] = useState<typeof EMPTY>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);

  const set = (k: string, v: any) => setE((p) => ({ ...p, [k]: v }));
  const startNew = () => { setE(EMPTY); setEditing(true); setMsg(null); };
  const startEdit = (p: Post) => {
    setE({ id: p.id, title: p.title, slug: p.slug, excerpt: p.excerpt || "", content: p.content, image: p.image || "", published: p.published });
    setEditing(true); setMsg(null);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 20);
  };

  const upload = async (file: File) => {
    setUploading(true); setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await afetch("/api/admin/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setUploading(false);
    if (!r.ok || !j.url) { setMsg({ text: j.error || "Upload failed", ok: false }); return; }
    set("image", j.url);
  };

  const save = async (publish?: boolean) => {
    if (!e.title.trim()) { setMsg({ text: "Give the post a title", ok: false }); return; }
    if (!e.content.trim()) { setMsg({ text: "The post has no content yet", ok: false }); return; }
    setBusy(true); setMsg(null);
    const body: any = { title: e.title, slug: e.slug, excerpt: e.excerpt, content: e.content, image: e.image, published: publish !== undefined ? publish : e.published };
    const r = e.id
      ? await afetch(`/api/admin/blog/${e.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await afetch("/api/admin/blog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !j.ok) { setMsg({ text: j.error || "Could not save", ok: false }); return; }
    setE((p) => ({ ...p, id: j.post.id, slug: j.post.slug, published: j.post.published }));
    setMsg({ text: j.post.published ? `Saved and live at /blog/${j.post.slug}` : "Saved as a draft", ok: true });
    router.refresh();
  };

  const del = async (p: Post) => {
    if (!confirm(`Delete "${p.title}"? The page /blog/${p.slug} will stop working.`)) return;
    setBusy(true);
    const r = await afetch(`/api/admin/blog/${p.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) { setMsg({ text: "Could not delete", ok: false }); return; }
    if (e.id === p.id) { setE(EMPTY); setEditing(false); }
    router.refresh();
  };

  const words = e.content.trim() ? e.content.trim().split(/\s+/).length : 0;

  return (
    <>
      {!editing && (
        <div style={{ marginBottom: 14 }}>
          <button className="abtn primary" onClick={startNew}>+ New post</button>
        </div>
      )}

      {editing && (
        <div className="acard" style={{ marginBottom: 18 }}>
          <div className="acard-h">
            <h3>{e.id ? "Edit post" : "New post"}</h3>
            <button className="abtn sm" onClick={() => { setEditing(false); setMsg(null); }}>Close</button>
          </div>
          <div className="acard-b form-grid">
            <div className="af" style={{ gridColumn: "1 / -1" }}>
              <label>Title (this is the page headline and the Google title)</label>
              <input value={e.title} onChange={(ev) => set("title", ev.target.value)} placeholder="e.g. How to pick the right winter jacket size" />
            </div>
            <div className="af">
              <label>URL slug</label>
              <input value={e.slug} onChange={(ev) => set("slug", ev.target.value)} placeholder="auto from the title" />
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>/blog/{e.slug || "your-title-here"}</div>
            </div>
            <div className="af">
              <label>Cover image</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {e.image ? <img src={e.image} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 4, border: "1px solid var(--line)" }} /> : null}
                <label className="abtn sm" style={{ cursor: "pointer" }}>
                  {uploading ? "Uploading…" : e.image ? "Replace" : "Upload"}
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(ev) => { const f = ev.target.files?.[0]; if (f) upload(f); }} />
                </label>
                {e.image && <button className="abtn sm" onClick={() => set("image", "")}>Remove</button>}
              </div>
            </div>
            <div className="af" style={{ gridColumn: "1 / -1" }}>
              <label>Short summary (shown in the list and in Google / WhatsApp previews, {e.excerpt.length}/300)</label>
              <input value={e.excerpt} maxLength={300} onChange={(ev) => set("excerpt", ev.target.value)} placeholder="One or two lines about what the reader gets." />
            </div>
            <div className="af" style={{ gridColumn: "1 / -1" }}>
              <label>Content — blank line = new paragraph, a line starting with ## becomes a heading</label>
              <textarea value={e.content} onChange={(ev) => set("content", ev.target.value)} rows={14} style={{ fontFamily: "inherit", lineHeight: 1.65 }} placeholder={"Size charts lie.\n\n## Measure before you order\n\nWrap a tape around your chest and match it to the chart."} />
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{words} words · about {Math.max(1, Math.round(words / 200))} min read</div>
            </div>
            <div className="full" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="abtn primary" disabled={busy} aria-busy={busy || undefined} onClick={() => save(true)}>
                {busy && <span className="spinner" aria-hidden="true" />} {busy ? "Saving…" : e.published ? "Save" : "Publish"}
              </button>
              {e.published && <button className="abtn" disabled={busy} onClick={() => save(false)}>Unpublish</button>}
              {!e.published && <button className="abtn" disabled={busy} onClick={() => save(false)}>Save as draft</button>}
              {e.id > 0 && <a className="abtn" href={`/blog/${e.slug}?preview=1`} target="_blank" rel="noreferrer">View on site</a>}
              {msg && <span style={{ fontSize: 12.5, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</span>}
            </div>
          </div>
        </div>
      )}

      <div className="acard">
        <div className="acard-h"><h3>Posts</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>{posts.length} total · {posts.filter((p) => p.published).length} live</span></div>
        <div className="acard-b" style={{ overflowX: "auto" }}>
          {posts.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>No posts yet. Write one — a buying guide or a size/how-to piece brings search traffic that a product page can&apos;t.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Title</th><th>Status</th><th>Updated</th><th></th></tr></thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 380 }}>
                      <b>{p.title}</b>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>/blog/{p.slug}</div>
                    </td>
                    <td>
                      {/* .pill variants are keyed by status name, so reuse ACTIVE / DRAFT */}
                      <span className={"pill " + (p.published ? "ACTIVE" : "DRAFT")}>{p.published ? "LIVE" : "DRAFT"}</span>
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(p.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="abtn sm" onClick={() => startEdit(p)}>Edit</button>{" "}
                      {p.published && <a className="abtn sm" href={`/blog/${p.slug}`} target="_blank" rel="noreferrer">Open</a>}{" "}
                      <button className="abtn sm" onClick={() => del(p)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
