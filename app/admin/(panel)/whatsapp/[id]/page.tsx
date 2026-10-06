import { requireAdmin } from "@/lib/auth";
import ReportClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp — Campaign report" };

/* Campaign report (Phase 3, plan §8): progress, per-status counts, delivery/read %, the failure
   list with "only failed" retry, link clicks, attributed orders and a CSV download. */
export default async function CampaignReportPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  await requireAdmin(searchParams, "settings");
  return <ReportClient id={Number(params.id)} />;
}
