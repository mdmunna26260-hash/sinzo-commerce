"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { adminToken } from "@/lib/afetch";
import { nextDockScroll, type DockScrollState } from "@/lib/dock-scroll";

const shortcuts = [
  { href: "/admin/orders", label: "Orders", permission: "orders", icon: "M6 3h12l3 4v14H3V7zM3 7h18M8 11a4 4 0 0 0 8 0" },
  { href: "/admin/products", label: "Products", permission: "products", icon: "m12 3 9 5-9 5-9-5 9-5zM3 8v9l9 5 9-5V8M12 13v9" },
  { href: "/admin/marketing", label: "Abandoned Checkouts", permission: "marketing", icon: "M3 3h2l3 12h11l2-8H6M9 21h.01M18 21h.01M12 2v5M15 4l-3 3-3-3" },
  { href: "/admin/settings", label: "Settings", permission: "settings", icon: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" },
  { href: "/", label: "Website Home", permission: "", icon: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" },
];

export default function AdminQuickNavigation({ allowed }: { allowed: string[] | null }) {
  const dock = useRef<HTMLElement>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const [token, setToken] = useState("");
  const path = usePathname();
  const search = useSearchParams();
  const urlToken = search.get("t") || "";
  useEffect(() => { setToken(adminToken()); }, [path, urlToken]);
  const visible = shortcuts.filter((item) => !item.permission || allowed === null || allowed.includes(item.permission));

  const activeIndex = visible.findIndex((item) => path === item.href || path.startsWith(item.href + "/"));

  useEffect(() => {
    setHidden(false);
    setPreviewIndex(null);
    let state: DockScrollState = { lastY: Math.max(0, window.scrollY), travel: 0, hidden: false };
    let frame = 0;
    const update = () => {
      frame = 0;
      state = nextDockScroll(state, window.scrollY, document.documentElement.scrollHeight - window.innerHeight);
      // Never move a focused link away from a keyboard user.
      if (dock.current?.querySelector(":focus-visible")) state = { ...state, hidden: false, travel: 0 };
      setHidden(state.hidden);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, [path]);

  return (
    <nav ref={dock} className={"admin-dock" + (hidden ? " is-hidden" : "")} aria-label="Admin quick navigation"
      onFocusCapture={() => setHidden(false)}>
      {visible.length > 0 && (
        <div className="admin-dock-pill" onPointerLeave={() => setPreviewIndex(null)} onPointerCancel={() => setPreviewIndex(null)} style={{ "--dock-count": visible.length, "--dock-index": Math.max(0, previewIndex ?? activeIndex) } as CSSProperties}>
          {(previewIndex !== null || activeIndex >= 0) && <span className="admin-dock-lens" aria-hidden="true" />}
          {visible.map((item, index) => {
            const active = path === item.href || path.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={token && item.href.startsWith("/admin/") ? item.href + "?t=" + encodeURIComponent(token) : item.href}
                className={"admin-dock-item" + (active ? " is-active" : "") + (previewIndex === index ? " is-preview" : "")}
                onPointerEnter={(event) => { if (event.pointerType === "mouse") setPreviewIndex(index); }}
                onPointerDown={() => setPreviewIndex(index)} onPointerUp={() => setPreviewIndex(null)}
                onFocus={() => setPreviewIndex(index)} onBlur={() => setPreviewIndex(null)}
                prefetch={false} aria-label={item.label} title={item.label} aria-current={active ? "page" : undefined}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.icon} /></svg>
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
