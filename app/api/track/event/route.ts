import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendCapi } from "@/lib/capi";
import { getSettings, envFallback } from "@/lib/settings";
import { getClientIp } from "@/lib/ua";
import { rateLimit } from "@/lib/auth";

export const dynamic = "force-dynamic";
// Receives browser events: logs them and forwards to Meta CAPI with the SAME event_id (dedup).
const EVENTS = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo", "Purchase", "Search", "Lead", "client-error"];
const MAX_BYTES = 16 * 1024; // an unbounded body used to be parsed before any check

export async function POST(req: Request) {
  try {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });
    const ip = getClientIp(req);
    if (!rateLimit("event:" + ip, 120, 60 * 1000)) {
      // answer 200 anyway: a throttled analytics call must never surface as a console error
      return NextResponse.json({ ok: true, throttled: true });
    }
    const raw = await req.text();
    if (raw.length > MAX_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });
    const { name, eventId, url, data, fbp, fbc, phone } = JSON.parse(raw || "{}");
    if (!name) return NextResponse.json({ error: "missing name" }, { status: 400 });
    // only known event names reach the DB, otherwise the table is a free write target
    if (!EVENTS.includes(String(name))) return NextResponse.json({ ok: true, ignored: true });
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
