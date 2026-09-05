import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureExtraTables } from "@/lib/db-ensure";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const s = await getCustomerSessionFromRequest(req);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  await ensureExtraTables().catch(() => {});
  const [customer, addresses] = await Promise.all([
    db.customer.findUnique({ where: { id: s.id }, select: { name: true, phone: true, email: true, address: true, area: true } }),
    db.address.findMany({ where: { customerId: s.id }, orderBy: [{ isDefault: "desc" }, { id: "desc" }] }).catch(() => []),
  ]);
  return NextResponse.json({ customer, addresses });
}
