import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getCustomerSessionFromRequest, createCustomerToken } from "@/lib/customer-auth";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const s = await getCustomerSessionFromRequest(req);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  try {
    const { name, email, phone, address, area, currentPassword, newPassword } = await req.json();
    const data: any = {};
    if (name) data.name = String(name).trim().slice(0, 80);
    if (email !== undefined) data.email = email ? String(email).trim() : null;
    if (phone !== undefined) {
      // Google-login accounts get a temp internal phone — let them set their real number
      const p = normalizeBDPhone(String(phone || ""));
      if (!isValidBDPhone(p)) return NextResponse.json({ error: "Valid BD mobile number din (01XXXXXXXXX)" }, { status: 400 });
      if (p !== s.phone) {
        const dupe = await db.customer.findUnique({ where: { phone: p } });
        if (dupe && dupe.id !== s.id) return NextResponse.json({ error: "Ei number diye already account ache" }, { status: 400 });
        data.phone = p;
      }
    }
    if (address !== undefined) data.address = address ? String(address).trim() : null;
    if (area) data.area = area;
    if (newPassword) {
      const customer = await db.customer.findUnique({ where: { id: s.id } });
      if (customer?.password) {
        if (!currentPassword || !(await bcrypt.compare(String(currentPassword), customer.password)))
          return NextResponse.json({ error: "Current password thik nai" }, { status: 400 });
      }
      if (String(newPassword).length < 6) return NextResponse.json({ error: "Password minimum 6 character" }, { status: 400 });
      data.password = await bcrypt.hash(String(newPassword), 10);
    }
    await db.customer.update({ where: { id: s.id }, data });
    // phone changed → refresh the session token so order lookups use the new number
    if (data.phone) {
      const token = createCustomerToken({ id: s.id, phone: data.phone, name: (data.name as string) || s.name });
      const res = NextResponse.json({ ok: true, token });
      res.cookies.set({ name: "sz_customer", value: token, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
      return res;
    }
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
