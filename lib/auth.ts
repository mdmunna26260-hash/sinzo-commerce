import crypto from "crypto";
import { db } from "./db";

const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
export type SessionUser = { id: number; email: string; name: string; role: string; exp: number };

export const ROLE_PERMS: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  ADMIN: ["products", "orders", "customers", "coupons", "reviews", "marketing", "tracking", "settings", "users", "audit", "categories", "collections"],
  ORDER_MANAGER: ["orders", "customers"],
  PRODUCT_MANAGER: ["products", "categories", "collections", "inventory"],
  MARKETING: ["coupons", "marketing", "tracking"],
  SUPPORT: ["orders", "customers", "reviews"],
};
export function can(user: SessionUser | null, perm: string): boolean {
  if (!user) return false;
  const perms = ROLE_PERMS[user.role] || [];
  return perms.includes("*") || perms.includes(perm);
}

function sign(payloadB64: string): string {
  return crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
}
export function createToken(u: Omit<SessionUser, "exp">): string {
  const body: SessionUser = { ...u, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 };
  const payloadB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  return payloadB64 + "." + sign(payloadB64);
}
export function verifyToken(token?: string | null): SessionUser | null {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  const expected = sign(payloadB64);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig) as any, Buffer.from(expected) as any)) return null;
    const user = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as SessionUser;
    if (!user.exp || user.exp < Date.now()) return null;
    return user;
  } catch { return null; }
}
export async function getSessionUser(): Promise<SessionUser | null> {
  const { cookies } = await import("next/headers");
  // primary: httpOnly cookie set by the API · fallback: JS-set cookie for browsers
  // that block Set-Cookie from fetch responses (embedded/preview browsers)
  const c = cookies().get("sz_session") || cookies().get("sz_session_fb");
  return verifyToken(c?.value);
}
export function sessionCookie(token: string) {
  return { name: "sz_session", value: token, httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 };
}
export async function logAudit(email: string, action: string, detail?: string, ip?: string) {
  try { await db.auditLog.create({ data: { userEmail: email, action, detail: detail ? detail.slice(0, 2000) : undefined, ip } }); } catch {}
}
// simple in-memory rate limiter
const buckets: Map<string, number[]> = (global as any).__rl || ((global as any).__rl = new Map());
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr); return true;
}

// ---- URL-token fallback (for browsers/previews that block cookies) ----
export async function requireAdmin(sp?: { t?: string | string[] | undefined }): Promise<SessionUser> {
  const cookieUser = await getSessionUser();
  if (cookieUser) return cookieUser;
  const t = Array.isArray(sp?.t) ? sp?.t?.[0] : sp?.t;
  const tokenUser = verifyToken(t);
  if (tokenUser && tokenUser.role) return tokenUser; // reject customer tokens
  const { redirect } = await import("next/navigation");
  redirect("/admin/login");
}
export function tokenFromRequest(req?: Request): string | null {
  if (!req) return null;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return new URL(req.url).searchParams.get("t");
}
