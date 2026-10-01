import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import { POLICY_DEFAULTS } from "@/lib/policy";
import { maskAdminSettings } from "@/lib/settings-values";
import SettingsClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  const user = await requireAdmin(searchParams, "settings");
  const raw = envFallback(await getSettings(true));
  const s = maskAdminSettings(raw);
  const courierCfg = s.courier;
  const notificationsCfg = s.notifications;
  const hasCourier = !!(raw.courier?.apiKey && raw.courier?.secretKey);
  const userCount = await db.user.count();
  const collections = await db.collection.findMany({ select: { title: true, slug: true }, orderBy: { id: "asc" } });
  return <SettingsClient user={user} userCount={userCount} hasCourier={hasCourier} collections={collections} groups={{
    store: s.store, theme: s.theme, shipping: s.shipping, homepage: s.homepage,
    checkout: s.checkout, fraud: s.fraud, seo: s.seo, maintenance: s.maintenance, courier: courierCfg,
    notifications: notificationsCfg, integrations: s.integrations, homeSections: s.homeSections,
    // defaults first, then whatever is stored — so a fresh install opens this tab showing the
    // real values the /returns page is already rendering instead of a wall of empty boxes
    policies: { ...POLICY_DEFAULTS, ...(s.policies || {}) },
  }} />;
}
