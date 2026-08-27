import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createCustomerToken, customerCookie } from "@/lib/customer-auth";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!rateLimit("custlogin:" + getClientIp(req), 10, 10 * 60 * 1000)) return NextResponse.json({ error: "Too many attempts, try later." }, { status: 429 });
  try {
    const { phone, password } = await req.json();
    const cleanPhone = String(phone || "").replace(/[\s-]/g, "");
    const customer = await db.customer.findUnique({ where: { phone: cleanPhone } });
    if (!customer || !customer.password) return NextResponse.json({ error: "Account pay nai — age register korun" }, { status: 401 });
    const ok = await bcrypt.compare(String(password || ""), customer.password);
    if (!ok) return NextResponse.json({ error: "Bhul password" }, { status: 401 });
    const token = createCustomerToken({ id: customer.id, phone: customer.phone, name: customer.name || "Customer" });
    const res = NextResponse.json({ ok: true, token, user: { name: customer.name, phone: customer.phone } });
    const c = customerCookie(token);
    (res.cookies as any).set(c.name, c.value, c);
    return res;
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
