import webpush from "web-push";
import { db } from "./db";
import { ensureExtraTables } from "./db-ensure";

/* Zero-config Web Push: VAPID keys are auto-generated on first use and stored
   in the Setting table — no env vars needed. Subscriptions are linked to a
   customer phone so order-status pushes reach the right devices. */

type Vapid = { publicKey: string; privateKey: string };
let vapidCache: Vapid | null = null;

export async function getVapid(): Promise<Vapid> {
  if (vapidCache) return vapidCache;
  await ensureExtraTables();
  const rows = await db.setting.findMany({ where: { key: { in: ["push_vapid_public", "push_vapid_private"] } } });
  let publicKey = rows.find((r) => r.key === "push_vapid_public")?.value;
  let privateKey = rows.find((r) => r.key === "push_vapid_private")?.value;
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    await db.setting.upsert({ where: { key: "push_vapid_public" }, update: { value: publicKey! }, create: { key: "push_vapid_public", value: publicKey! } });
    await db.setting.upsert({ where: { key: "push_vapid_private" }, update: { value: privateKey! }, create: { key: "push_vapid_private", value: privateKey! } });
  }
  vapidCache = { publicKey: publicKey!, privateKey: privateKey! };
  return vapidCache;
}

let subjectCache = "";
async function getSubject(): Promise<string> {
  if (subjectCache) return subjectCache;
  try {
    const s = await db.setting.findUnique({ where: { key: "store_url" } });
    if (s?.value && s.value.startsWith("https://")) subjectCache = s.value;
  } catch {}
  if (!subjectCache) {
    const envUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL;
    if (envUrl && (envUrl.startsWith("https://") || !envUrl.includes("://"))) {
      subjectCache = envUrl.startsWith("https://") ? envUrl : "https://" + envUrl;
    }
  }
  // web-push requires an https: or mailto: subject — never http
  if (!subjectCache) subjectCache = "mailto:sinzo.dot@gmail.com";
  return subjectCache;
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };

type Sub = { id: number; endpoint: string; p256dh: string; auth: string };

export async function sendPushToSubs(subs: Sub[], payload: PushPayload): Promise<{ sent: number; failed: number; removed: number }> {
  if (!subs.length) return { sent: 0, failed: 0, removed: 0 };
  const vapid = await getVapid();
  webpush.setVapidDetails(await getSubject(), vapid.publicKey, vapid.privateKey);
  let sent = 0;
  let failed = 0;
  const gone: number[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3 * 86400 });
        sent++;
      } catch (e: any) {
        failed++;
        const sc = e?.statusCode;
        if (sc === 404 || sc === 410) gone.push(s.id); // subscription expired on the browser side
      }
    })
  );
  if (gone.length) await db.pushSubscription.deleteMany({ where: { id: { in: gone } } }).catch(() => {});
  return { sent, failed, removed: gone.length };
}

export async function sendPushToPhones(phones: string[], payload: PushPayload) {
  const clean = [...new Set(phones.filter(Boolean))];
  if (!clean.length) return { sent: 0, failed: 0, removed: 0 };
  await ensureExtraTables().catch(() => {});
  const subs = await db.pushSubscription.findMany({ where: { phone: { in: clean } } });
  return sendPushToSubs(subs, payload);
}

export async function sendPushAll(payload: PushPayload) {
  await ensureExtraTables().catch(() => {});
  const subs = await db.pushSubscription.findMany({ select: { id: true, endpoint: true, p256dh: true, auth: true }, take: 2000 });
  return sendPushToSubs(subs, payload);
}
