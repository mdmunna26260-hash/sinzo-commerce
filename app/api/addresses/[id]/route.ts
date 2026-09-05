import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureExtraTables } from "@/lib/db-ensure";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
import { normalizeBDPhone, isValidBDPhone } from "@/lib/phone";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

async function ownedAddress(sessionId: number, id: number) {
  const addr = await db.address.findUnique({ where: { id } });
  if (!addr || addr.customerId !== sessionId) return null;
  return addr;
}

/* PUT → update fields, or { action: "setDefault" } */
export async function PUT(req: Request, { params }: Ctx) {
  const s = await getCustomerSessionFromRequest(req);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  try {
    await ensureExtraTables();
    const id = Number(params.id);
    const existing = await ownedAddress(s.id, id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const b = await req.json();

    if (b.action === "setDefault") {
      await db.address.updateMany({ where: { customerId: s.id, isDefault: true }, data: { isDefault: false } });
      const updated = await db.address.update({ where: { id }, data: { isDefault: true } });
      await db.customer
        .update({ where: { id: s.id }, data: { address: updated.address, area: updated.area } })
        .catch(() => {});
      return NextResponse.json({ ok: true, address: updated });
    }

    const data: any = {};
    if (b.label !== undefined) data.label = ["Home", "Office", "Other"].includes(b.label) ? b.label : "Other";
    if (b.name !== undefined) {
      const name = String(b.name).trim().slice(0, 80);
      if (name.length < 3) return NextResponse.json({ error: "Full name din", errors: { name: "Full name din" } }, { status: 400 });
      data.name = name;
    }
    if (b.phone !== undefined) {
      const phone = normalizeBDPhone(String(b.phone));
      if (!isValidBDPhone(phone)) return NextResponse.json({ error: "Valid BD mobile number din", errors: { phone: "Valid BD mobile number din" } }, { status: 400 });
      data.phone = phone;
    }
    if (b.address !== undefined) {
      const address = String(b.address).trim().slice(0, 500);
      if (address.length < 10) return NextResponse.json({ error: "Full address din", errors: { address: "Full address din" } }, { status: 400 });
      data.address = address;
    }
    if (b.area !== undefined) data.area = b.area === "OUTSIDE_DHAKA" ? "OUTSIDE_DHAKA" : "INSIDE_DHAKA";
    if (b.isDefault === true) {
      await db.address.updateMany({ where: { customerId: s.id, isDefault: true }, data: { isDefault: false } });
      data.isDefault = true;
    }
    const updated = await db.address.update({ where: { id }, data });
    if (updated.isDefault) {
      await db.customer
        .update({ where: { id: s.id }, data: { address: updated.address, area: updated.area } })
        .catch(() => {});
    }
    return NextResponse.json({ ok: true, address: updated });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/* DELETE → remove an address (promote another one to default if needed) */
export async function DELETE(req: Request, { params }: Ctx) {
  const s = await getCustomerSessionFromRequest(req);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  try {
    await ensureExtraTables();
    const id = Number(params.id);
    const existing = await ownedAddress(s.id, id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.address.delete({ where: { id } });
    if (existing.isDefault) {
      const next = await db.address.findFirst({ where: { customerId: s.id }, orderBy: { id: "desc" } });
      if (next) await db.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
