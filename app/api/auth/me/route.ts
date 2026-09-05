import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const s = await getCustomerSessionFromRequest(req);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const customer = await db.customer.findUnique({ where: { id: s.id }, select: { name: true, phone: true, email: true, address: true, area: true } });
  return NextResponse.json({ customer });
}
