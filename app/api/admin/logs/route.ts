import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";

/* App log API: the Logs screen's data + retention actions.
   Client crashes, webhook calls, SMS/WhatsApp/mail results and backup runs all land in AppLog,
   so "something broke last night" is answerable from the admin panel instead of a server shell. */
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const url = new URL(req.url);
  const level = (url.searchParams.get("level") || "").toUpperCase();
  const kind = (url.searchParams.get("kind") || "").toUpperCase();
  const q = (url.searchParams.get("q") || "").trim();
  const take = Math.min(500, Number(url.searchParams.get("take") || 200));
  const since = url.searchParams.get("since") ? new Date(url.searchParams.get("since")!) : null;

  const where: any = {};
  if (level) where.level = level;
  if (kind) where.kind = kind;
  if (since && !isNaN(since.getTime())) where.createdAt = { gte: since };
  if (q) where.OR = [{ message: { contains: q } }, { meta: { contains: q } }];

  const [rows, byLevel, byKind] = await Promise.all([
    db.appLog.findMany({ where, orderBy: { id: "desc" }, take }),
    db.appLog.groupBy({ by: ["level"], _count: { _all: true } }),
    db.appLog.groupBy({ by: ["kind"], _count: { _all: true } }),
  ]);
  return NextResponse.json({
    rows,
    levels: Object.fromEntries(byLevel.map((r) => [r.level, r._count._all])),
    kinds: Object.fromEntries(byKind.map((r) => [r.kind, r._count._all])),
  });
}

export async function DELETE(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "old";
  const days = Number(url.searchParams.get("days") || 30);
  if (scope === "all") {
    const r = await db.appLog.deleteMany({});
    await logAudit(g.user.email, "LOGS_CLEARED", `all (${r.count} rows)`);
    return NextResponse.json({ ok: true, removed: r.count });
  }
  if (scope === "id") {
    const id = Number(url.searchParams.get("id"));
    await db.appLog.delete({ where: { id } }).catch(() => {});
    return NextResponse.json({ ok: true, removed: 1 });
  }
  // keep INFO for the archive window, but drop resolved noise sooner
  const cut = new Date(Date.now() - Math.max(1, days) * 864e5);
  const r = await db.appLog.deleteMany({ where: { createdAt: { lt: cut } } });
  await logAudit(g.user.email, "LOGS_PRUNED", `older than ${days} days (${r.count} rows)`);
  return NextResponse.json({ ok: true, removed: r.count, days });
}
