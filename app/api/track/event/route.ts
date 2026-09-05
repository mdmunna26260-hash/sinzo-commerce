import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendCapi } from "@/lib/capi";
import { getSettings, envFallback } from "@/lib/settings";
import { getClientIp } from "@/lib/ua";

export const dynamic = "force-dynamic";
// Receives browser events: logs them and forwards to Meta CAPI with the SAME event_id (dedup).
export async function POST(req: Request) {
  try {
    const { name, eventId, url, data, fbp, fbc, phone } = await req.json();
    if (!name) return NextResponse.json({ error: "missing name" }, { status: 400 });
    const s = envFallback(await getSettings());
    const pixel = s.integrations?.metaPixelId;
    const token = s.integrations?.metaAccessToken;
    const ua = req.headers.get("user-agent") || undefined;
    let capi: any = { configured: false };
    if (pixel && token && ["ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo", "Purchase", "Search", "Lead"].includes(name)) {
      capi = await sendCapi({
        eventName: name, eventId: eventId || `srv_${Date.now().toString(36)}`,
        eventSourceUrl: url, userData: { clientIp: getClientIp(req), userAgent: ua, fbp, fbc, phone: phone || undefined, externalId: phone || undefined },
        customData: data ? { currency: data.currency || "BDT", value: data.value, content_type: data.content_type, content_ids: data.content_ids, contents: data.contents, search_string: data.search_string } : undefined,
      });
    }
    await db.trackingEvent.create({ data: { name, eventId: eventId || null, source: "browser", payload: JSON.stringify(data || {}), ok: capi.configured ? !!capi.ok : true, error: capi.configured ? capi.error : null } }).catch(() => {});
    return NextResponse.json({ ok: true, capi });
  } catch { return NextResponse.json({ ok: false }, { status: 200 }); }
}
