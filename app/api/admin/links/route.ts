import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { getSettings, saveGroup } from "@/lib/settings";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";

/* UTM campaign-link builder storage.
   Saved links live in the settings group "links" (a JSON array) instead of their own table:
   they are a handful of strings, and this keeps the schema unchanged. */
export async function GET(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const s = (await getSettings()) as any;
  return NextResponse.json({ ok: true, saved: s.links?.saved || [] });
}

export async function POST(req: Request) {
  const g = await requirePerm("marketing", req);
  if ("res" in g) return g.res;
  const b = await req.json().catch(() => ({}));
  const current = (await getSettings(true) as any).links || {};
  const saved: any[] = Array.isArray(current.saved) ? current.saved : [];

  if (b.action === "delete") {
    const next = saved.filter((l) => l.url !== b.url);
    await saveGroup("links", { ...current, saved: next });
    await logAudit(g.user.email, "LINK_DELETED", String(b.url).slice(0, 200));
    return NextResponse.json({ ok: true, saved: next });
  }

  const url = String(b.url || "").trim();
  const name = String(b.name || "").trim().slice(0, 80) || url.slice(0, 80);
  if (!/^https?:\/\//.test(url)) return NextResponse.json({ error: "URL must start with http(s)://" }, { status: 400 });
  let parsed: URL;
  try { parsed = new URL(url); } catch { return NextResponse.json({ error: "That URL is not valid" }, { status: 400 }); }
  if (!parsed.searchParams.get("utm_source") || !parsed.searchParams.get("utm_campaign")) {
    return NextResponse.json({ error: "utm_source ar utm_campaign dorkar — nahole Google Analytics e campaign alada kore dekha jabe na." }, { status: 400 });
  }
  const next = [{ name, url, at: new Date().toISOString() }, ...saved.filter((l) => l.url !== url)].slice(0, 100);
  await saveGroup("links", { ...current, saved: next });
  await logAudit(g.user.email, "LINK_SAVED", url.slice(0, 200));
  return NextResponse.json({ ok: true, saved: next });
}
