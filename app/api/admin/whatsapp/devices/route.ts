import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { db } from "@/lib/db";
import { waDevices, waDeviceBoot, waDeviceQr, waDeviceLogout } from "@/lib/wa";
import { getSettings, envFallback } from "@/lib/settings";
import { waRules } from "@/lib/wa-queue";
import { logApp } from "@/lib/logs";
import { logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* WhatsApp devices (the 2–3 phone numbers).
   GET  → every device with its live bridge state, today's usage vs cap, and the day's sends
   POST → { action: "add" | "boot" | "qr" | "logout" | "remove" | "pause" | "resume" | "rename" | "cap" | "default" }
   Session keys live on the VPS in `.wa-auth/<sessionId>/` — the panel only ever sees a QR code. */

const WARMUP_CAPS = [50, 150, 300, 400];

function slug(name: string): string {
  const base = String(name || "device").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "device";
  return base + "-" + Math.random().toString(36).slice(2, 6);
}

export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const [rows, live] = await Promise.all([db.waDevice.findMany({ orderBy: { id: "asc" } }), waDevices()]);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  // counted in JS on purpose — groupBy is not reliable through the Prisma SQLite adapter
  const sentToday = await db.waMessage.findMany({ where: { sentAt: { gte: midnight }, deviceId: { not: null } }, select: { deviceId: true } }).catch(() => []);
  const counts = new Map<number, number>();
  for (const m of sentToday) if (m.deviceId) counts.set(m.deviceId, (counts.get(m.deviceId) || 0) + 1);

  return NextResponse.json({
    bridgeRunning: live.running,
    devices: rows.map((d) => {
      const l = live.devices.find((x) => x.sessionId === d.sessionId) || null;
      return {
        ...d,
        live: l,
        sentTodayReal: counts.get(d.id) || 0,
        warmupCaps: WARMUP_CAPS,
      };
    }),
    unknownSessions: live.devices.filter((l) => !rows.some((d) => d.sessionId === l.sessionId)),
  });
}

export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await req.json().catch(() => ({} as any));
  const action = String(b.action || "");
  const s = envFallback(await getSettings());
  const rules = waRules(s);

  if (action === "add") {
    const name = String(b.name || "").trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "Device name din (e.g. \"Sinzo Support\")" }, { status: 400 });
    const count = await db.waDevice.count();
    if (count >= 5) return NextResponse.json({ error: "5 device-er beshi lagbe na — ekta bad diye abar try korun" }, { status: 400 });
    const sessionId = String(b.sessionId || "").trim() || slug(name);
    const device = await db.waDevice.create({
      data: {
        name, sessionId,
        dailyCap: Math.max(10, Math.min(Number(b.dailyCap) || rules.dailyCapDefault, 100000)),
        warmupStage: Math.max(0, Math.min(Number(b.warmupStage) || 0, 3)),
        isDefault: count === 0,
        status: "DISCONNECTED",
      },
    });
    const boot = await waDeviceBoot(sessionId, name);
    await logAudit(g.user.email, "WA_DEVICE_ADD", `${name} (${sessionId})${boot.ok ? "" : " — bridge: " + (boot.error || "not reachable")}`);
    await logApp(boot.ok ? "INFO" : "WARN", "WHATSAPP", `device added: ${name} (${sessionId})${boot.ok ? "" : " — bridge unreachable"}`).catch(() => {});
    return NextResponse.json({ ok: true, device, bridge: boot });
  }

  const id = Number(b.id);
  if (!id) return NextResponse.json({ error: "Device id din" }, { status: 400 });
  const device = await db.waDevice.findUnique({ where: { id } });
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

  if (action === "qr" || action === "boot") {
    const boot = await waDeviceBoot(device.sessionId, device.name);
    const qr = await waDeviceQr(device.sessionId);
    if (qr.connected) {
      await db.waDevice.update({ where: { id }, data: { status: "CONNECTED", lastSeenAt: new Date(), lastError: null } }).catch(() => {});
    } else if (qr.status && qr.status !== device.status) {
      await db.waDevice.update({ where: { id }, data: { status: qr.status } }).catch(() => {});
    }
    return NextResponse.json({ ok: true, qr: qr.qr, connected: qr.connected, status: qr.status, hint: qr.hint, bridge: boot });
  }

  if (action === "logout") {
    const r = await waDeviceLogout(device.sessionId);
    await db.waDevice.update({ where: { id }, data: { status: "DISCONNECTED", phone: null, lastError: r.ok ? "unpaired by admin" : r.error || "logout failed" } }).catch(() => {});
    await logAudit(g.user.email, "WA_DEVICE_LOGOUT", `${device.name} (${device.sessionId})`);
    return NextResponse.json({ ok: r.ok, error: r.error });
  }

  if (action === "remove") {
    await waDeviceLogout(device.sessionId).catch(() => {});
    await db.waDevice.delete({ where: { id } });
    if (device.isDefault) {
      const next = await db.waDevice.findFirst({ orderBy: { id: "asc" } });
      if (next) await db.waDevice.update({ where: { id: next.id }, data: { isDefault: true } }).catch(() => {});
    }
    await logAudit(g.user.email, "WA_DEVICE_REMOVE", `${device.name} (${device.sessionId})`);
    return NextResponse.json({ ok: true });
  }

  if (action === "pause" || action === "resume") {
    await db.waDevice.update({
      where: { id },
      data: action === "pause"
        ? { status: "PAUSED", lastError: "paused by admin" }
        : { status: "DISCONNECTED", lastError: null, consecutiveFailures: 0 },
    });
    await logApp("WARN", "WHATSAPP", `${device.name} ${action === "pause" ? "paused" : "resumed"} by ${g.user.email}`).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "rename") {
    const name = String(b.name || "").trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "Name din" }, { status: 400 });
    await db.waDevice.update({ where: { id }, data: { name } });
    return NextResponse.json({ ok: true });
  }

  if (action === "cap") {
    const stage = b.warmupStage !== undefined ? Math.max(0, Math.min(Number(b.warmupStage) || 0, 3)) : device.warmupStage;
    const cap = b.dailyCap !== undefined ? Math.max(1, Math.min(Number(b.dailyCap) || 0, 100000)) : WARMUP_CAPS[stage];
    await db.waDevice.update({ where: { id }, data: { dailyCap: cap, warmupStage: stage } });
    await logAudit(g.user.email, "WA_DEVICE_CAP", `${device.name}: cap ${cap}/day (stage ${stage})`);
    return NextResponse.json({ ok: true, dailyCap: cap, warmupStage: stage });
  }

  if (action === "default") {
    await db.waDevice.updateMany({ data: { isDefault: false } });
    await db.waDevice.update({ where: { id }, data: { isDefault: true } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
