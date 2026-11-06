import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import ComboBundlesClient from "./client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Combo Bundles" };
export default async function ComboBundlesPage(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  await requireAdmin(searchParams, "products");
  const [bundles, products, allProducts] = await Promise.all([
    db.comboBundle.findMany({ orderBy: { position: "asc" }, include: { items: { include: { product: { select: { id: true, title: true, slug: true, price: true } } } } } }),
    db.product.findMany({ where: { status: "ACTIVE", comboEligible: true }, orderBy: { title: "asc" }, select: { id: true, title: true, price: true } }),
    db.product.findMany({ where: { status: "ACTIVE" }, orderBy: { title: "asc" }, select: { id: true, title: true, price: true }, take: 300 }),
  ]);
  return <ComboBundlesClient initialBundles={JSON.parse(JSON.stringify(bundles))} eligibleProducts={products} allProducts={allProducts} />;
}
