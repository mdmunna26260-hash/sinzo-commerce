import { ProductGridSkeleton, Skeleton } from "@/components/loading-ui";

/* Collection page skeleton */
export default function Loading() {
  return (
    <div className="container" style={{ padding: "38px 24px 100px" }} aria-busy="true">
      <Skeleton className="sk-line" style={{ width: 100 }} />
      <Skeleton className="sk-line" style={{ width: 240, height: 30 }} />
      <div style={{ marginTop: 26 }}>
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}
