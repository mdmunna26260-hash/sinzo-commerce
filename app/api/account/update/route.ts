import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const s = await getCustomerSessionFromRequest(req);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  try {
    const { name, email, address, area, currentPassword, newPassword } = await req.json();
    const data: any = {};
    if (name) data.name = String(name).trim().slice(0, 80);
    if (email !== undefined) data.email = email ? String(email).trim() : null;
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
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
