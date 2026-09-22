import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { db } from "@/lib/db";
import { audienceRule, resolveAudience, audienceCsv, parseCsvPhones, WA_AUDIENCE_LABELS } from "@/lib/wa-audience";

export const dynamic = "force-dynamic";

/* Audience builder (Phase 3).
   POST { rule }                 → how many people this segment picks right now, why the rest were
                                    left out, and the first few names so the owner can sanity-check
   POST { rule, format: "csv" }  → the resolved list as a CSV download
   POST { csv: "…" }             → parse a pasted/uploaded CSV into a clean phone list */
export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => ({} as any));

  if (typeof b.csv === "string") {
    const parsed = parseCsvPhones(b.csv);
    return NextResponse.json({ ok: true, phones: parsed.phones, skipped: parsed.skipped, count: parsed.phones.length });
  }

  const rule = audienceRule(b.rule || b);
  const result = await resolveAudience(rule);

  if (b.format === "csv") {
    return new NextResponse(audienceCsv(result), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="wa-audience.csv"` },
    });
  }

  const waitlist = await db.waitlist.count().catch(() => 0);
  const optOuts = await db.waOptOut.count().catch(() => 0);
  const collections: { id: number; title: string }[] = await db.collection
    .findMany({ select: { id: true, title: true }, orderBy: { id: "asc" }, take: 50 })
    .catch(() => []);

  return NextResponse.json({
    ok: true,
    count: result.recipients.length,
    description: result.description,
    excluded: result.excluded,
    sample: result.recipients.slice(0, 8).map((r) => ({ to: r.to, name: r.name, orderId: r.orderId })),
    audienceTypes: WA_AUDIENCE_LABELS,
    stats: { waitlist, optOuts, collections },
  });
}
