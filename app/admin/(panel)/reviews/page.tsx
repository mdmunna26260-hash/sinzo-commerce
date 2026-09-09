import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import ReviewsClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };
export default async function ReviewsPage({ searchParams }: { searchParams: any }) {
  await requireAdmin(searchParams);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const reviews = await db.review.findMany({ include: { product: { select: { title: true, slug: true } } }, orderBy: { id: "desc" } });
  return <ReviewsClient initial={reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />;
}
