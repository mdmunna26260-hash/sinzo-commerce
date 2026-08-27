import { db } from "./db";

export type RiskInput = { phone: string; address: string; ip?: string };

/* Velocity-IP rule only makes sense for real, unique client IPs. Local/shared
   placeholders (0.0.0.0, private ranges) would block EVERYONE behind the same
   proxy — so they are never auto-blacklisted. */
export function isBlockableIp(ip?: string | null): boolean {
  if (!ip) return false;
  if (ip === "0.0.0.0" || ip === "127.0.0.1" || ip === "::1") return false;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return false;
  const m = /^172\.(1[6-9]|2\d|3[01])\./.exec(ip);
  if (m) return false;
  return true;
}

export async function assessRisk(input: RiskInput, cfg: any): Promise<{ level: string; flags: string[] }> {
  const flags: string[] = [];
  if (!cfg?.enabled) return { level: "LOW", flags };

  // ---------- VELOCITY AUTO-BLOCK (PDF §29: many orders in short window) ----------
  // e.g. 9 orders within 10 minutes from the same IP → auto-blacklist that IP.
  const velMax = Math.max(2, Number(cfg.velocityMaxOrders) || 9);
  const velWin = Math.max(1, Number(cfg.velocityWindowMinutes) || 10);
  const since = new Date(Date.now() - velWin * 60000);

  if (input.ip && isBlockableIp(input.ip)) {
    const ipCount = await db.order.count({ where: { ip: input.ip, createdAt: { gte: since } } });
    if (ipCount + 1 >= velMax) {
      flags.push(`velocity-ip: ${ipCount + 1} orders in ${velWin} min`);
      const ex = await db.blacklist.findFirst({ where: { type: "IP", value: input.ip } });
      if (!ex) {
        await db.blacklist.create({ data: { type: "IP", value: input.ip, note: `auto: ${ipCount + 1} orders in ${velWin} min` } }).catch(() => {});
        await db.auditLog.create({ data: { userEmail: "system@fraud", action: "AUTO_BLACKLIST_IP", detail: `${input.ip} — ${ipCount + 1} orders within ${velWin} min` } }).catch(() => {});
      }
      return { level: "CRITICAL", flags };
    }
    if (ipCount + 1 >= Math.ceil(velMax * 0.6)) {
      flags.push(`ip-velocity-warning: ${ipCount + 1} in ${velWin} min`);
    }
  }
  {
    const phCount = await db.order.count({ where: { phone: input.phone, createdAt: { gte: since } } });
    if (phCount + 1 >= velMax) {
      flags.push(`velocity-phone: ${phCount + 1} orders in ${velWin} min`);
      if (cfg.autoBlacklistPhone) {
        const ex = await db.blacklist.findFirst({ where: { type: "PHONE", value: input.phone } });
        if (!ex) {
          await db.blacklist.create({ data: { type: "PHONE", value: input.phone, note: `auto: ${phCount + 1} orders in ${velWin} min` } }).catch(() => {});
          await db.auditLog.create({ data: { userEmail: "system@fraud", action: "AUTO_BLACKLIST_PHONE", detail: `${input.phone} — ${phCount + 1} orders within ${velWin} min` } }).catch(() => {});
        }
        return { level: "CRITICAL", flags };
      }
      return { level: "HIGH", flags };
    }
  }

  // ---------- existing signals ----------
  const since1h = new Date(Date.now() - 3600_000);
  const recent = await db.order.count({ where: { phone: input.phone, createdAt: { gte: since1h } } });
  const maxPerHour = Math.max(1, Number(cfg.maxOrdersPerHourPerPhone) || 3);
  if (recent >= maxPerHour) flags.push(`velocity: ${recent} orders in 1h`);

  const cancelled = await db.order.count({ where: { phone: input.phone, status: { in: ["CANCELLED", "RETURNED"] } } });
  if (cancelled >= (Number(cfg.highRiskCancelCount) || 3)) flags.push(`${cancelled} cancellations/returns`);

  const total = await db.order.count({ where: { phone: input.phone } });
  if (total === 0) flags.push("new-phone");

  const blPhone = await db.blacklist.findFirst({ where: { type: "PHONE", value: input.phone } });
  if (blPhone) flags.push("blacklisted-phone");
  if (input.ip) {
    const blIp = await db.blacklist.findFirst({ where: { type: "IP", value: input.ip } });
    if (blIp && isBlockableIp(input.ip)) flags.push("blacklisted-ip");
    else if (blIp) flags.push("blacklisted-ip (ignored: shared/local ip)");
  }
  if (input.address && input.address.length > 8) {
    const list = await db.blacklist.findMany({ where: { type: "ADDRESS" } });
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const b of list) {
      if (norm(b.value) && (norm(input.address).includes(norm(b.value)) || norm(b.value).includes(norm(input.address)))) { flags.push("blacklisted-address"); break; }
    }
  }

  const critical = flags.some((f) => f.startsWith("blacklisted"));
  const high = flags.some((f) => f.startsWith("velocity") || f.startsWith("blacklisted"));
  const level = critical ? "CRITICAL" : high ? "HIGH" : flags.length > 1 ? "MEDIUM" : "LOW";
  return { level, flags };
}
