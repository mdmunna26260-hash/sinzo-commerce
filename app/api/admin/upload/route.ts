import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { processProductImage } from "@/lib/image";
import fs from "fs/promises";
import path from "path";
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
    const { buffer, ext, processed } = await processProductImage(Buffer.from(await file.arrayBuffer()), file.type);
    const name = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    const dir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), new Uint8Array(buffer));
    return NextResponse.json({ ok: true, url: "/uploads/" + name, processed });
  } catch (e: any) { return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 500 }); }
}
