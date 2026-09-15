import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createCustomerToken, customerCookie } from "@/lib/customer-auth";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!rateLimit("custlogin:" + getClientIp(req), 10, 10 * 60 * 1000)) return NextResponse.json({ error: "Too many attempts, try later." }, { status: 429 });
  try {
    const { phone, password } = await req.json();
    const cleanPhone = normalizeBDPhone(String(phone || ""));
    // per-account throttle on top of the per-IP one: without it a rotated-IP attacker can
    // brute-force one number at leisure (10/10min per IP is trivially spread out)
    if (!rateLimit("custlogin-em:" + cleanPhone, 8, 15 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
    }
    const customer = await db.customer.findUnique({ where: { phone: cleanPhone } });
    // One generic message + always run a bcrypt compare: "Account pay nai" vs "Bhul password"
    // told the world which BD mobile numbers have an account here (and the missing compare made
    // the no-account path answer ~100x faster). Same pattern /api/admin/login already uses.
    const hash = customer?.password || "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBkRG0AmUfyV0JbzhX.T1BxJmWjA1u";
    const ok = await bcrypt.compare(String(password || ""), hash);
    if (!customer || !customer.password || !ok) {
      return NextResponse.json({ error: "Invalid phone number or password" }, { status: 401 });
    }
    const token = createCustomerToken({ id: customer.id, phone: customer.phone, name: customer.name || "Customer" });
    const res = NextResponse.json({ ok: true, token, user: { name: customer.name, phone: customer.phone } });
    const c = customerCookie(token);
    (res.cookies as any).set(c.name, c.value, c);
    return res;
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
