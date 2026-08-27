import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import TrackingClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tracking" };
export default async function TrackingPage({ searchParams }: { searchParams: any }) {
  await requireAdmin(searchParams);
  const s = envFallback(await getSettings(true));
  const events = await db.trackingEvent.findMany({ orderBy: { id: "desc" }, take: 40 });
  const counts = await db.trackingEvent.groupBy({ by: ["name"], _count: { _all: true } });
  const cfg = {
    metaPixelId: s.integrations?.metaPixelId || "",
    hasMetaToken: !!s.integrations?.metaAccessToken,
    testEventCode: s.integrations?.metaTestEventCode || "",
    ga4Id: s.integrations?.ga4Id || "",
    gtmId: s.integrations?.gtmId || "",
  };
  const last = events[0];
  return <TrackingClient cfg={cfg} events={events.map((e) => ({ id: e.id, name: e.name, eventId: e.eventId, source: e.source, ok: e.ok, error: e.error, createdAt: e.createdAt.toISOString() }))}
    counts={counts.map((c) => ({ name: c.name, count: c._count._all }))}
    lastEvent={last ? { name: last.name, at: last.createdAt.toISOString(), ok: last.ok } : null} />;
}
