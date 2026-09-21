import { db } from "./db";
import { getSettings, envFallback, type SettingsMap } from "./settings";
import { logApp } from "./logs";
import { waDevices, waDeviceBoot, waSend, waSendMedia } from "./wa";
import { inQuietHours, waRules, mirrorToInbox, waPretty, ensureWaTemplates, type WaRules } from "./wa-queue";

/* WhatsApp worker — one tick.
   scripts/wa-worker.js (PM2/cron) calls /api/wa/tick, which calls this. Everything that decides
   whether a message may leave the building lives HERE, not in the bridge:
     • daily caps + warm-up per device   • quiet hours (marketing only, order updates go now)
     • pacing between messages           • retry with backoff, then SMS fallback
     • auto-pause a number that keeps failing
   Claiming is optimistic (QUEUED → SENDING via updateMany) so two workers can never double-send. */

export const WA_MAX_ATTEMPTS = 3;
const BACKOFF_MIN = [2, 10, 30];
const LOCK_STALE_MS = 5 * 60 * 1000;

export type WaTickReport = {
  ok: boolean;
  at: string;
  disabled?: boolean;
  bridgeUp: boolean;
  quietHours: boolean;
  devices: { id: number; name: string; status: string; phone: string | null; sentToday: number; dailyCap: number }[];
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  smsFallback: number;
  skipped: number;
  notes: string[];
  nextInSec: number;
};

function today(): string { return new Date().toISOString().slice(0, 10); }

async function setState(key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value: JSON.stringify(value) }, create: { key, value: JSON.stringify(value) } }).catch(() => {});
}
async function getState(key: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } }).catch(() => null);
  if (!row) return "";
  try { const v = JSON.parse(row.value); return typeof v === "string" ? v : ""; } catch { return row.value; }
}

/** Mirror the bridge's live session state onto the WaDevice rows (and boot what the owner added). */
async function syncDevices(rules: WaRules, notes: string[]): Promise<{ up: boolean; devices: any[]; bridge: Map<string, any> }> {
  const bridge = new Map<string, any>();
  const list = await waDevices();
  if (list.running) for (const d of list.devices) bridge.set(d.sessionId, d);

  const rows = await db.waDevice.findMany({ orderBy: { id: "asc" } });
  const t = today();
  for (const row of rows) {
    const live = bridge.get(row.sessionId);
    const updates: any = {};
    if (row.sentDate !== t) { updates.sentDate = t; updates.sentToday = 0; }

    if (!live && list.running && !["PAUSED", "BANNED"].includes(row.status)) {
      // the owner added this number but the bridge has no session yet → boot it so a QR appears
      const boot = await waDeviceBoot(row.sessionId, row.name);
      if (boot.ok) notes.push(`${row.name}: session booted`);
    } else if (live) {
      const wasConnected = row.status === "CONNECTED";
      const isConnected = !!live.connected;
      if (!["PAUSED", "BANNED"].includes(row.status)) {
        updates.status = isConnected ? "CONNECTED" : live.qrPending ? "QR" : "DISCONNECTED";
      }
      // live.me looks like "8801676450711:12@s.whatsapp.net" — drop the ":device" part BEFORE the
      // digits-only pass (doing it the other way round glued the device number onto the phone).
      const phone = String(live.phone || "").replace(/\D/g, "")
        || String(live.me || "").split(":")[0].split("@")[0].replace(/\D/g, "")
        || null;
      if (phone && phone !== row.phone) updates.phone = phone;
      // NOTE: a live connection does NOT clear `consecutiveFailures` — only a message that actually
      // leaves the phone does (see the success branch below). A number that stays "connected" but keeps
      // failing sends is exactly the case the auto-pause exists for.
      if (isConnected) updates.lastSeenAt = new Date();
      if (isConnected !== wasConnected && !["PAUSED", "BANNED"].includes(row.status)) {
        const prev = await getState("whatsapp.lastDeviceState." + row.sessionId);
        if (prev !== updates.status) {
          await setState("whatsapp.lastDeviceState." + row.sessionId, updates.status);
          await logApp(isConnected ? "INFO" : "WARN", "WHATSAPP", `${row.name} (${waPretty(phone || row.phone || "")}) ${isConnected ? "connected" : "is " + updates.status}`, { sessionId: row.sessionId });
          if (!isConnected) {
            const { notifyAdmin } = await import("./notify");
            notifyAdmin("inbox", `⚠ WhatsApp device ${row.name} ${updates.status === "QR" ? "needs QR scan" : "disconnected"}`, `${row.name} — ${waPretty(phone || row.phone || "no number")}`, row.name).catch(() => {});
          }
        }
      }
    }
    if (Object.keys(updates).length) await db.waDevice.update({ where: { id: row.id }, data: updates }).catch(() => {});
  }
  const fresh = await db.waDevice.findMany({ orderBy: { id: "asc" } });
  return { up: list.running, devices: fresh, bridge };
}

function pickDevice(devices: any[], used: Map<number, number>): any | null {
  const usable = devices.filter((d) => d.status === "CONNECTED");
  if (!usable.length) return null;
  let best: any = null;
  let bestScore = Infinity;
  for (const d of usable) {
    const already = used.get(d.id) || 0;
    const sent = (d.sentToday || 0) + already;
    if (sent >= d.dailyCap) continue;
    const score = sent / Math.max(1, d.dailyCap);
    if (score < bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export async function runWaTick(opts: { limit?: number; force?: boolean; bypass?: boolean } = {}): Promise<WaTickReport> {
  const at = new Date().toISOString();
  const limit = Math.max(1, Math.min(Number(opts.limit) || 5, 25));
  const notes: string[] = [];
  const report: WaTickReport = {
    ok: true, at, bridgeUp: false, quietHours: false, devices: [],
    claimed: 0, sent: 0, failed: 0, retried: 0, smsFallback: 0, skipped: 0, notes, nextInSec: 30,
  };
  try {
    const { ensureExtraTables } = await import("./db-ensure");
    await ensureExtraTables().catch(() => {});
    await ensureWaTemplates();

    // two workers (PM2 + cron) must not overlap — unless the admin pressed "run now"
    const last = Number(await getState("whatsapp.tickMs")) || 0;
    if (!opts.force && Date.now() - last < 3000) { notes.push("another tick is running"); report.nextInSec = 5; return report; }
    await setState("whatsapp.tickMs", String(Date.now()));

    const s = envFallback(await getSettings());
    const rules = waRules(s);
    if (!rules.enabled && !opts.bypass) {
      report.disabled = true;
      notes.push("WhatsApp auto messages are switched off — the queue is paused");
      report.nextInSec = 60;
      return report;
    }

    const sync = await syncDevices(rules, notes);
    report.bridgeUp = sync.up;
    report.quietHours = inQuietHours(rules.quietFrom, rules.quietTo);
    report.devices = sync.devices.map((d) => ({ id: d.id, name: d.name, status: d.status, phone: d.phone, sentToday: d.sentToday, dailyCap: d.dailyCap }));

    // today's counters
    const t = today();
    for (const d of sync.devices) {
      if (d.sentDate !== t) await db.waDevice.update({ where: { id: d.id }, data: { sentDate: t, sentToday: 0 } }).catch(() => {});
    }

    // a crashed worker must not leave a message stuck in SENDING forever
    await db.waMessage.updateMany({
      where: { status: "SENDING", lockedAt: { lt: new Date(Date.now() - LOCK_STALE_MS) } },
      data: { status: "QUEUED", lockedAt: null, nextAttemptAt: null },
    }).catch(() => {});
    await db.waMessage.updateMany({
      where: { status: "QUEUED", nextAttemptAt: null },
      data: { nextAttemptAt: new Date(0) },
    }).catch(() => { });

    const now = new Date();
    const candidates = await db.waMessage.findMany({
      where: { status: "QUEUED", queuedAt: { lte: now } },
      orderBy: { id: "asc" },
      take: limit * 4,
    });
    if (!candidates.length) { notes.push("queue empty"); report.nextInSec = 45; return report; }

    const used = new Map<number, number>();
    let bridgeDown = !sync.up;
    let sentThisTick = 0;

    for (const m of candidates) {
      if (sentThisTick >= limit) break;
      if (m.nextAttemptAt && m.nextAttemptAt.getTime() > Date.now()) continue;
      // quiet hours hold everything except the customer's own order updates
      if (report.quietHours && m.kind !== "AUTO" && !opts.bypass) { notes.push(`#${m.id} held for quiet hours (${m.kind})`); continue; }

      const ageHours = (Date.now() - new Date(m.queuedAt).getTime()) / 3_600_000;

      // stuck for too long → the SMS gateway (item 7) takes over instead of the customer waiting forever
      if (ageHours >= rules.fallbackHours && m.attempts === 0) {
        const r = await smsFallbackFor(m, rules, s, notes);
        report.skipped += r ? 1 : 0;
        if (r) report.smsFallback += 1;
        continue;
      }

      const device = pickDevice(sync.devices, used);
      if (!device) {
        const anyConnected = sync.devices.some((d) => d.status === "CONNECTED");
        notes.push(anyConnected ? "all devices hit their daily cap" : "no connected device");
        if (!anyConnected && bridgeDown) notes.push("bridge is not reachable — is `npm run wa` running?");
        break;
      }

      const claim = await db.waMessage.updateMany({
        where: { id: m.id, status: "QUEUED" },
        data: { status: "SENDING", deviceId: device.id, lockedAt: new Date() },
      });
      if (claim.count !== 1) continue; // another worker took it
      report.claimed += 1;

      const media = m.mediaJson ? (JSON.parse(m.mediaJson) as string[]).filter(Boolean).slice(0, 10) : [];
      const res = media.length
        ? await waSendMedia({ to: m.toWaId, images: media, caption: m.body, sessionId: device.sessionId })
        : await waSend(m.toWaId, m.body, device.sessionId);

      if (res.ok) {
        await db.waMessage.update({
          where: { id: m.id },
          data: { status: "SENT", sentAt: new Date(), attempts: m.attempts + 1, error: null, lockedAt: null, nextAttemptAt: null, bridgeId: res.id || null },
        });
        await db.waDevice.update({ where: { id: device.id }, data: { sentToday: { increment: 1 }, sentDate: t, consecutiveFailures: 0, lastSeenAt: new Date() } }).catch(() => {});
        used.set(device.id, (used.get(device.id) || 0) + 1);
        sentThisTick += 1;
        report.sent += 1;
        await mirrorToInbox(m.toWaId, m.body, m.orderId ?? null);
        const wentImages = "sentImages" in res ? Number(res.sentImages) || media.length : media.length;
        const lostImages = "failedImages" in res ? Number(res.failedImages) || 0 : 0;
        const photoNote = media.length ? ` (${wentImages} photo${wentImages === 1 ? "" : "s"}${lostImages ? `, ${lostImages} failed` : ""})` : "";
        await logApp("INFO", "WHATSAPP", `sent ${m.templateKey || m.kind} → ${waPretty(m.toWaId)} via ${device.name}${photoNote}`, { waMessageId: m.id, orderId: m.orderId, images: media.length });
        continue;
      }

      // ---- failure ----------------------------------------------------------------
      const err = String(res.error || "send failed").slice(0, 200);
      const attempts = m.attempts + 1;
      const invalid = /invalid|not a valid|bad number|not registered|not on whatsapp|404/i.test(err);
      const notConnected = !res.connected || /not connected|connection closed|logged out|scan qr/i.test(err);

      if (invalid) {
        await db.waMessage.update({ where: { id: m.id }, data: { status: "SKIPPED", attempts, error: `invalid WhatsApp number — ${err}`, lockedAt: null } });
        report.skipped += 1;
        await logApp("WARN", "WHATSAPP", `${m.templateKey || m.kind} to ${waPretty(m.toWaId)} skipped: ${err}`, { waMessageId: m.id });
        continue;
      }
      if (notConnected) {
        bridgeDown = !sync.up;
        await db.waDevice.update({ where: { id: device.id }, data: { status: "DISCONNECTED", lastError: err, consecutiveFailures: { increment: 1 } } }).catch(() => {});
      }
      if (attempts >= WA_MAX_ATTEMPTS) {
        const sms = await smsFallbackFor(m, rules, s, notes, err);
        if (sms) {
          report.smsFallback += 1;
        } else {
          await db.waMessage.update({ where: { id: m.id }, data: { status: "FAILED", attempts, error: err, lockedAt: null } });
          report.failed += 1;
          await logApp("ERROR", "WHATSAPP", `${m.templateKey || m.kind} to ${waPretty(m.toWaId)} failed after ${attempts} tries: ${err}`, { waMessageId: m.id, deviceId: device.id });
        }
      } else {
        const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
        await db.waMessage.update({
          where: { id: m.id },
          data: { status: "QUEUED", attempts, error: err, lockedAt: null, nextAttemptAt: new Date(Date.now() + wait * 60_000) },
        });
        report.retried += 1;
      }

      // a number that keeps failing is paused, not hammered (ban safety)
      const fresh = await db.waDevice.findUnique({ where: { id: device.id } }).catch(() => null);
      if (fresh && fresh.consecutiveFailures >= 5 && fresh.status !== "PAUSED") {
        await db.waDevice.update({ where: { id: device.id }, data: { status: "PAUSED", lastError: err } }).catch(() => {});
        notes.push(`${device.name} auto-paused after ${fresh.consecutiveFailures} failures`);
        await logApp("ERROR", "WHATSAPP", `${device.name} auto-paused after ${fresh.consecutiveFailures} failed sends — last error: ${err}`, { deviceId: device.id });
        const { notifyAdmin } = await import("./notify");
        notifyAdmin("inbox", `🛑 WhatsApp device paused: ${device.name}`, `Kono message jacche na (${fresh.consecutiveFailures} failures). Last error: ${err}`, device.name).catch(() => {});
      }
    }

    report.nextInSec = sentThisTick > 0 ? 6 + Math.floor(Math.random() * 7) : (report.devices.some((d) => d.status === "CONNECTED") ? 15 : 45);
    return report;
  } catch (e: any) {
    report.ok = false;
    notes.push("error: " + String(e?.message || e).slice(0, 200));
    await logApp("ERROR", "WHATSAPP", `worker tick failed: ${String(e?.message || e).slice(0, 200)}`).catch(() => {});
    report.nextInSec = 60;
    return report;
  }
}

/** WhatsApp could not deliver → hand the same text to the SMS gateway and close the row honestly. */
async function smsFallbackFor(m: any, rules: WaRules, s: SettingsMap, notes: string[], why?: string): Promise<boolean> {
  try {
    if (!rules.smsFallback) return false;
    const { smsConfigured, sendSms } = await import("./sms");
    if (!smsConfigured(s)) { notes.push(`#${m.id} needs SMS fallback but no SMS gateway is configured`); return false; }
    const r = await sendSms(s, m.toWaId, m.body, "wa-fallback");
    if (r.ok) {
      await db.waMessage.update({
        where: { id: m.id },
        data: { status: "SKIPPED", lockedAt: null, error: `WhatsApp e jay nai${why ? ` (${why.slice(0, 80)})` : ""} — SMS e pathano hoyeche` },
      });
      await logApp("WARN", "WHATSAPP", `${m.templateKey || m.kind} to ${waPretty(m.toWaId)} fell back to SMS`, { waMessageId: m.id, why: why || "queued too long" });
      return true;
    }
    notes.push(`#${m.id} SMS fallback failed: ${r.error || "unknown"}`);
    return false;
  } catch {
    return false;
  }
}
