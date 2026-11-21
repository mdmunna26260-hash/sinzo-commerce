import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/admin-guard";
import { logAudit } from "@/lib/auth";
export const dynamic = "force-dynamic";

// Accept a complete sibling group only; never change the parent relationship.
export async function POST(req: Request) {
  const g = await requirePerm("categories", req);
  if ("res" in g) return g.res;
  const body = await req.json().catch(() => null);
  const ids: unknown = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "Unique positive category ids required" }, { status: 400 });
  }
  try {
    const saved = await db.$transaction(async (tx) => {
      const first = await tx.category.findUnique({ where: { id: ids[0] } });
      if (!first) return false;
      const siblings = await tx.category.findMany({ where: { parentId: first.parentId }, select: { id: true } });
      if (siblings.length !== ids.length || siblings.some((c) => !ids.includes(c.id))) return false;
      for (let i = 0; i < ids.length; i++) {
        await tx.category.update({ where: { id: ids[i] }, data: { position: i + 1 } });
      }
      return true;
    });
    if (!saved) return NextResponse.json({ error: "Send all categories under the same parent. Refresh and retry." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Unable to save category order. Please retry." }, { status: 500 });
  }
  revalidateTag("categories");
  revalidatePath("/", "layout");
  await logAudit(g.user.email, "CATEGORIES_REORDERED", `${ids.length} categories reordered`);
  return NextResponse.json({ ok: true });
}
