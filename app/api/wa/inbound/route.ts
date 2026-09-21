import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { waSend } from "@/lib/wa";
import { getSettings, envFallback } from "@/lib/settings";
import { logApp } from "@/lib/logs";
export const dynamic = "force-dynamic";

/* Inbound WhatsApp webhook — called by the local bridge (scripts/whatsapp-bridge.js) when a
   customer messages the shop number. The bridge key is checked against the same value the
   bridge sends, so an open endpoint cannot be used to stuff the inbox. */
function bridgeKey(): string {
  return process.env.WA_BRIDGE_KEY || "local-bridge";
}
/** 8801676450711 → 01676450711 (how phone numbers are stored on orders). */
function toLocal(waId: string): string {
  const d = String(waId || "").replace(/\D/g, "");
  if (d.startsWith("880")) return "0" + d.slice(3);
  return d;
}

export async function POST(req: Request) {
  let allowed = bridgeKey();
  try {
    const s = envFallback(await getSettings());
    const configured = (s as any).notifications?.waBridgeKey;
    if (configured) allowed = configured;
  } catch {}
  if ((req.headers.get("x-bridge-key") || "") !== allowed) {
    return NextResponse.json({ error: "bad bridge key" }, { status: 401 });
  }

  const b = await req.json().catch(() => ({}));
  const waId = String(b.waId || "").replace(/\D/g, "");
  const body = String(b.body || "").trim();
  if (!waId || !body) return NextResponse.json({ error: "waId and body required" }, { status: 400 });

  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});

  // link to an order when this number has one
  const local = toLocal(waId);
  const order = await db.order.findFirst({ where: { phone: local }, orderBy: { id: "desc" }, select: { id: true, code: true, name: true } });

  const firstEver = (await db.inboxMessage.count({ where: { waId } })) === 0;
  const row = await db.inboxMessage.create({
    data: { waId, name: b.name ? String(b.name).slice(0, 80) : null, direction: "IN", body: body.slice(0, 4000), orderId: order?.id ?? null, status: "ok" },
  });
  await logApp("INFO", "WHATSAPP", `inbound from ${local}${order ? ` (${order.code})` : ""}: ${body.slice(0, 80)}`, { waId, inboxId: row.id });

  const { notifyAdmin } = await import("@/lib/notify");
  notifyAdmin("inbox", `💬 WhatsApp: ${order?.name || b.name || local}`,
    body.slice(0, 160) + (order ? ` · ${order.code}` : " · kono order nai"), order?.code || local).catch(() => {});

  /* Optional greeting: only the very first message from a number, and only if the owner wrote
     one in Settings. Sending it is best-effort — an unlinked bridge must not 500 the webhook. */
  let autoReplied = false;
  try {
    const s = envFallback(await getSettings());
    const greeting = (s as any).notifications?.waAutoReply;
    if (firstEver && greeting && String(greeting).trim()) {
      const text = String(greeting).replace(/\{name\}/g, b.name || "apni").slice(0, 1000);
      const r = await waSend(waId, text);
      if (r.ok) {
        await db.inboxMessage.create({ data: { waId, name: null, direction: "OUT", body: text, orderId: order?.id ?? null, status: "ok" } });
        autoReplied = true;
      }
    }
  } catch {}

  return NextResponse.json({ ok: true, id: row.id, linkedOrder: order?.code || null, autoReplied });
}
