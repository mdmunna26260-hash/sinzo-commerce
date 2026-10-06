import { requireAdmin } from "@/lib/auth";
import WaTemplates from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp templates" };

/* Event templates — what the customer actually reads.
   Each automatic event (order placed / confirmed / packed / shipped / delivered / cancelled) has
   its own switch and its own text; {variables} fill from the real order. */
export default async function WaTemplatesPage(props: { searchParams: Promise<{ t?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "settings");
  return (
    <>
      <div className="admin-top">
        <div>
          <h1>WhatsApp templates</h1>
          <div className="who">automatic order messages · {user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="abtn" href="/admin/whatsapp">Queue</a>
          <a className="abtn" href="/admin/whatsapp/devices">Devices</a>
        </div>
      </div>
      <WaTemplates />
      <div className="cfg-note" style={{ marginTop: 16 }}>
        Proti event-er alada switch — jeta off thakbe, oi message queue-tei jabe na (order confirm off korle baki gulo
        cholte thakbe). <code>{"{items}"}</code> order-er item list, <code>{"{link}"}</code> track link, <code>{"{coupon}"}</code>
        Settings → WhatsApp-r coupon — kono line-er variable khali thakle oi line-ta message theke bad jay.
      </div>
    </>
  );
}
