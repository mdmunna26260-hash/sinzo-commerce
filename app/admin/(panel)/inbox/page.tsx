import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { waStatus } from "@/lib/wa";
import { getSettings, envFallback } from "@/lib/settings";
import { waRules } from "@/lib/wa-queue";
import InboxClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp Inbox" };

/* WhatsApp inbox.
   The bridge (npm run wa) forwards every customer message here: it lands in the panel, links to
   the customer's order when the number matches, and can be answered from the same thread. No
   third-party inbox, no per-message fee — the shop's own number, on the shop's own screen. */
export default async function InboxPage({ searchParams }: { searchParams: { t?: string } }) {
  const user = await requireAdmin(searchParams);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const recent = await db.inboxMessage.findMany({ orderBy: { id: "desc" }, take: 500 });
  const map = new Map<string, any>();
  for (const m of recent) {
    const c = map.get(m.waId) || { waId: m.waId, name: m.name, last: m.body, lastAt: m.createdAt.toISOString(), lastDirection: m.direction, count: 0, inbound: 0, orderId: null };
    c.count++;
    if (m.direction === "IN") c.inbound++;
    if (!c.name && m.name) c.name = m.name;
    if (!c.orderId && m.orderId) c.orderId = m.orderId;
    map.set(m.waId, c);
  }
  const list = Array.from(map.values()).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  const orderIds = Array.from(new Set(list.map((c) => c.orderId).filter(Boolean)));
  const orders = await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, code: true, name: true, status: true } });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const status = await waStatus().catch(() => ({ running: false, connected: false, me: null as string | null }));
  const s = envFallback(await getSettings());
  const rules = waRules(s);

  return (
    <>
      <div className="admin-top">
        <div><h1>WhatsApp Inbox</h1><div className="who">{list.length} conversation{list.length === 1 ? "" : "s"} · {status.connected ? `connected as ${status.me || "shop"}` : status.running ? "bridge running, not linked" : "bridge off"} · {user.name}</div></div>
        <a className="abtn" href="/admin/marketing">WhatsApp settings</a>
      </div>
      <InboxClient
        initialConversations={list.map((c) => ({ ...c, order: c.orderId ? byId.get(c.orderId) || null : null }))}
        status={status}
        autoReply={(s as any).notifications?.waAutoReply || ""}
        quick={rules.quickReplies || []}
        couponCode={rules.couponCode || ""}
        stopLine={rules.stopLine !== false}
      />
      <div className="cfg-note" style={{ marginTop: 16 }}>
        Bridge chalu korte server-e: <code>WA_BRIDGE_PORT=3005 npm run wa</code> (ba port 3001 free thakle shudhu
        <code> npm run wa</code>). First bar admin → Marketing-e QR scan kore phone link korun. Inbound message
        ashle <b>x-bridge-key</b> hobe <code>WA_BRIDGE_KEY</code> (default <code>local-bridge</code>), ar
        <code> WA_APP_URL</code> diye site er URL (default http://127.0.0.1:3000). Auto-reply text Settings →
        Notifications-e bosano jay — prothom message-ei pathanor jonno.
      </div>
    </>
  );
}
