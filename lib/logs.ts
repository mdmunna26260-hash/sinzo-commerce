import { db } from "./db";

/* App-level log (admin menu item 12).
   Every caller here can be a webhook or a background job, so logApp NEVER throws and never
   blocks the caller's response — a logging failure must not fail the thing being logged. */

export const APP_LOG_LEVELS = ["INFO", "WARN", "ERROR"] as const;
export const APP_LOG_KINDS = ["CLIENT", "WEBHOOK", "SMS", "WHATSAPP", "MAIL", "BACKUP", "CRON", "ORDER", "AUTH"] as const;
export type LogLevel = (typeof APP_LOG_LEVELS)[number];
export type LogKind = (typeof APP_LOG_KINDS)[number];

export async function logApp(level: LogLevel, kind: LogKind, message: string, meta?: unknown): Promise<void> {
  try {
    const { ensureExtraTables } = await import("./db-ensure");
    await ensureExtraTables();
    await db.appLog.create({
      data: {
        level,
        kind,
        message: String(message || "").slice(0, 1000),
        meta: meta === undefined ? null : JSON.stringify(meta).slice(0, 4000),
      },
    });
  } catch (e) {
    // last resort: the console (visible in `pm2 logs` / docker logs on the server)
    console.error(`[applog:${level}/${kind}] ${message}`, meta ?? "", e instanceof Error ? e.message : "");
  }
}

export function levelTone(level: string) {
  return level === "ERROR" ? "err" : level === "WARN" ? "warn" : "ok";
}
