import crypto from "crypto";
import { db } from "./db";

const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
export type CustomerSession = { id: number; phone: string; name: string; kind: "customer"; exp: number };

function sign(payloadB64: string): string {
  return crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
}
export function createCustomerToken(u: { id: number; phone: string; name: string }): string {
  const body: CustomerSession = { ...u, kind: "customer", exp: Date.now() + 1000 * 60 * 60 * 24 * 30 };
  const payloadB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  return payloadB64 + "." + sign(payloadB64);
}
export function verifyCustomerToken(token?: string | null): CustomerSession | null {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig) as any, Buffer.from(sign(payloadB64)) as any)) return null;
    const s = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as CustomerSession;
    if (s.kind !== "customer" || !s.exp || s.exp < Date.now()) return null;
    return s;
  } catch { return null; }
}
export function customerTokenFromRequest(req?: Request): string | null {
  if (!req) return null;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return new URL(req.url).searchParams.get("ct");
}
export async function getCustomerSessionFromRequest(req?: Request): Promise<CustomerSession | null> {
  let token: string | null | undefined;
  if (req) token = customerTokenFromRequest(req);
  else {
    const { cookies } = await import("next/headers");
    token = cookies().get("sz_customer")?.value || cookies().get("sz_customer_fb")?.value;
  }
  return verifyCustomerToken(token);
}
export function customerCookie(token: string) {
  return { name: "sz_customer", value: token, httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
}
