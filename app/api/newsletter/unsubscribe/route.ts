import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyUnsubscribe } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";

export const dynamic = "force-dynamic";

/* One-click unsubscribe.
   GET is the human link in the mail footer; POST is the RFC 8058 one-click that Gmail and
   Yahoo call straight from their own UI (List-Unsubscribe-Post header), which is why this
   endpoint must work without any body or session. Both need the signed `k`, so a third party
   cannot unsubscribe somebody else by guessing an address. */

async function handle(email: string | null, k: string | null, wantJson: boolean) {
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const addr = (email || "").trim().toLowerCase();
  const store = await (async () => {
    try { return envFallback(await getSettings()).store || {}; } catch { return {} as any; }
  })();
  const name = (store as any).name || "the store";

  if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) || !verifyUnsubscribe(addr, k)) {
    if (wantJson) return NextResponse.json({ ok: false, error: "Invalid unsubscribe link" }, { status: 400 });
    return new NextResponse(page(name, "This unsubscribe link is not valid.", "If the link was cut off by your mail app, reply to any of our emails and we will remove you by hand."), { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  /* Unsubscribing an address that never subscribed is not an error — the row is created as
     already-unsubscribed so a later import can't quietly add them back. */
  const already = await db.subscriber.findUnique({ where: { email: addr } });
  if (!already) {
    await db.subscriber.create({ data: { email: addr, unsubscribed: true, unsubscribedAt: new Date() } });
  } else if (!already.unsubscribed) {
    await db.subscriber.update({ where: { email: addr }, data: { unsubscribed: true, unsubscribedAt: new Date() } });
  }

  if (wantJson) return NextResponse.json({ ok: true });
  return new NextResponse(page(name, "You are unsubscribed.", `${addr} will not get any more newsletter emails from ${name}. Order and delivery emails are separate and will still arrive.`), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  return handle(u.searchParams.get("e"), u.searchParams.get("k"), false);
}

export async function POST(req: Request) {
  const u = new URL(req.url);
  let email = u.searchParams.get("e");
  let k = u.searchParams.get("k");
  if (!email) {
    // one-click clients may post the address in the body instead of the query string
    const body = await req.text().catch(() => "");
    const p = new URLSearchParams(body);
    email = email || p.get("e") || p.get("email");
    k = k || p.get("k");
  }
  return handle(email, k, !(req.headers.get("list-unsubscribe") || req.headers.get("content-type") || "").includes("text/html"));
}

const page = (store: string, title: string, note: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · ${store}</title></head>
<body style="margin:0;background:#faf9f7;color:#141414;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:64px 24px;text-align:center">
  <div style="font-size:19px;letter-spacing:.28em;border-bottom:2px solid #141414;padding-bottom:12px;display:inline-block">${esc(store)}</div>
  <h1 style="font-size:26px;margin:32px 0 12px;font-weight:600">${title}</h1>
  <p style="font-size:14px;line-height:1.8;color:#5c5852">${note}</p>
  <p style="margin-top:28px"><a href="/" style="display:inline-block;background:#141414;color:#fff;text-decoration:none;padding:14px 30px;font-size:12px;letter-spacing:.14em;text-transform:uppercase">Back to the store</a></p>
</div></body></html>`;

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
