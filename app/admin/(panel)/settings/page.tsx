import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import { POLICY_DEFAULTS } from "@/lib/policy";
import { getSessionUser } from "@/lib/auth";
import SettingsClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: any }) {
  const user = await requireAdmin(searchParams);
  const s = envFallback(await getSettings(true));
  const courierCfg = {
    ...s.courier,
    apiKey: s.courier?.apiKey ? "••••••••" + s.courier.apiKey.slice(-4) : "",
    secretKey: s.courier?.secretKey ? "••••••••" + s.courier.secretKey.slice(-4) : "",
  };
  const hasCourier = !!(s.courier?.apiKey && s.courier?.secretKey);
  const userCount = await db.user.count();
  const collections = await db.collection.findMany({ select: { title: true, slug: true }, orderBy: { id: "asc" } });
  const notificationsCfg = {
    ...s.notifications,
    telegramBotToken: s.notifications?.telegramBotToken ? "••••••••" + s.notifications.telegramBotToken.slice(-4) : "",
    smtp: { ...s.notifications?.smtp, pass: s.notifications?.smtp?.pass ? "••••••••" + s.notifications.smtp.pass.slice(-2) : "" },
    sms: { ...s.notifications?.sms, apiKey: s.notifications?.sms?.apiKey ? "••••••••" + s.notifications.sms.apiKey.slice(-4) : "" },
  };
  return <SettingsClient user={user} userCount={userCount} hasCourier={hasCourier} collections={collections} groups={{
    store: s.store, theme: s.theme, shipping: s.shipping, homepage: s.homepage,
    checkout: s.checkout, fraud: s.fraud, seo: s.seo, maintenance: s.maintenance, courier: courierCfg,
    notifications: notificationsCfg, homeSections: s.homeSections,
    // defaults first, then whatever is stored — so a fresh install opens this tab showing the
    // real values the /returns page is already rendering instead of a wall of empty boxes
    policies: { ...POLICY_DEFAULTS, ...(s.policies || {}) },
  }} />;
}
