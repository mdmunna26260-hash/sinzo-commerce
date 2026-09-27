import { db } from "@/lib/db";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { getCustomerSessionFromRequest, verifyCustomerToken } from "@/lib/customer-auth";
import { Header, Footer, Announcement } from "@/components/chrome";
import { redirect } from "next/navigation";
import AccountClient from "./client";
import { getSettings as _getSettings } from "@/lib/settings";
import { loyaltyCfg, pointsValue } from "@/lib/loyalty";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Account" };

export default async function AccountPage({ searchParams }: { searchParams: { ct?: string } }) {
  const session = (await getCustomerSessionFromRequest()) || verifyCustomerToken(searchParams?.ct);
  if (!session) redirect("/login");
  const customer = await db.customer.findUnique({ where: { id: session.id } });
  if (!customer) redirect("/login");
  const orders = await db.order.findMany({ where: { phone: customer.phone }, include: { items: true }, orderBy: { id: "desc" }, take: 50 });
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  /* Rewards strip: points balance only. Referral invite codes removed from customer view. */
  const lcfg = loyaltyCfg(s as any);
  const rewards = {
    enabled: lcfg.enabled, points: customer.points, value: pointsValue(customer.points, lcfg),
    minRedeem: lcfg.minRedeem, redeemPoints: lcfg.redeemPoints,
  };

  return (
    <>
      <Announcement text={s.homepage?.announcement} />
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <AccountClient
        customer={{ name: customer.name, phone: customer.phone, email: customer.email, address: customer.address, area: customer.area }}
        rewards={rewards}
        token={searchParams?.ct || ""}
        orders={orders.map((o) => ({
          code: o.code, status: o.status, total: o.total, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
          createdAt: o.createdAt.toISOString(), itemCount: o.items.reduce((a, i) => a + i.qty, 0),
          items: o.items.map((i) => ({ title: i.title, qty: i.qty, image: i.image, variant: i.variant })),
        }))}
      />
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
