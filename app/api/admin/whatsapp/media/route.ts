import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { processWaImage, deleteWaMedia, waSizeText } from "@/lib/wa-media";
import { logAudit } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* WhatsApp media upload (Phase 2).
   The panel posts photos here; lib/wa-media re-encodes each one (EXIF rotate → max 1600 px → JPEG
   under ~950 KB) and stores it in public/uploads/wa/. The customer therefore never waits for a 4 MB
   original, and the bridge only ever fetches a small file. */
export async function POST(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  try {
    const form = await req.formData();
    const files = [...form.getAll("files"), ...form.getAll("file")].filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
    if (!files.length) return NextResponse.json({ error: "Kono file nei" }, { status: 400 });
    if (files.length > 10) return NextResponse.json({ error: "Ekbar e maximum 10 ta image" }, { status: 400 });

    const images: { url: string; width: number; height: number; bytes: number; originalBytes: number; quality: number; text: string }[] = [];
    const errors: string[] = [];
    for (const f of files) {
      const r = await processWaImage({ name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) });
      if (!r.ok) { errors.push(`${f.name}: ${(r as { ok: false; error: string }).error}`); continue; }
      images.push({
        url: r.url, width: r.width, height: r.height, bytes: r.bytes, originalBytes: r.originalBytes, quality: r.quality,
        text: r.originalBytes > r.bytes
          ? `${waSizeText(r.originalBytes)} → ${waSizeText(r.bytes)} (${Math.round((1 - r.bytes / r.originalBytes) * 100)}% choto)`
          : `${waSizeText(r.bytes)} · already optimised`,
      });
    }
    if (!images.length) return NextResponse.json({ error: errors[0] || "Upload failed", errors }, { status: 400 });
    await logAudit(g.user.email, "WA_MEDIA_UPLOAD", `${images.length} image(s): ${images.map((i) => i.text).join(" | ").slice(0, 200)}`);
    return NextResponse.json({ ok: true, images, errors });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const g = await requirePerm("settings", req);
  if ("res" in g) return g.res;
  const url = new URL(req.url).searchParams.get("url") || "";
  const ok = deleteWaMedia(url);
  return NextResponse.json({ ok, url });
}
