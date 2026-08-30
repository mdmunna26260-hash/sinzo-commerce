import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin-guard";
import { db } from "@/lib/db";
import { generateVariants } from "@/lib/image-variants";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const g = await requirePerm("products", req);
  if ("res" in g) return g.res;

  /* Only migrate media that's actually USED (product images, category images,
     hero/promo/any settings URL) — old deleted uploads stay untouched. */
  const [imgs, cats, settings] = await Promise.all([
    db.productImage.findMany({ select: { url: true } }),
    db.category.findMany({ select: { image: true } }),
    db.setting.findMany(),
  ]);
  const urls = [
    ...imgs.map((i) => i.url),
    ...cats.map((c) => c.image).filter(Boolean),
    ...settings.map((s) => JSON.stringify(s).match(/\/api\/media\/[a-z0-9]+/gi) || []).flat(),
  ];
  const refIds = [...new Set(urls.map((u) => (u.match(/media\/([a-z0-9]+)/i) || [])[1]).filter(Boolean))];
  if (!refIds.length) return NextResponse.json({ ok: true, optimized: 0, remaining: 0, done: true });

  const candidates = await db.media.findMany({
    where: { id: { in: refIds }, mime: { startsWith: "image/" } },
    select: { id: true, variantsJson: true },
    take: 400,
  });
  const NEED = ["w300", "w600", "w1000", "w1200"];
  const legacy = candidates
    .filter((r) => {
      if (!r.variantsJson) return true;
      try { const idx = JSON.parse(r.variantsJson); return NEED.some((k) => !idx[k]?.id); } catch { return true; }
    })
    .map((r) => ({ id: r.id }));
  if (!legacy.length) return NextResponse.json({ done: true, remaining: 0 });
  let optimized = 0;
  for (const { id } of legacy.slice(0, 5)) {
    try {
      const row = await db.media.findUnique({ where: { id } });
      if (!row) continue;
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
  const remaining = legacy.length - optimized;
  return NextResponse.json({ ok: true, optimized, remaining, done: remaining <= 0 });
}
