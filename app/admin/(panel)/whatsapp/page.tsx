import { requireAdmin } from "@/lib/auth";
import WaHub from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp" };

/* WhatsApp hub — the queue, the delivery rules and the health of the 2–3 numbers.
   Everything the panel shows comes from the store's own tables + the local bridge; the browser
   never talks to WhatsApp. Messages leave only through scripts/wa-worker.js → bridge. */
export default async function WhatsAppPage({ searchParams }: { searchParams: { t?: string } }) {
  const user = await requireAdmin(searchParams);
  return (
    <>
      <div className="admin-top">
        <div>
          <h1>WhatsApp</h1>
          <div className="who">queue · devices · delivery rules · {user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="abtn" href="/admin/whatsapp/templates">Templates</a>
          <a className="abtn" href="/admin/whatsapp/devices">Devices</a>
          <a className="abtn" href="/admin/inbox">Inbox</a>
        </div>
      </div>
      <WaHub />
      <div className="cfg-note" style={{ marginTop: 16 }}>
        Kono message web request-er vitore jay na — order hole row <b>queue</b>-te joma hoy, ar
        <code> npm run wa:worker </code> seta cap/quiet-hours/pace mene pathay. VPS-e duita process chalate hobe:
        <code> pm2 start scripts/whatsapp-bridge.js --name sinzo-wa-bridge </code> ar
        <code> pm2 start scripts/wa-worker.js --name sinzo-wa-worker</code>.
      </div>
    </>
  );
}
