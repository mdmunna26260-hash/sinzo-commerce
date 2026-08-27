"use client";
import Link from "next/link";
import { useWishlist } from "@/components/store";
import { ProductCard } from "@/components/parts";

export default function WishlistClient({ products }: { products: any[] }) {
  const wl = useWishlist();
  const saved = products.filter((p) => wl.has(p.id));
  return (
    <div className="container" style={{ padding: "38px 24px 100px" }}>
      <h1 style={{ fontSize: "clamp(28px,3.4vw,40px)", marginBottom: 30 }}>Wishlist</h1>
      {saved.length === 0 ? (
        <div className="empty">
          <h3>No saved items yet</h3>
          <p>Tap the heart on any product to save it here.</p><br />
          <Link className="btn" href="/products">Browse Products</Link>
        </div>
      ) : (
        <div className="grid grid-4">
          {saved.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <ProductCard p={p} wish />
              <button className="abtn sm" style={{ position: "absolute", top: 10, right: 10, background: "#fff" }} onClick={() => wl.toggle(p.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
