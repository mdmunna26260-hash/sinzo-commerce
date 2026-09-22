import { requireAdmin } from "@/lib/auth";
import ScanClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scan to pack" };

/* Scan-to-pack station: scan a parcel's code, check the items, confirm, print the slip.
   The heavy lifting lives in /api/admin/scan so the same endpoint can be driven by a
   phone camera scanner later without touching this screen. */
export default async function ScanPage({ searchParams }: { searchParams: { t?: string } }) {
  const user = await requireAdmin(searchParams);
  return (
    <>
      <div className="admin-top">
        <div>
          <h1>Scan to pack</h1>
          <div className="who">packing station · {user.name}</div>
        </div>
        <a className="abtn" href="/admin/orders">All orders</a>
      </div>
      <ScanClient />
      <div className="cfg-note" style={{ marginTop: 16 }}>
        Scan (or type) the order code, the courier consignment id, or a plain order number. Scanning only looks
        the parcel up &mdash; nothing changes until you press <b>Confirm pack</b>. A packed parcel is stamped with your
        email and the time, so &ldquo;who packed this?&rdquo; has an answer. Print the slip from here to get a QR of the code
        that this screen can read back.
      </div>
    </>
  );
}
