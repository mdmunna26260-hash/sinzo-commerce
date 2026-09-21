"use client";
import { afetch } from "@/lib/afetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Row = { id: number; level: string; kind: string; message: string; meta: string | null; createdAt: string };

const LEVEL_PILL: Record<string, string> = { ERROR: "CANCELLED", WARN: "PROCESSING", INFO: "DELIVERED" };

/* The list itself: newest first, expandable details, and the two retention buttons. */
export default function LogsClient({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const clear = async (scope: string, days?: number, id?: number) => {
    if (scope === "all" && !confirm("Delete EVERY log entry? This cannot be undone.")) return;
    setBusy(scope + (id || "")); setMsg("");
    const url = `/api/admin/logs?scope=${scope}${days ? "&days=" + days : ""}${id ? "&id=" + id : ""}`;
    const r = await afetch(url, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    setMsg(r.ok ? `Removed ${j.removed ?? 1} entr${(j.removed ?? 1) === 1 ? "y" : "ies"} ✓` : (j.error || "Failed"));
    router.refresh();
  };

  if (!rows.length) return <div style={{ color: "var(--muted)" }}>No log entries for this filter. (Good news, usually.)</div>;

  return (
    <>
      <table className="tbl">
        <thead><tr><th>When</th><th>Level</th><th>Kind</th><th>Message</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
              <td><span className={"pill " + (LEVEL_PILL[r.level] || "DRAFT")}>{r.level}</span></td>
              <td style={{ fontSize: 12.5 }}>{r.kind}</td>
              <td style={{ fontSize: 13, maxWidth: 520, wordBreak: "break-word" }}>
                {r.message}
                {r.meta && (
                  <details style={{ color: "var(--muted)", fontSize: 12 }} open={open === r.id} onClick={(e) => { e.preventDefault(); setOpen(open === r.id ? null : r.id); }}>
                    <summary style={{ cursor: "pointer" }}>details</summary>
                    <code style={{ fontSize: 11.5, wordBreak: "break-all", display: "block", whiteSpace: "pre-wrap" }}>{r.meta}</code>
                  </details>
                )}
              </td>
              <td><button className="abtn sm" disabled={busy === "id" + r.id} onClick={() => clear("id", undefined, r.id)} title="Delete this entry">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button className="abtn" disabled={!!busy} onClick={() => clear("old", 30)}>{busy === "old" ? "…" : "Clear older than 30 days"}</button>
        <button className="abtn" disabled={!!busy} onClick={() => clear("old", 7)}>{busy === "old" ? "…" : "Clear older than 7 days"}</button>
        <button className="abtn" disabled={!!busy} onClick={() => clear("all")}>{busy === "all" ? "…" : "Clear everything"}</button>
        {msg && <span style={{ fontSize: 12.5, color: "var(--ok)" }}>{msg}</span>}
      </div>
    </>
  );
}
