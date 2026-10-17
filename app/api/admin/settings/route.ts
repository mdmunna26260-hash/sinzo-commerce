import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { getSettings, saveGroup, envFallback } from "@/lib/settings";
import { logAudit } from "@/lib/auth";
import { maskAdminSettings, mergeSettingsValue, SETTING_GROUPS } from "@/lib/settings-values";
import { MAX_HERO_SLIDES, sanitizeHeroSlides } from "@/lib/home-hero";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const settings = envFallback(await getSettings(true));
  if (settings.checkout) delete settings.checkout.giftWrapFee;
  return NextResponse.json({ settings: maskAdminSettings(settings), hasCourierKeys: !!(settings.courier?.apiKey && settings.courier?.secretKey), hasMetaToken: !!settings.integrations?.metaAccessToken });
}

export async function PUT(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const body = await req.json().catch(() => null);
  if (!body || !SETTING_GROUPS.has(body.group) || !body.value || typeof body.value !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const { group, value } = body;
  if ((group === "homeSections") !== Array.isArray(value)) return NextResponse.json({ error: "Invalid settings value" }, { status: 400 });

  const numericFields = group === "shipping" ? ["insideDhaka", "outsideDhaka", "freeShippingThreshold"] : [];
  for (const key of numericFields) {
    if (value[key] === undefined) continue;
    const amount = Number(value[key]);
    if (value[key] === null || value[key] === "" || !["number", "string"].includes(typeof value[key]) || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: `${key} must be a non-negative number` }, { status: 400 });
    }
    value[key] = amount;
  }
  if (group === "homepage" && Object.prototype.hasOwnProperty.call(value, "heroSlides")) {
    if (!Array.isArray(value.heroSlides) || value.heroSlides.length > MAX_HERO_SLIDES) {
      return NextResponse.json({ error: `Hero carousel supports up to ${MAX_HERO_SLIDES} slides` }, { status: 400 });
    }
    const slides = sanitizeHeroSlides(value.heroSlides, true);
    if (slides.length !== value.heroSlides.length) {
      return NextResponse.json({ error: "Every hero slide needs a valid desktop image" }, { status: 400 });
    }
    value.heroSlides = slides;
  }
  if (group === "marketing") {
    if (value.recoveryAutoEnabled !== undefined && typeof value.recoveryAutoEnabled !== "boolean") return NextResponse.json({ error: "Recovery automation must be a boolean" }, { status: 400 });
    if (value.recoveryCoupon !== undefined && (typeof value.recoveryCoupon !== "string" || value.recoveryCoupon.length > 64 || /[\r\n]/.test(value.recoveryCoupon))) return NextResponse.json({ error: "Invalid recovery coupon" }, { status: 400 });
  }
  const current = await getSettings(true);
  const merged = mergeSettingsValue(current[group], value);
  if (group === "checkout") delete merged.giftWrapFee;
  if (group === "integrations" && (value.metaTestEventCode === "" || value.metaTestEventCode === "-" || value.metaTestEventCode === null)) delete merged.metaTestEventCode;
  await saveGroup(group, merged);
  await logAudit(g.user.email, "SETTINGS_UPDATED", group);
  return NextResponse.json({ ok: true });
}
