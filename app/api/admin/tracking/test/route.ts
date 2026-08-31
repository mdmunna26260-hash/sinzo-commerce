import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { sendCapi } from "@/lib/capi";
export const dynamic = "force-dynamic";
// Sends a real test Purchase event to Meta CAPI using the configured Test Event Code.
export async function POST(req: Request) {
  const g = await requirePerm("tracking", req);
  if ("res" in g) return g.res;
  const r = await sendCapi({
    eventName: "Purchase", eventId: "test_" + Date.now().toString(36),
    userData: {
      // Meta requires (and recommends) customer-information params —
      // without any, the API rejects with "Invalid parameter" (subcode 2804050)
      phone: "01876543210",
      clientIp: "103.108.144.10",
      userAgent: req.headers.get("user-agent") || "Mozilla/5.0 (compatible; SINZO-test/1.0)",
    },
    customData: { currency: "BDT", value: 1000, content_type: "product", contents: [{ id: "test", quantity: 1, item_price: 1000 }] },
  });
  return NextResponse.json(r, { status: r.configured ? (r.ok ? 200 : 502) : 400 });
}
