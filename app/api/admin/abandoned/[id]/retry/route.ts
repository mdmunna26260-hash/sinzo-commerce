import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { ensureExtraTables } from "@/lib/db-ensure";
import { lockAbandoned, RecoveryError } from "@/lib/abandoned-cart";
import { recipientKeys } from "@/lib/recovery-security";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const g = await requirePerm("marketing", req); if ("res" in g) return g.res;
  const id = Number((await props.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid checkout" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (body?.confirmedProviderNotDelivered !== true) return NextResponse.json({ error: "Check provider logs and explicitly confirm no email was delivered" }, { status: 400 });
  try {
    await ensureExtraTables();
    await db.$transaction(async tx => {
      await lockAbandoned(tx, id);
      const row = await tx.abandonedCheckout.findUnique({ where: { id } });
      if (!row || row.checkoutStatus !== "OPEN" || row.recoveryEmailedAt || !row.recoveryAttemptedAt || (!row.recoveryError && Date.now() - row.recoveryAttemptedAt.getTime() < 5 * 60 * 1000)) throw new RecoveryError("This reminder cannot be retried", 409);
      if (row.email && row.phone) for (const key of recipientKeys(row.phone, row.email)) {
        const old = await tx.setting.findUnique({ where: { key } });
        let state: any = {}; try { state = JSON.parse(old?.value || "{}"); } catch {}
        // Never clear another checkout's recipient cooldown.
        if (state.id === id) await tx.setting.updateMany({ where: { key, value: old!.value }, data: { value: "{}" } });
      }
      await tx.abandonedCheckout.update({ where: { id }, data: { recoveryAttemptedAt: null, recoveryClaimId: null, recoveryError: null } });
    });
    await logAudit(g.user.email, "ABANDONED_RECOVERY_RETRY_APPROVED", String(id)).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof RecoveryError ? e.message : "Could not reset reminder" }, { status: e instanceof RecoveryError ? e.status : 500 });
  }
}
