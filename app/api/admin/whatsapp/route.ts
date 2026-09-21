import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { waStatus, waDevices, waHealth } from "@/lib/wa";
import { getSettings, envFallback, saveGroup } from "@/lib/settings";
import { runWaTick } from "@/lib/wa-worker";
import { waQueueStats, waRecentMessages, waRules, waTemplates, WA_RULE_DEFAULTS, sendTemplateTest } from "@/lib/wa-queue";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* WhatsApp hub API.
   GET  → bridge + device state, queue counters, the last messages, the delivery rules
   POST → { action: "tick" | "test" | "retry" | "cancel" | "rules" | "resend" }
   The panel never talks to the bridge directly (the bridge binds 127.0.0.1 and only trusts the
   bridge key), and the browser never talks to WhatsApp at all. */
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const s = envFallback(await getSettings());
  const [status, devices, stats, recent, templates, health] = await Promise.all([
    waStatus(),
    waDevices(),
    waQueueStats(),
    waRecentMessages(40),
    waTemplates(),
    waHealth(),
  ]);
  const dbDevices = await db.waDevice.findMany({ orderBy: { id: "asc" } });
  const n = s.notifications || {};
  const rules = waRules(s);

  return NextResponse.json({
    bridgeRunning: status.running,
    connected: status.connected,
    me: status.me,
    qrPending: status.qrPending,
    health,
    bridgeDevices: devices.devices,
    devices: dbDevices.map((d) => {
      const live = devices.devices.find((x) => x.sessionId === d.sessionId);
      return { ...d, live: live || null };
    }),
    stats,
    recent,
    templates: templates.map((t) => ({ key: t.key, name: t.name, enabled: t.enabled, mediaMode: t.mediaMode, category: t.category })),
    rules: { ...rules, workerKey: rules.workerKey ? "••••" + rules.workerKey.slice(-4) : "" },
    waEnabled: n.waEnabled !== false,
    waCustomerEnabled: n.waCustomerEnabled !== false,
    waNotifyNumber: n.waNotifyNumber || "",
    defaults: WA_RULE_DEFAULTS,
  });
}

export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await req.json().catch(() => ({} as any));
  const action = String(b.action || "");

  if (action === "tick") {
    const report = await runWaTick({ limit: Number(b.limit) || 5, force: true, bypass: b.bypass === true });
    return NextResponse.json({ ok: true, report });
  }

  if (action === "test") {
    const to = String(b.to || "").trim();
    const key = String(b.templateKey || "order_placed");
    if (!to) return NextResponse.json({ error: "Test number din" }, { status: 400 });
    const r = await sendTemplateTest(key, to);
    await logAudit(g.user.email, "WA_TEST_SEND", `${key} → ${to}: ${r.ok ? "queued" : r.reason || "failed"}`);
    return NextResponse.json(r.ok ? { ok: true, id: r.id, tick: r.tick } : { ok: false, error: r.reason || "Test send failed" }, { status: r.ok ? 200 : 400 });
  }

  if (action === "rules") {
    const current = ((envFallback(await getSettings()) as any).whatsapp || {}) as any;
    const incoming = (b.value || {}) as any;
    const next: any = { ...current };
    for (const k of ["enabled", "smsFallback", "testMode", "stopLine"] as const) if (k in incoming) next[k] = !!incoming[k];
    for (const k of ["quietFrom", "quietTo", "testNumber", "couponCode", "workerKey"] as const) if (k in incoming) next[k] = String(incoming[k] ?? "").trim();
    for (const k of ["dailyCapDefault", "fallbackHours"] as const) if (k in incoming) next[k] = Math.max(1, Math.min(Number(incoming[k]) || (WA_RULE_DEFAULTS as any)[k], 100000));
    if (typeof incoming.workerKey === "string" && incoming.workerKey.startsWith("••")) next.workerKey = current.workerKey || "";
    await saveGroup("whatsapp", next);
    await logAudit(g.user.email, "WA_RULES_SAVE", `WhatsApp rules updated (enabled=${next.enabled}, quiet ${next.quietFrom}–${next.quietTo})`);
    return NextResponse.json({ ok: true, rules: { ...next, workerKey: next.workerKey ? "••••" + String(next.workerKey).slice(-4) : "" } });
  }

  if (action === "retry" || action === "cancel" || action === "resend") {
    const id = Number(b.id);
    if (!id) return NextResponse.json({ error: "Message id din" }, { status: 400 });
    const row = await db.waMessage.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    if (action === "cancel") {
      await db.waMessage.update({ where: { id }, data: { status: "SKIPPED", error: "cancelled by admin", lockedAt: null } });
    } else if (action === "retry") {
      await db.waMessage.update({ where: { id }, data: { status: "QUEUED", attempts: 0, error: null, lockedAt: null, nextAttemptAt: null, sentAt: null, bridgeId: null } });
    } else {
      // resend: same text, brand-new row (keeps the original history intact)
      await db.waMessage.create({
        data: {
          toWaId: row.toWaId, kind: row.kind, templateKey: row.templateKey, body: row.body,
          mediaJson: row.mediaJson, couponCode: row.couponCode, orderId: row.orderId, meta: row.meta,
          status: "QUEUED", dedupeKey: null,
        },
      });
    }
    await logAudit(g.user.email, `WA_${action.toUpperCase()}`, `message #${id} → ${row.toWaId}`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
