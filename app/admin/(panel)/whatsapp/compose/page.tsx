import { requireAdmin } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import { waRules } from "@/lib/wa-queue";
import { waStatus } from "@/lib/wa";
import ComposeClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp — New message" };

/* Composer (Phase 2): write a message, attach up to 10 photos, drop in a product card + coupon and
   watch the exact text the customer will read. Sending goes through the outbox queue and runs one
   worker tick immediately, so the preview and the send share one code path. */
export default async function ComposePage(
  props: { searchParams: Promise<{ t?: string; to?: string; order?: string }> }
) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "settings");
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const s = envFallback(await getSettings());
  const rules = waRules(s);
  const status = await waStatus().catch(() => ({ running: false, connected: false, me: null as string | null }));

  return (
    <>
      <div className="admin-top">
        <div>
          <h1>New message</h1>
          <div className="who">
            text · ছবি · product card · coupon · {user.name} ·{" "}
            {status.connected ? `connected as ${status.me || "shop"}` : status.running ? "bridge running, not linked" : "bridge off"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="abtn" href="/admin/whatsapp">Broadcast &amp; Queue</a>
          <a className="abtn" href="/admin/inbox">Inbox</a>
          <a className="abtn" href="/admin/whatsapp/templates">Templates</a>
        </div>
      </div>
      <ComposeClient
        quick={rules.quickReplies || []}
        rules={{ couponCode: rules.couponCode, stopLine: rules.stopLine, testMode: rules.testMode, testNumber: rules.testNumber, enabled: rules.enabled }}
        initialTo={searchParams.to || ""}
        orderCode={searchParams.order || ""}
        waConnected={!!status.connected}
        bridgeRunning={!!status.running}
      />
    </>
  );
}
