import { Header, Footer } from "@/components/chrome";
import { getSettings, publicSettings } from "@/lib/settings";
import { getCategories } from "@/lib/catalog";
import { db } from "@/lib/db";
import TrackClient from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Track Order" };

export default async function TrackPage() {
  const s = await getSettings();
  const cfg = publicSettings(s);
  const cats = await getCategories();
  return (
    <>
      <Header storeName={cfg.store?.name || "Store"} categories={cats.map((c) => ({ name: c.name, slug: c.slug }))} />
      <TrackClient />
      <Footer cfg={{ ...cfg, _nav: { categories: cats.map((c) => ({ name: c.name, slug: c.slug })) } }} />
    </>
  );
}
