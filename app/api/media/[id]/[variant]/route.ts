import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string; variant: string } };
export async function GET(_: Request, { params }: Ctx) {
  const m = await db.media.findUnique({ where: { id: params.id } }).catch(() => null);
  if (!m?.variantsJson) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let idx: any = {};
  try { idx = JSON.parse(m.variantsJson); } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
  const v = idx[params.variant];
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = await db.media.findUnique({ where: { id: v.id } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(row.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
