import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { ensureExtraTables } from "@/lib/db-ensure";
import { lockAbandoned, RecoveryError } from "@/lib/abandoned-cart";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function PUT(req: Request, props: Ctx) {
  const g = await requirePerm("marketing", req); if ("res" in g) return g.res;
  const id = Number((await props.params).id), body = await req.json().catch(() => null);
  if (!Number.isSafeInteger(id) || id <= 0 || !["OPEN", "RECOVERED"].includes(body?.status)) return NextResponse.json({ error: "Use OPEN or RECOVERED; conversion must create a real order" }, { status: 400 });
  try {
    await ensureExtraTables();
    await db.$transaction(async tx => {
      await lockAbandoned(tx, id);
      const row = await tx.abandonedCheckout.findUnique({ where: { id } });
      if (!row) throw new RecoveryError("Not found", 404);
      if (row.checkoutStatus === "CONVERTED" || row.convertedOrderId) throw new RecoveryError("A converted checkout cannot be reopened", 409);
      await tx.abandonedCheckout.update({ where: { id }, data: { checkoutStatus: body.status, recovered: body.status === "RECOVERED", updatedAt: new Date() } });
    });
    await logAudit(g.user.email, "ABANDONED_STATUS", `#${id} → ${body.status}`).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e instanceof RecoveryError ? e.message : "Could not update checkout" }, { status: e instanceof RecoveryError ? e.status : 500 }); }
}
export async function DELETE(req: Request, props: Ctx) {
  const g = await requirePerm("marketing", req); if ("res" in g) return g.res;
  const id = Number((await props.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid checkout" }, { status: 400 });
  await ensureExtraTables();
  const result = await db.abandonedCheckout.deleteMany({ where: { id } });
  if (!result.count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit(g.user.email, "ABANDONED_DELETE", `#${id}`).catch(() => {});
  return NextResponse.json({ ok: true });
}
