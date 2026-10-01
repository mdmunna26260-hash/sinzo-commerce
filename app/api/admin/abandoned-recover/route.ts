import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { sendAbandonedRecoveryEmails } from "@/lib/abandoned-recovery";
import { isRecoveryCron } from "@/lib/recovery-security";
export const dynamic = "force-dynamic";

async function run(automatic: boolean, actor?: string) {
  try {
    const result = await sendAbandonedRecoveryEmails({ automatic });
    if (actor) await logAudit(actor, "ABANDONED_RECOVERY_RUN", `sent:${result.sent}, skipped:${result.skipped}, failed:${result.failed}`).catch(() => {});
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e: any) {
    const smtp = e?.message?.startsWith("SMTP not configured");
    return NextResponse.json({ error: smtp ? e.message : "Recovery job failed; check server logs" }, { status: smtp ? 400 : 500 });
  }
}
export async function POST(req: Request) {
  if (isRecoveryCron(req)) return run(true);
  const g = await requirePerm("marketing", req); if ("res" in g) return g.res;
  return run(false, g.user.email);
}
// No public GET, URL secrets, or cookie-authenticated state-changing GET.
// Cron callers must supply a strong runtime CRON_SECRET in Authorization.
export async function GET(req: Request) {
  if (!isRecoveryCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run(true);
}
