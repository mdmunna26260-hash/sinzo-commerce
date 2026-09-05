import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureExtraTables } from "@/lib/db-ensure";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
export const dynamic = "force-dynamic";

const MAX_ADDRESSES = 10;

/* GET → all saved addresses for the logged-in customer */
export async function GET(req: Request) {
  const s = await getCustomerSessionFromRequest(req);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  await ensureExtraTables();
  const addresses = await db.address.findMany({
    where: { customerId: s.id },
    orderBy: [{ isDefault: "desc" }, { id: "desc" }],
  });
  return NextResponse.json({ addresses });
}

/* POST → add an address (first one becomes default automatically) */
export async function POST(req: Request) {
  const s = await getCustomerSessionFromRequest(req);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  try {
    await ensureExtraTables();
    const b = await req.json();
    const name = String(b.name || "").trim().slice(0, 80);
    const phone = normalizeBDPhone(String(b.phone || ""));
    const address = String(b.address || "").trim().slice(0, 500);
    const area = b.area === "OUTSIDE_DHAKA" ? "OUTSIDE_DHAKA" : "INSIDE_DHAKA";
    const label = ["Home", "Office", "Other"].includes(b.label) ? b.label : "Other";

    const errors: any = {};
    if (name.length < 3) errors.name = "Full name din";
    if (!isValidBDPhone(phone)) errors.phone = "Valid BD mobile number din";
    if (address.length < 10) errors.address = "Full address din (house, road, area)";
    if (Object.keys(errors).length) return NextResponse.json({ error: "Validation failed", errors }, { status: 400 });

    const count = await db.address.count({ where: { customerId: s.id } });
    if (count >= MAX_ADDRESSES) return NextResponse.json({ error: `Maximum ${MAX_ADDRESSES} addresses save kora jay` }, { status: 400 });

    const isDefault = b.isDefault === true || count === 0;
    if (isDefault) {
      await db.address.updateMany({ where: { customerId: s.id, isDefault: true }, data: { isDefault: false } });
    }
    const created = await db.address.create({
      data: { customerId: s.id, label, name, phone, address, area, isDefault },
    });
    // keep the legacy Customer.address in sync with the default address
    if (isDefault) {
      await db.customer.update({ where: { id: s.id }, data: { address, area, name: name || undefined, phone: s.phone } }).catch(() => {});
    }
    return NextResponse.json({ ok: true, address: created });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
