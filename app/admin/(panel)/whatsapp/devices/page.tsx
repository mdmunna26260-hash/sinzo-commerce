import { requireAdmin } from "@/lib/auth";
import WaDevices from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp devices" };

/* Device manager — the 2–3 phone numbers.
   Pair by QR, watch today's usage against the daily cap, pause a number that misbehaves, and see
   immediately when WhatsApp drops one (the bridge pushes state here; no refresh dance needed). */
export default async function WaDevicesPage(props: { searchParams: Promise<{ t?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "settings");
  return (
    <>
      <div className="admin-top">
        <div>
          <h1>WhatsApp devices</h1>
          <div className="who">2–3 numbers · QR pairing · daily caps · {user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="abtn" href="/admin/whatsapp">Queue</a>
          <a className="abtn" href="/admin/whatsapp/templates">Templates</a>
        </div>
      </div>
      <WaDevices />
      <div className="cfg-note" style={{ marginTop: 16 }}>
        Ekta number-e <b>ekbar-i</b> QR scan korte hoy — session file VPS-e <code>.wa-auth/&lt;sessionId&gt;/</code> te thake
        (repo-te kokhono jay na), tai restart korleo abar scan lagbe na. Notun number-e prothom soptaho cap chhoto rakhen
        (50/day) — ekbar number &ldquo;warm&rdquo; hoye gele stage barie 150 → 300 → 400 korte paren.
      </div>
    </>
  );
}
