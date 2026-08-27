import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };
export async function GET(_: Request, { params }: Ctx) {
  const m = await db.media.findUnique({ where: { id: params.id } }).catch(() => null);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(new Uint8Array(m.data), {
    headers: {
      "Content-Type": m.mime,
      "Content-Length": String(m.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
