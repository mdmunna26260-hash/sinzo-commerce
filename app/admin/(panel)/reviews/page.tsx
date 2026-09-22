import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import ReviewsClient from "./client";
import ReviewRequests from "./requests";
import { getSettings, envFallback } from "@/lib/settings";
import { reviewRequestQueue, reviewRequestStats, autoReviewRequestEnabled } from "@/lib/review-request";
export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };
export default async function ReviewsPage({ searchParams }: { searchParams: any }) {
  await requireAdmin(searchParams);
  const { ensureExtraTables } = await import("@/lib/db-ensure");
  await ensureExtraTables().catch(() => {});
  const reviews = await db.review.findMany({ include: { product: { select: { title: true, slug: true } } }, orderBy: { id: "desc" } });
  /* Reviews only exist if somebody asks. The queue + the auto switch live on this screen so
     moderation and collection are one job, not two. */
  const s = envFallback(await getSettings());
  const [queue, stats] = await Promise.all([reviewRequestQueue(60), reviewRequestStats()]);
  return (
    <>
      <ReviewRequests
        queue={queue.map((o) => ({ id: o.id, code: o.code, name: o.name, phone: o.phone, total: o.total, email: o.email, updatedAt: o.updatedAt.toISOString() }))}
        autoRequest={autoReviewRequestEnabled(s)}
        asked={stats.asked}
        pending={stats.pending}
      />
      <ReviewsClient initial={reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />
    </>
  );
}
