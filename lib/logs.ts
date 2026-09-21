import { db } from "./db";

/* One table for everything that happens in the background: client crashes, browser reports,
   webhook calls, SMS gateway answers, WhatsApp bridge sends, backup runs.
   The Logs screen (admin → Logs) reads it, so a failure is something the owner can see
   instead of something that only exists in a server log nobody opens. */
export type LogKind = "CLIENT" | "WEBHOOK" | "SMS" | "WHATSAPP" | "MAIL" | "CRON" | "BACKUP";
export type LogLevel = "INFO" | "WARN" | "ERROR";

export async function logApp(level: LogLevel, kind: LogKind, message: string, meta?: unknown): Promise<void> {
  try {
    await db.appLog.create({
      data: {
        level, kind,
        message: String(message).slice(0, 500),
        meta: meta === undefined ? null : JSON.stringify(meta).slice(0, 2000),
      },
    });
  } catch {
    /* logging must never be the thing that breaks a request */
  }
}
