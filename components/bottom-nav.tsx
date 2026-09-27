"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "./store";

/* Instagram-style compact icon tab bar — light glass pill, active = filled gray pill.
   Vercel-only, mobile only, all pages (except admin). */

const ITEMS = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M9 22V12h6v10" />
      </svg>
    ),
  },
  {
    href: "/products",
    label: "Shop",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/cart",
    label: "Cart",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
  {
    href: "/track",
    label: "Track",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    href: "/account",
    label: "Account",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { count, ready } = useCart();
  /* cart badge pop when count increases (waits for cart hydration) */
  const [pop, setPop] = useState(false);
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prevCount.current === null) { prevCount.current = count; return; }
    if (count > prevCount.current) {
      prevCount.current = count;
      setPop(true);
      const t = setTimeout(() => setPop(false), 400);
      return () => clearTimeout(t);
    }
    prevCount.current = count;
  }, [count, ready]);
  /* shrink on scroll down; auto-hide far down; show again on any upward tick */
  const [visible, setVisible] = useState(true);
  const [compact, setCompact] = useState(false);
  const lastY = useRef(0);
  const lastDelta = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY.current;
        if (Math.abs(dy) < 6) { ticking = false; return; }
        if (y < 80) {
          // at the very top — fully expanded and visible
          setVisible(true); setCompact(false);
        } else if (dy > 0) {
          // scrolling down: hide (compact icons, then slide out)
          setCompact(true);
          if (y > 160) setVisible(false);
        } else {
          // scrolling up: bring it back compact first, expand when decelerating near top
          setVisible(true);
          setCompact(y > 120);
        }
        lastY.current = y;
        lastDelta.current = dy;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (pathname.startsWith("/admin")) return null;

  return (
    <nav className={"tabbar" + (compact ? " compact" : "") + (visible ? "" : " hidden")} aria-label="Main navigation">
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={"tab-item" + (active ? " active" : "")}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
          >
            <span className="tab-icon">
              {item.icon}
              {item.href === "/cart" && count > 0 && <span className={"tab-badge" + (pop ? " pop" : "")}>{count > 99 ? "99+" : count}</span>}
            </span>
            <span className="tab-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
