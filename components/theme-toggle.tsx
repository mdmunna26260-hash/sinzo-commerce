"use client";
import { useEffect, useState } from "react";

/* Theme toggle: moon/sun icon. Persists in localStorage, respects system
   preference on first visit, injects .dark class on <html> before paint
   (inline script in layout.tsx handles the pre-paint part). */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("sz_theme", next ? "dark" : "light"); } catch {}
  };

  // prevent hydration mismatch — render placeholder until mounted
  if (!mounted) return <div className={className} style={{ width: 38, height: 38 }} />;

  return (
    <button
      className={"icon-btn theme-toggle " + className}
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
    >
      {dark ? (
        /* sun icon */
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        /* moon icon */
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
