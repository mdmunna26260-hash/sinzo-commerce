import { ProductGridSkeleton, Skeleton } from "@/components/loading-ui";

/* Products listing skeleton — toolbar + grid (filters/header stay live via
   the page's own Suspense boundary when only filters change) */
export default function Loading() {
  return (
    <div className="container shop-wrap" aria-busy="true">
      <Skeleton className="sk-line" style={{ width: 52 }} />
      <Skeleton className="sk-line" style={{ width: 210, height: 28 }} />
      <Skeleton className="sk-line" style={{ width: "72%", maxWidth: 430, marginBottom: 22 }} />
      <ProductGridSkeleton count={8} />
    </div>
  );
}
