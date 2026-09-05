"use client";
import Link from "next/link";
import { useCompare, useCart, toast } from "@/components/store";
import { Stars } from "@/components/parts";
import { imgSrc } from "@/components/parts";
import { useRouter } from "next/navigation";

const money = (n: number) => "৳" + Math.round(n).toLocaleString("en-IN");

type CP = {
  id: number; title: string; slug: string; price: number; comparePrice: number | null;
  stock: number; sku: string | null; shortDesc: string | null; categoryName: string | null;
  image: string | null; sizes: string[]; colors: string[]; rating: number | null; reviewCount: number;
  badge?: string | null; isNew?: boolean; isBestSeller?: boolean;
};

export default function CompareClient({ products }: { products: CP[] }) {
  const cmp = useCompare();
  const { add } = useCart();
  const router = useRouter();

  const remove = (id: number) => {
    cmp.toggle(id);
    const rest = cmp.ids.filter((x) => x !== id);
    if (rest.length >= 2) router.replace("/compare?ids=" + rest.join(","));
    else router.replace("/compare");
  };

  const addDirect = (p: CP) => {
    if (p.sizes.length) { router.push("/products/" + p.slug); return; } // size products need selection on PDP
    if (p.stock <= 0) { toast("Sold out"); return; }
    add({ productId: p.id, slug: p.slug, title: p.title, image: p.image || undefined, price: p.price, qty: 1, stock: p.stock });
    toast("Added to cart ✓");
  };

  return (
    <div className="container" style={{ padding: "38px 24px 130px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="eyebrow">Side by side</div>
          <h1 style={{ fontSize: "clamp(26px,3.2vw,38px)", margin: "6px 0" }}>Compare Products</h1>
        </div>
        {products.length > 0 && (
          <button className="btn btn-outline btn-sm" onClick={() => { cmp.clear(); router.replace("/compare"); }}>Clear all</button>
        )}
      </div>

      {products.length === 0 ? (
        <div className="empty" style={{ marginTop: 24 }}>
          <h3>Nothing to compare yet</h3>
          <p>Product card er uporer compare icon e tap kore 2-4 products add korun.</p><br />
          <Link className="btn" href="/products">Browse Products</Link>
        </div>
      ) : products.length === 1 ? (
        <div className="empty" style={{ marginTop: 24 }}>
          <h3>Add at least one more product</h3>
          <p>Compare korar jonno aro ekta product din.</p><br />
          <Link className="btn" href="/products">Browse Products</Link>
        </div>
      ) : (
        <div className="cmp-wrap" style={{ marginTop: 22 }}>
          <table className="cmp-table">
            <tbody>
              <tr>
                <th className="cmp-rowlabel" aria-label="Product images" />
                {products.map((p) => (
                  <td key={"img" + p.id} className="cmp-imgcell">
                    <Link href={"/products/" + p.slug}>
                      {p.image ? <img src={imgSrc(p.image, 400) || p.image} alt={p.title} loading="lazy" decoding="async" /> : <span className="cmp-noimg" />}
                    </Link>
                    <button className="cmp-remove" aria-label={"Remove " + p.title} onClick={() => remove(p.id)}>✕</button>
                  </td>
                ))}
              </tr>
              <tr>
                <th className="cmp-rowlabel">Product</th>
                {products.map((p) => (
                  <td key={"t" + p.id}>
                    <Link className="cmp-title" href={"/products/" + p.slug}>{p.title}</Link>
                  </td>
                ))}
              </tr>
              <tr>
                <th className="cmp-rowlabel">Price</th>
                {products.map((p) => {
                  const off = p.comparePrice && p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : 0;
                  return (
                    <td key={"p" + p.id}>
                      <b>{money(p.price)}</b>{" "}
                      {p.comparePrice && p.comparePrice > p.price && (
                        <><s style={{ color: "var(--muted)", fontSize: 12.5 }}>{money(p.comparePrice)}</s> <span className="off">-{off}%</span></>
                      )}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th className="cmp-rowlabel">Rating</th>
                {products.map((p) => (
                  <td key={"r" + p.id}>
                    {p.rating != null ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Stars n={p.rating} /> <span style={{ fontSize: 12, color: "var(--muted)" }}>({p.reviewCount})</span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: 13 }}>No reviews yet</span>
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="cmp-rowlabel">Availability</th>
                {products.map((p) => (
                  <td key={"s" + p.id}>
                    {p.stock > 0 ? (
                      <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>{p.stock <= 5 ? `Only ${p.stock} left` : "In stock"}</span>
                    ) : (
                      <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>Sold out</span>
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="cmp-rowlabel">Sizes</th>
                {products.map((p) => (
                  <td key={"sz" + p.id} style={{ fontSize: 13 }}>{p.sizes.length ? p.sizes.join(", ") : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                ))}
              </tr>
              <tr>
                <th className="cmp-rowlabel">Colors</th>
                {products.map((p) => (
                  <td key={"c" + p.id}>
                    {p.colors.length ? (
                      <span className="cmp-colors">
                        {p.colors.slice(0, 6).map((c, i) => (
                          <i key={i} title={c} style={{ background: ["white", "off-white", "cream"].includes(c.toLowerCase()) ? "#f4f0e8" : c.toLowerCase() }} />
                        ))}
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.colors.length > 6 ? "+" + (p.colors.length - 6) : p.colors.join(", ")}</span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: 13 }}>—</span>
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="cmp-rowlabel">Category</th>
                {products.map((p) => (
                  <td key={"cat" + p.id} style={{ fontSize: 13 }}>{p.categoryName || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                ))}
              </tr>
              <tr>
                <th className="cmp-rowlabel">Highlights</th>
                {products.map((p) => (
                  <td key={"d" + p.id} className="cmp-desc">{p.shortDesc || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                ))}
              </tr>
              <tr>
                <th className="cmp-rowlabel" />
                {products.map((p) => (
                  <td key={"a" + p.id}>
                    <div className="cmp-actions">
                      <button className={"btn btn-sm" + (p.stock <= 0 ? "" : " btn-accent")} disabled={p.stock <= 0 && !p.sizes.length} onClick={() => addDirect(p)}>
                        {p.sizes.length ? "Select size" : p.stock > 0 ? "Add to Cart" : "Sold out"}
                      </button>
                      <Link className="btn btn-outline btn-sm" href={"/products/" + p.slug}>View</Link>
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
