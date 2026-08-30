import { ProductGridSkeleton, Skeleton } from "@/components/loading-ui";

/* Wishlist skeleton */
export default function Loading() {
  return (
    <div className="container" style={{ padding: "38px 24px 100px" }} aria-busy="true">
      <Skeleton className="sk-line" style={{ width: 150, height: 30 }} />
      <div style={{ marginTop: 24 }}>
        <ProductGridSkeleton count={4} />
      </div>
    </div>
  );
}
