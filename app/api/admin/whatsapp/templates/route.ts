import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { db } from "@/lib/db";
import { getSettings, envFallback } from "@/lib/settings";
import { waTemplates, waRules, WA_EVENTS, WA_TEMPLATE_DEFAULTS, renderTemplate, sampleVars, siteUrl, WA_MEDIA_MODES, WA_MEDIA_MAX } from "@/lib/wa-queue";
import { logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";

/* WhatsApp message templates = the automatic events (order placed / confirmed / packed / shipped /
   delivered / cancelled). One row per event: `enabled` is that event's switch, `body` is what the
   customer reads, `mediaMode` decides whether the product photo rides along. */

export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  const s = envFallback(await getSettings());
  const rules = waRules(s);
  const rows = await waTemplates();
  const vars = sampleVars(s, rules);
  const events = WA_EVENTS.map((key) => {
    const row = rows.find((r) => r.key === key);
    return {
      key,
      name: row?.name || key,
      category: row?.category || "UTILITY",
      body: row?.body || "",
      mediaMode: row?.mediaMode || "NONE",
      enabled: row?.enabled !== false,
      updatedAt: row?.updatedAt || null,
      defaults: WA_TEMPLATE_DEFAULTS.find((d) => d.key === key)?.body || "",
      preview: row ? renderTemplate(row.body, vars) : "",
    };
  });
  return NextResponse.json({
    events,
    variables: ["{name}", "{code}", "{amount}", "{items}", "{payment}", "{eta}", "{area}", "{link}", "{tracking}", "{courier}", "{coupon}", "{product}", "{review}", "{site}"],
    mediaModes: WA_MEDIA_MODES,
    maxImages: WA_MEDIA_MAX,
    siteUrl: siteUrl(s),
    rules: { enabled: rules.enabled, stopLine: rules.stopLine, couponCode: rules.couponCode },
  });
}

export async function PUT(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const b = await req.json().catch(() => ({} as any));
  const key = String(b.key || "");
  if (!WA_EVENTS.includes(key as any)) return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  await waTemplates(); // make sure the row exists

  const data: any = {};
  if (typeof b.body === "string") {
    const body = b.body.slice(0, 4000);
    if (!body.trim()) return NextResponse.json({ error: "Message body khali rakha jabe na" }, { status: 400 });
    data.body = body;
  }
  if (typeof b.enabled === "boolean") data.enabled = b.enabled;
  if (WA_MEDIA_MODES.includes(String(b.mediaMode) as any)) data.mediaMode = String(b.mediaMode);
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim().slice(0, 80);
  if (typeof b.resetToDefault === "boolean" && b.resetToDefault) {
    const def = WA_TEMPLATE_DEFAULTS.find((d) => d.key === key);
    if (def) data.body = def.body;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const row = await db.waTemplate.update({ where: { key }, data });
  await logAudit(g.user.email, "WA_TEMPLATE_SAVE", `${key}${data.enabled !== undefined ? ` enabled=${data.enabled}` : ""}${data.body ? " body updated" : ""}`);
  return NextResponse.json({ ok: true, template: { key: row.key, name: row.name, body: row.body, enabled: row.enabled, mediaMode: row.mediaMode } });
}
