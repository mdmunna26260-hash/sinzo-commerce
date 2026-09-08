import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createMediaWithVariants } from "@/lib/media-store";
import { rateLimit } from "@/lib/auth";
import { getClientIp } from "@/lib/ua";
export const dynamic = "force-dynamic";
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/* Review photo upload — public, but heavily guarded:
   - rate limited per IP (10/hour)
   - 5MB max, images only
   - images land in Media as UNLINKED rows; they only become visible when an
     admin approves the review that references them (Review.photos). */
export async function POST(req: Request) {
  if (!rateLimit("revup:" + getClientIp(req), 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many uploads. Try later." }, { status: 429 });
  }
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Only JPG/PNG/WebP allowed" }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Max 5MB per photo" }, { status: 400 });
    const { primaryId } = await createMediaWithVariants(Buffer.from(await file.arrayBuffer()), file.type);
    return NextResponse.json({ ok: true, url: "/api/media/" + primaryId });
  } catch { return NextResponse.json({ error: "Upload failed" }, { status: 500 }); }
}
