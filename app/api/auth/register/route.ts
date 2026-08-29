import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createCustomerToken, customerCookie } from "@/lib/customer-auth";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!rateLimit("custreg:" + getClientIp(req), 10, 10 * 60 * 1000)) return NextResponse.json({ error: "Too many attempts, try later." }, { status: 429 });
  try {
    const { name, phone, email, password } = await req.json();
    const cleanPhone = normalizeBDPhone(String(phone || ""));
    if (!name || String(name).trim().length < 3) return NextResponse.json({ error: "Full name din" }, { status: 400 });
    if (!isValidBDPhone(cleanPhone)) return NextResponse.json({ error: "Valid 11-digit mobile din (01XXXXXXXXX)" }, { status: 400 });
    if (!password || String(password).length < 6) return NextResponse.json({ error: "Password minimum 6 character" }, { status: 400 });
    const existing = await db.customer.findUnique({ where: { phone: cleanPhone } });
    if (existing?.password) return NextResponse.json({ error: "Ei number-e account ase — login korun" }, { status: 400 });
    const hash = await bcrypt.hash(String(password), 10);
    const customer = existing
      ? await db.customer.update({ where: { id: existing.id }, data: { name: String(name).trim(), email: email || existing.email, password: hash } })
      : await db.customer.create({ data: { phone: cleanPhone, name: String(name).trim(), email: email || null, password: hash } });
    const token = createCustomerToken({ id: customer.id, phone: customer.phone, name: customer.name || "Customer" });
    const res = NextResponse.json({ ok: true, token, user: { name: customer.name, phone: customer.phone } });
    const c = customerCookie(token);
    (res.cookies as any).set(c.name, c.value, c);
    return res;
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
