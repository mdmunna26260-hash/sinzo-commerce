import crypto from "node:crypto";
import type { AbandonedCheckout } from "@prisma/client";
import { encodeSessionPayload, decodeSessionPayload, SESSION_SECRET } from "./session-token";

export const RECOVERY_LINK_TTL = 7 * 24 * 60 * 60 * 1000;
export const RECOVERY_DELAY = 45 * 60 * 1000;
export const RECOVERY_COOLDOWN = 24 * 60 * 60 * 1000;
export function captureKeyHash(key: unknown): string | null {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/i.test(key)) return null;
  return crypto.createHash("sha256").update(key.toLowerCase()).digest("hex");
}
type Subject = Pick<AbandonedCheckout, "id" | "createdAt" | "phone" | "email">;
function subjectHash(row: Subject): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(JSON.stringify([row.id, new Date(row.createdAt).toISOString(), row.phone, row.email])).digest("base64url");
}
export function signRecoveryToken(row: Subject, couponCode?: string | null, now = Date.now()): string {
  return encodeSessionPayload({ purpose: "cart-recovery", id: row.id, subject: subjectHash(row), exp: now + RECOVERY_LINK_TTL, ...(couponCode ? { coupon: couponCode.trim().toUpperCase().slice(0, 64) } : {}) });
}
export function readRecoveryToken(token: unknown): { id: number; subject: string; coupon?: string } | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const p = decodeSessionPayload(token);
  if (!p || p.purpose !== "cart-recovery" || !Number.isSafeInteger(p.id) || p.id <= 0 || typeof p.subject !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(p.subject) || (p.coupon !== undefined && (typeof p.coupon !== "string" || p.coupon.length > 64 || /[\r\n]/.test(p.coupon)))) return null;
  return { id: p.id, subject: p.subject, ...(p.coupon ? { coupon: p.coupon } : {}) };
}
export function matchesRecoverySubject(payload: { subject: string }, row: Subject): boolean {
  const expected = subjectHash(row);
  return payload.subject.length === expected.length && crypto.timingSafeEqual(new TextEncoder().encode(payload.subject), new TextEncoder().encode(expected));
}
export function recoveryUrl(base: string, token: string): string {
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Configure a valid public site URL");
  url.pathname = url.pathname.replace(/\/$/, "") + "/checkout";
  url.search = "";
  // Fragment is never sent in HTTP requests/referrers; checkout immediately strips it.
  url.hash = "recover=" + encodeURIComponent(token);
  return url.toString();
}
export function isRecoveryCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (secret.length < 32 || /change.?me|your.?secret|placeholder/i.test(secret)) return false;
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!token || token.length > 512) return false;
  const digest = (s: string) => new TextEncoder().encode(crypto.createHash("sha256").update(s).digest("hex"));
  return crypto.timingSafeEqual(digest(token), digest(secret));
}
export function recipientKeys(phone: string, email: string): string[] {
  return ["phone:" + phone, "email:" + email.toLowerCase()].map(s => "security.recovery.recipient." + crypto.createHash("sha256").update(s).digest("hex")).sort();
}
