import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { notifyAdmin } from "@/lib/notify";
import { getSettings, envFallback } from "@/lib/settings";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const s = envFallback(await getSettings());
  const n = s.notifications || {};
  const telegramReady = !!(n.telegramBotToken && n.telegramChatId);
  const emailReady = !!(n.smtp?.host && n.smtp?.user && n.smtp?.pass && n.notifyEmail);
  const waReady = !!(n.waNotifyNumber && n.waEnabled !== false);
  if (!telegramReady && !emailReady && !waReady) {
    return NextResponse.json({ configured: false, error: "Telegram / SMTP / WhatsApp — kono ekta configure korun. (In-app bell always kaj kore)" }, { status: 400 });
  }
  const r = await notifyAdmin("test", "🔔 Test notification", "Connected channel theke real test — order notification ekhon apnar kache ashbe.", "TEST");
  const parts = [];
  if (telegramReady) parts.push("Telegram: " + (r.telegram ? "✓ pathano hoyeche" : "✗ fail"));
  if (emailReady) parts.push("Email: " + (r.email ? "✓ pathano hoyeche" : "✗ fail (SMTP login/check korun)"));
  if (waReady) parts.push("WhatsApp: " + (r.whatsapp ? "✓ pathano hoyeche" : "✗ fail (QR scan + bridge check korun)"));
  return NextResponse.json({ configured: true, ok: r.telegram !== false && r.email !== false && r.whatsapp !== false, detail: parts.join(" · ") });
}
