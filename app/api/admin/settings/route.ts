import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { getSettings, saveGroup, envFallback } from "@/lib/settings";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const s = envFallback(await getSettings(true));
  // mask secrets for display (show last 4 chars)
  const mask = (v: string) => (v ? v.length > 8 ? "••••••••" + v.slice(-4) : "••••••" : "");
  const courier = { ...s.courier, apiKey: mask(s.courier?.apiKey || ""), secretKey: mask(s.courier?.secretKey || "") };
  const integrations = { ...s.integrations, metaAccessToken: mask(s.integrations?.metaAccessToken || "") };
  const notifications = {
    ...s.notifications,
    telegramBotToken: mask(s.notifications?.telegramBotToken || ""),
    smtp: { ...s.notifications?.smtp, pass: mask(s.notifications?.smtp?.pass || "") },
  };
  return NextResponse.json({ settings: { ...s, courier, integrations, notifications }, hasCourierKeys: !!s.courier?.apiKey, hasMetaToken: !!s.integrations?.metaAccessToken });
}
export async function PUT(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const { group, value } = await req.json();
  if (!group || typeof value !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  // merge with existing; masked/empty secrets keep old values
  const current = await getSettings(true);
  let merged: any;
  if (Array.isArray(value)) {
    merged = value; // arrays (e.g. homepage sections) replace wholesale
  } else {
    // numeric fields must be stored as numbers (string "2500" breaks comparisons)
    if (group === "shipping") {
      for (const k of ["insideDhaka", "outsideDhaka", "freeShippingThreshold"]) {
        if (value[k] !== undefined && value[k] !== "") value[k] = Number(value[k]) || 0;
      }
    }
    const existing: any = (current as any)[group] || {};
    merged = { ...existing };
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string" && v.startsWith("••")) continue; // masked — keep old
      (merged as any)[k] = v;
    }
  }
  await saveGroup(group, merged);
  await logAudit(g.user.email, "SETTINGS_UPDATED", group);
  return NextResponse.json({ ok: true });
}
