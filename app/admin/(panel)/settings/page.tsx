import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
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
  const notificationsCfg = {
    ...s.notifications,
    telegramBotToken: s.notifications?.telegramBotToken ? "••••••••" + s.notifications.telegramBotToken.slice(-4) : "",
    smtp: { ...s.notifications?.smtp, pass: s.notifications?.smtp?.pass ? "••••••••" + s.notifications.smtp.pass.slice(-2) : "" },
  };
  return <SettingsClient user={user} userCount={userCount} hasCourier={hasCourier} groups={{
    store: s.store, theme: s.theme, shipping: s.shipping, homepage: s.homepage,
    checkout: s.checkout, fraud: s.fraud, seo: s.seo, maintenance: s.maintenance, courier: courierCfg,
    notifications: notificationsCfg,
  }} />;
}
