import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
import { logApp } from "@/lib/logs";
export const dynamic = "force-dynamic";

/* Public "notify me when it's back" endpoint.
   Sold-out products normally just dead-end; this turns the visitor into a contact we can
   message when stock returns. Rate-limited per IP so the list cannot be spammed. */
export async function POST(req: Request) {
  try {
    if (!rateLimit("waitlist:" + getClientIp(req), 12, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many requests — please try again later." }, { status: 429 });
    }
    const b = await req.json().catch(() => ({}));
    const productId = Number(b.productId);
    const contact = String(b.contact || "").trim().slice(0, 120);
    const note = b.note ? String(b.note).slice(0, 300) : null;
    const variantId = b.variantId ? Number(b.variantId) : null;
    if (!productId) return NextResponse.json({ error: "Missing product" }, { status: 400 });
    if (contact.replace(/\D/g, "").length < 10 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      return NextResponse.json({ error: "Valid phone number ba email din." }, { status: 400 });
    }
    const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, title: true } });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    const existing = await db.waitlist.findFirst({ where: { productId, contact, variantId } });
    if (existing) return NextResponse.json({ ok: true, duplicate: true, message: "Apni already list-e achen — stock ele janabo." });
    const row = await db.waitlist.create({ data: { productId, variantId, contact, note } });
    await logApp("INFO", "WEBHOOK", `waitlist signup: ${product.title} ← ${contact}`, { productId, waitlistId: row.id });
    const { notifyAdmin } = await import("@/lib/notify");
    notifyAdmin("waitlist", `⏳ Waitlist: ${product.title}`, `${contact} wants this back in stock${note ? " — " + note : ""}`, "product:" + productId).catch(() => {});
    return NextResponse.json({ ok: true, message: "Done! Stock ele apnake janabo." });
  } catch {
    return NextResponse.json({ error: "Could not save — try again." }, { status: 500 });
  }
}
