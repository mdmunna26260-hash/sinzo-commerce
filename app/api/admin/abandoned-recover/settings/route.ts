import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { getSettings, saveGroup } from "@/lib/settings";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
// Marketing staff may configure this flow, not unrelated store/SMTP secrets.
export async function PUT(req: Request) {
  const g = await requirePerm("marketing", req); if ("res" in g) return g.res;
  const body = await req.json().catch(() => null);
  const value = body?.value;
  if (!value || Array.isArray(value) || typeof value.recoveryCoupon !== "string" || value.recoveryCoupon.length > 64 || /[\r\n]/.test(value.recoveryCoupon) || typeof value.recoveryAutoEnabled !== "boolean") return NextResponse.json({ error: "Invalid recovery settings" }, { status: 400 });
  const s = await getSettings(true);
  await saveGroup("marketing", { ...(s.marketing || {}), recoveryCoupon: value.recoveryCoupon.trim().toUpperCase(), recoveryAutoEnabled: value.recoveryAutoEnabled });
  await logAudit(g.user.email, "RECOVERY_SETTINGS_UPDATED", "marketing").catch(() => {});
  return NextResponse.json({ ok: true });
}
