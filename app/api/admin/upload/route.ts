import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { createMediaWithVariants } from "@/lib/media-store";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Only JPG/PNG/WebP/AVIF/GIF allowed" }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Max 15MB" }, { status: 400 });
    const { primaryId, width, height } = await createMediaWithVariants(Buffer.from(await file.arrayBuffer()), file.type);
    return NextResponse.json({ ok: true, url: "/api/media/" + primaryId, width, height, processed: true });
  } catch (e: any) { return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 500 }); }
}
