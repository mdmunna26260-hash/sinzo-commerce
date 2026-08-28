import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const { status } = await req.json();
  if (!["OPEN", "RECOVERED", "CONVERTED"].includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const data: any = { checkoutStatus: status };
  if (status !== "OPEN") data.recovered = true;
  const row = await db.abandonedCheckout.update({ where: { id: Number(params.id) }, data });
  await logAudit(g.user.email, "ABANDONED_STATUS", `#${params.id} → ${status}`);
  return NextResponse.json({ ok: true, checkout: row });
}
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  await db.abandonedCheckout.delete({ where: { id: Number(params.id) } });
  await logAudit(g.user.email, "ABANDONED_DELETE", `#${params.id}`);
  return NextResponse.json({ ok: true });
}
