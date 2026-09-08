import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import { sendAbandonedRecoveryEmails } from "@/lib/abandoned-recovery";
export const dynamic = "force-dynamic";

/* Abandoned cart recovery.
   POST /api/admin/abandoned-recover          → run recovery pass now (admin)
   GET  /api/admin/abandoned-recover?token=…  → same (external cron friendly)
   Sends ONE recovery email per abandoned checkout (skips already-contacted),
   older than 45 minutes, still OPEN, has email+phone+name. */
async function run(req: Request, adminEmail?: string) {
  const s = envFallback(await getSettings());
  const n = s.notifications || {};
  const emailReady = !!(n.smtp?.host && n.smtp?.user && n.smtp?.pass);
  if (!emailReady) return NextResponse.json({ error: "SMTP not configured (Settings → Notifications)" }, { status: 400 });

  const result = await sendAbandonedRecoveryEmails();
  if (adminEmail) await logAudit(adminEmail, "ABANDONED_RECOVERY_RUN", `sent: ${result.sent}, skipped: ${result.skipped}`);
  return NextResponse.json({ ok: true, ...result, coupon: s.marketing?.recoveryCoupon || null });
}

export async function POST(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  return run(req, g.user.email);
}

export async function GET(req: Request) {
  return run(req);
}
