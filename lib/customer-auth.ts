import { db } from "./db";
import { ALLOW_URL_TOKEN, encodeSessionPayload, decodeSessionPayload, cookieToken } from "./session-token";

export type CustomerSession = { id: number; phone: string; name: string; kind: "customer"; exp: number };

export function createCustomerToken(u: { id: number; phone: string; name: string }): string {
  return encodeSessionPayload({ ...u, kind: "customer", exp: Date.now() + 1000 * 60 * 60 * 24 * 30 });
}
export function verifyCustomerToken(token?: string | null): CustomerSession | null {
  const session = decodeSessionPayload(token);
  if (!session || session.kind !== "customer" || session.p !== undefined) return null;
  if (!Number.isSafeInteger(session.id) || session.id <= 0 || typeof session.phone !== "string" || typeof session.name !== "string") return null;
  return session as CustomerSession;
}
export function customerTokenFromRequest(req?: Request): string | null {
  if (!req) return null;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return ALLOW_URL_TOKEN ? new URL(req.url).searchParams.get("ct") : null;
}
export async function getCustomerSessionFromRequest(req?: Request, fallbackToken?: string | null): Promise<CustomerSession | null> {
  let token: string | null | undefined;
  if (req) {
    token = cookieToken(req, ["sz_customer", "sz_customer_fb"]);
  } else {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    token = jar.get("sz_customer")?.value || jar.get("sz_customer_fb")?.value;
  }
  const session = verifyCustomerToken(token)
    || verifyCustomerToken(req ? customerTokenFromRequest(req) : ALLOW_URL_TOKEN ? fallbackToken : null);
  if (!session) return null;
  // Deleted accounts and an old phone embedded in a token are never authoritative.
  const customer = await db.customer.findUnique({ where: { id: session.id }, select: { phone: true, name: true } }).catch(() => null);
  if (!customer) return null;
  return { ...session, phone: customer.phone, name: customer.name || "Customer" };
}
export function customerCookie(token: string) {
  return { name: "sz_customer", value: token, httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
}
