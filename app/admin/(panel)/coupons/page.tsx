import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import CouponsClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Coupons" };
export default async function CouponsPage(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  await requireAdmin(searchParams, "coupons");
  const coupons = await db.coupon.findMany({ orderBy: { id: "desc" } });
  return <CouponsClient initial={coupons.map((c) => ({ ...c, startsAt: c.startsAt?.toISOString() || null, endsAt: c.endsAt?.toISOString() || null }))} />;
}
