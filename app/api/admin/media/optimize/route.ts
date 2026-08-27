import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { db } from "@/lib/db";
import { generateVariants } from "@/lib/image-variants";
export const dynamic = "force-dynamic";
const MAX_PER_CALL = 5;

/* Safe gradual migration: optimizes up to 5 legacy images per call (single-color batches).
   Legacy rows (no variantsJson) keep working via /api/media/<id>; after optimization they
   gain responsive variants + blur without changing their URL. */
export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;
  const legacy = await db.media.findMany({
    where: { variantsJson: null, mime: { startsWith: "image/" }, filename: { notIn: ["w300.webp", "w600.webp", "w1000.webp", "w1200.webp", "blur.webp"] } },
    select: { id: true }, take: 200,
  });
  if (!legacy.length) return NextResponse.json({ done: true, remaining: 0 });
  let optimized = 0;
  for (const { id } of legacy.slice(0, MAX_PER_CALL)) {
    try {
      const row = await db.media.findUnique({ where: { id } });
      if (!row || row.variantsJson) continue;
      const v = await generateVariants(Buffer.from(row.data));
      const mk = async (data: Buffer, tag: string) => {
        const r = await db.media.create({ data: { filename: tag + ".webp", mime: "image/webp", size: data.length, data } });
        return { id: r.id, size: r.size };
      };
      const [w300, w600, w1000, w1200] = await Promise.all([mk(v.w300, "w300"), mk(v.w600, "w600"), mk(v.w1000, "w1000"), mk(v.w1200, "w1200")]);
      await db.media.update({ where: { id }, data: {
        width: v.width, height: v.height, blurData: v.blur,
        variantsJson: JSON.stringify({ w300, w600, w1000, w1200 }),
      }});
      optimized++;
    } catch {}
  }
  const remaining = await db.media.count({ where: { variantsJson: null, mime: { startsWith: "image/" }, filename: { notIn: ["w300.webp", "w600.webp", "w1000.webp", "w1200.webp", "blur.webp"] } } });
  return NextResponse.json({ ok: true, optimized, remaining, done: remaining === 0 });
}
