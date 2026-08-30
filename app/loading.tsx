import { ProductGridSkeleton, Skeleton } from "@/components/loading-ui";

/* Home skeleton — hero band + featured grid (mirrors the real layout) */
export default function Loading() {
  return (
    <div className="container" style={{ paddingTop: 18, paddingBottom: 60 }} aria-busy="true">
      <Skeleton style={{ height: "min(62vh, 540px)" }} />
      <div style={{ height: 40 }} />
      <ProductGridSkeleton count={8} />
    </div>
  );
}
