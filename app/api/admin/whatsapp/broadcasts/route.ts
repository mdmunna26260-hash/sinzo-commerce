import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { runWaTick } from "@/lib/wa-worker";
import { logApp } from "@/lib/logs";
import {
  broadcastList, createBroadcast, startBroadcast, pauseBroadcast, resumeBroadcast,
  deleteBroadcast, duplicateBroadcast, retryFailed, updateBroadcast,
} from "@/lib/wa-broadcast";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Campaign list + lifecycle (Phase 3).
   GET  → every campaign with its counters, plus the KPI strip (active, opt-outs, people reached)
   POST → { action: "create" | "start" | "pause" | "resume" | "delete" | "duplicate" | "retryFailed"
                   | "schedule" | "update" | "tick", id?, ... }
   The panel never sends anything itself: create/start only write rows, and the worker (or the
   "Run now" tick below) does the sending so caps, quiet hours and pacing always apply. */
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const data = await broadcastList(60);
  return NextResponse.json({ ok: true, ...data });
}

export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => ({} as any));
  const action = String(b.action || "").trim();
  const id = Number(b.id) || 0;

  try {
    if (action === "create") {
      const row = await createBroadcast(b, g.user.email);
      await logAudit(g.user.email, "WA_CAMPAIGN_CREATED", `#${row.id} ${row.name}`);
      let started: any = null;
      if (b.startNow) {
        started = await startBroadcast(row.id);
        await logAudit(g.user.email, "WA_CAMPAIGN_STARTED", `#${row.id} ${row.name} → ${started.total} recipient(s)`);
      }
      // one tick so the owner immediately sees the first messages leave (capped, quiet-hours aware)
      const tick = started ? await runWaTick({ limit: 3, force: true }).catch(() => null) : null;
      return NextResponse.json({ ok: true, broadcast: started || row, tick });
    }

    if (action === "tick") {
      // "run the worker now" — any screen can ask for it, no campaign required
      const tick = await runWaTick({ limit: Number(b.limit) || 5, force: true });
      return NextResponse.json({ ok: true, tick });
    }

    if (!id) return NextResponse.json({ error: "id dorkar" }, { status: 400 });

    if (action === "start") {
      const row = await startBroadcast(id);
      await logAudit(g.user.email, "WA_CAMPAIGN_STARTED", `#${id} ${row.name} → ${row.total} recipient(s)`);
      const tick = row.status === "RUNNING" ? await runWaTick({ limit: 3, force: true }).catch(() => null) : null;
      return NextResponse.json({ ok: true, broadcast: row, tick });
    }
    if (action === "pause") {
      const row = await pauseBroadcast(id);
      await logAudit(g.user.email, "WA_CAMPAIGN_PAUSED", `#${id} ${row.name}`);
      return NextResponse.json({ ok: true, broadcast: row });
    }
    if (action === "resume") {
      const row = await resumeBroadcast(id);
      await logAudit(g.user.email, "WA_CAMPAIGN_RESUMED", `#${id} ${row.name}`);
      const tick = await runWaTick({ limit: 3, force: true }).catch(() => null);
      return NextResponse.json({ ok: true, broadcast: row, tick });
    }
    if (action === "retryFailed") {
      const r = await retryFailed(id);
      await logAudit(g.user.email, "WA_CAMPAIGN_RETRY", `#${id} — ${r.requeued} failed message(s)`);
      const tick = r.requeued ? await runWaTick({ limit: 3, force: true }).catch(() => null) : null;
      return NextResponse.json({ ok: true, ...r, tick });
    }
    if (action === "duplicate") {
      const row = await duplicateBroadcast(id);
      await logAudit(g.user.email, "WA_CAMPAIGN_DUPLICATED", `#${id} → #${row.id}`);
      return NextResponse.json({ ok: true, broadcast: row });
    }
    if (action === "delete") {
      const r = await deleteBroadcast(id);
      await logAudit(g.user.email, "WA_CAMPAIGN_DELETED", `#${id}`);
      return NextResponse.json({ ok: true, ...r });
    }
    if (action === "update") {
      const row = await updateBroadcast(id, b);
      return NextResponse.json({ ok: true, broadcast: row });
    }
    if (action === "schedule") {
      const at = b.scheduledAt ? new Date(b.scheduledAt) : null;
      if (!at || isNaN(at.getTime())) return NextResponse.json({ error: "scheduledAt ঠিক নেই" }, { status: 400 });
      const row = await updateBroadcast(id, { scheduledAt: at.toISOString() });
      await logAudit(g.user.email, "WA_CAMPAIGN_SCHEDULED", `#${id} at ${at.toISOString()}`);
      return NextResponse.json({ ok: true, broadcast: row });
    }
    return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    await logApp("ERROR", "WHATSAPP", `campaign action ${action} failed: ${msg}`, { id }).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
