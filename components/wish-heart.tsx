"use client";
import { useWishlist } from "./store";

/* Wishlist heart overlay for product cards (stops link navigation). */
export default function WishHeart({ id }: { id: number }) {
  const wl = useWishlist();
  return (
    <button
      className={"pcard-heart" + (wl.has(id) ? " on" : "")}
      aria-label={wl.has(id) ? "Remove from wishlist" : "Add to wishlist"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); wl.toggle(id); }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill={wl.has(id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
    </button>
  );
}
