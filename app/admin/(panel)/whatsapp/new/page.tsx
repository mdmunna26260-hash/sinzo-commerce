import { requireAdmin } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import { waRules } from "@/lib/wa-queue";
import { waStatus } from "@/lib/wa";
import { db } from "@/lib/db";
import NewCampaignClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp — New campaign" };

/* Campaign composer (Phase 3, plan §8).
   Write the offer, attach photos / product cards / coupon, then build the audience on the right with
   a live count — and only then start it (now or on a schedule). Nothing is sent from this page:
   starting a campaign freezes the audience and lets the worker pace the messages out. */
export default async function NewCampaignPage({ searchParams }: { searchParams: { t?: string } }) {
  const user = await requireAdmin(searchParams);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const s = envFallback(await getSettings());
  const rules = waRules(s);
  const status = await waStatus().catch(() => ({ running: false, connected: false }) as any);
  const devices = await db.waDevice.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, status: true, phone: true, sentToday: true, dailyCap: true } }).catch(() => []);
  const optOuts = await db.waOptOut.count().catch(() => 0);

  return (
    <>
      <div className="admin-top">
        <div>
          <h1>New campaign</h1>
          <div className="who">
            broadcast · audience builder · schedule · {user.name} ·{" "}
            {status.connected ? `connected as ${status.me || "shop"}` : status.running ? "bridge running, not linked" : "bridge off"} ·{" "}
            {optOuts} opted out
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="abtn" href="/admin/whatsapp">Broadcast &amp; Queue</a>
          <a className="abtn" href="/admin/whatsapp/compose">Single message</a>
          <a className="abtn" href="/admin/whatsapp/templates">Templates</a>
        </div>
      </div>
      <NewCampaignClient
        quick={rules.quickReplies || []}
        rules={{ couponCode: rules.couponCode, stopLine: rules.stopLine, testMode: rules.testMode, testNumber: rules.testNumber, enabled: rules.enabled, quietFrom: rules.quietFrom, quietTo: rules.quietTo, fallbackHours: rules.fallbackHours, smsFallback: rules.smsFallback }}
        devices={devices.map((d) => ({ id: d.id, name: d.name, status: d.status, phone: d.phone, sentToday: d.sentToday, dailyCap: d.dailyCap }))}
        optOuts={optOuts}
        bridgeRunning={!!status.running}
      />
    </>
  );
}
