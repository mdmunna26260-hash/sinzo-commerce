import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import LogsClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Logs" };

type SP = { t?: string; level?: string; kind?: string; q?: string };

/* Log viewer.
   The pieces of this store that talk to the outside world (SMS gateway, WhatsApp bridge, SMTP,
   courier webhooks, browser crash reporter, backups) each used to fail into a server log nobody
   reads. They all write AppLog now, and this is where they show up. */
const KINDS = ["CLIENT", "WEBHOOK", "SMS", "WHATSAPP", "MAIL", "CRON", "BACKUP"];
const KIND_ICON: Record<string, string> = { CLIENT: "💥", WEBHOOK: "🔗", SMS: "📱", WHATSAPP: "🟢", MAIL: "✉️", CRON: "⏰", BACKUP: "💾" };

export default async function LogsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireAdmin(searchParams);
  const t = searchParams.t || "";
  const tk = (p: string) => (t ? p + "&t=" + encodeURIComponent(t) : p);
  const level = (searchParams.level || "").toUpperCase();
  const kind = (searchParams.kind || "").toUpperCase();
  const q = (searchParams.q || "").trim();

  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const where: any = {};
  if (level) where.level = level;
  if (kind) where.kind = kind;
  if (q) where.OR = [{ message: { contains: q } }, { meta: { contains: q } }];

  const dayAgo = new Date(Date.now() - 864e5);
  const [rows, byLevel, byKind, errors24, total] = await Promise.all([
    db.appLog.findMany({ where, orderBy: { id: "desc" }, take: 300 }),
    db.appLog.groupBy({ by: ["level"], _count: { _all: true } }),
    db.appLog.groupBy({ by: ["kind"], _count: { _all: true } }),
    db.appLog.count({ where: { level: "ERROR", createdAt: { gte: dayAgo } } }),
    db.appLog.count(),
  ]);
  const levels = Object.fromEntries(byLevel.map((r) => [r.level, r._count._all]));
  const kinds = Object.fromEntries(byKind.map((r) => [r.kind, r._count._all]));
  const oldest = total ? (await db.appLog.findFirst({ orderBy: { id: "asc" }, select: { createdAt: true } }))?.createdAt : null;

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(t ? { t } : {}), ...(level ? { level } : {}), ...(kind ? { kind } : {}), ...(q ? { q } : {}), ...extra });
    return "?" + p.toString();
  };

  const data = rows.map((r) => ({
    id: r.id, level: r.level, kind: r.kind, message: r.message, meta: r.meta,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <>
      <div className="admin-top">
        <div><h1>Logs</h1><div className="who">{total} entries · {user.name}</div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="abtn" href={tk(`/admin/logs`)}>Reset filters</Link>
          <a className="abtn" href={tk(`/api/admin/export?type=logs&level=${level}&kind=${kind}`)}>CSV</a>
        </div>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="kpi"><div className="k-label">Errors (24h)</div><div className="k-val" style={{ color: errors24 ? "var(--ad-red, #b42318)" : undefined }}>{errors24}</div><div className="k-sub">{errors24 ? "dekhun niche" : "kichu bhenge nei"}</div></div>
        <div className="kpi"><div className="k-label">All errors</div><div className="k-val">{levels.ERROR || 0}</div><div className="k-sub">WARN {levels.WARN || 0}</div></div>
        <div className="kpi"><div className="k-label">SMS / WhatsApp</div><div className="k-val">{kinds.SMS || 0} / {kinds.WHATSAPP || 0}</div><div className="k-sub">gateway activity</div></div>
        <div className="kpi"><div className="k-label">Browser crashes</div><div className="k-val">{kinds.CLIENT || 0}</div><div className="k-sub">client-error reports</div></div>
        <div className="kpi"><div className="k-label">Oldest entry</div><div className="k-val">{oldest ? oldest.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</div><div className="k-sub">retention: keep 30 days</div></div>
      </div>

      <div className="acard">
        <div className="acard-h">
          <h3>Recent activity</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            <Link href={"/admin/logs" + qs({ level: "" })} style={{ color: !level ? "var(--accent)" : "inherit" }}>all levels</Link>
            {" · "}
            {["ERROR", "WARN", "INFO"].map((l) => (
              <span key={l}><Link href={"/admin/logs" + qs({ level: l })} style={{ color: level === l ? "var(--accent)" : "inherit", textDecoration: level === l ? "underline" : "none" }}>{l}</Link>{" · "}</span>
            ))}
            {KINDS.map((k) => (
              <span key={k}><Link href={"/admin/logs" + qs({ kind: kind === k ? "" : k })} style={{ color: kind === k ? "var(--accent)" : "inherit", textDecoration: kind === k ? "underline" : "none" }}>{KIND_ICON[k]} {k}{kinds[k] ? ` ${kinds[k]}` : ""}</Link>{" · "}</span>
            ))}
          </span>
        </div>
        <div className="acard-b">
          <form method="get" action="/admin/logs" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {t && <input type="hidden" name="t" value={t} />}
            {level && <input type="hidden" name="level" value={level} />}
            {kind && <input type="hidden" name="kind" value={kind} />}
            <input name="q" defaultValue={q} placeholder="Search message / details…" className="abtn" style={{ flex: 1, minWidth: 200, textAlign: "left" }} />
            <button className="abtn primary" type="submit">Search</button>
          </form>
          <LogsClient rows={data} />
        </div>
      </div>

      <div className="cfg-note" style={{ marginTop: 16 }}>
        Every integration writes here: SMS gateway replies, WhatsApp bridge sends, SMTP results, courier webhook calls,
        browser crash reports and database backups. Pruning older than 30 days keeps the table small; the
        <b> Clear</b> buttons below the list remove old rows on demand.
      </div>
    </>
  );
}
