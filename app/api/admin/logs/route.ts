import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { APP_LOG_KINDS, APP_LOG_LEVELS, logApp } from "@/lib/logs";

export const dynamic = "force-dynamic";

/* App log viewer (admin menu item 12) — the place to look when something broke at 2am:
   browser crashes, SMS/WhatsApp failures, courier webhooks, cron and backup runs. */

export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const level = (sp.get("level") || "").toUpperCase();
  const kind = (sp.get("kind") || "").toUpperCase();
  const q = (sp.get("q") || "").trim().slice(0, 120);
  const days = Math.min(365, Math.max(1, Number(sp.get("days") || 7)));
  const limit = Math.min(500, Math.max(10, Number(sp.get("limit") || 100)));
  const since = new Date(Date.now() - days * 86400_000);

  const where: any = { createdAt: { gte: since } };
  if (APP_LOG_LEVELS.includes(level as any)) where.level = level;
  if (APP_LOG_KINDS.includes(kind as any)) where.kind = kind;
  if (q) where.OR = [{ message: { contains: q } }, { meta: { contains: q } }];

  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const rows = await db.appLog.findMany({ where, orderBy: { id: "desc" }, take: limit });
  const [errors24, warns24, total] = await Promise.all([
    db.appLog.count({ where: { level: "ERROR", createdAt: { gte: new Date(Date.now() - 86400_000) } } }),
    db.appLog.count({ where: { level: "WARN", createdAt: { gte: new Date(Date.now() - 86400_000) } } }),
    db.appLog.count(),
  ]);
  /* Per-kind counters: one count() per log kind. (A findMany/groupBy over the same window comes
     back empty in this runtime, counts are exact and cheap here — there are only a handful.) */
  const kindCounts = await Promise.all(APP_LOG_KINDS.map(async (k) => ({ kind: k, n: await db.appLog.count({ where: { kind: k, createdAt: { gte: since } } }) })));
  return NextResponse.json({ ok: true, rows, counters: { errors24, warns24, total, byKind: kindCounts.filter((k) => k.n > 0).sort((a, b) => b.n - a.n) } });
}

/** Clear what is not worth keeping: one row, everything older than N days, or the lot. */
export async function DELETE(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const id = Number(sp.get("id"));
  if (id) {
    await db.appLog.delete({ where: { id } }).catch(() => {});
    return NextResponse.json({ ok: true, removed: 1 });
  }
  const older = Number(sp.get("olderThanDays"));
  const where = older > 0 ? { createdAt: { lt: new Date(Date.now() - older * 86400_000) } } : {};
  const r = await db.appLog.deleteMany({ where });
  await logApp("INFO", "CRON", `log cleanup: removed ${r.count} row(s)${older ? ` older than ${older} days` : ""}`);
  await logAudit(g.user.email, "LOGS_CLEAR", older ? `older than ${older} days (${r.count})` : `all (${r.count})`);
  return NextResponse.json({ ok: true, removed: r.count });
}
