import { DashboardSkeleton } from "@/components/loading-ui";

/* Admin skeleton — KPI cards + table (same frame as the real dashboard) */
export default function Loading() {
  return (
    <div style={{ padding: "26px 34px 60px" }} aria-busy="true">
      <DashboardSkeleton />
    </div>
  );
}
