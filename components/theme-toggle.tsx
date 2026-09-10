"use client";
import { useCallback, useEffect, useState } from "react";

/* Theme system: light / dark / system.
   - Persisted in localStorage ("sz_theme"); "system" follows prefers-color-scheme
   - The <html data-theme> attribute is set pre-paint by an inline script in the
     root layout (no flash of wrong theme); this component only syncs state
   - All colors come from the [data-theme="dark"] block in globals.css */

const KEY = "sz_theme";

function readMode(): string {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function isDarkNow(): boolean {
  const m = readMode();
  if (m !== "system") return m === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function setThemeMode(mode: "light" | "dark" | "system") {
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  startThemeTransition();
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

/* Soft cross-fade while the theme flips: enable color transitions for a short
   window, then remove the class so normal hover/reveal animations are untouched. */
let themeTimer: number | undefined;
function startThemeTransition() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const root = document.documentElement;
  root.classList.add("theme-transition");
  window.clearTimeout(themeTimer);
  themeTimer = window.setTimeout(() => root.classList.remove("theme-transition"), 450);
}

function useTheme() {
  const [mode, setModeState] = useState("system");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      setModeState(readMode());
      setDark(isDarkNow());
    };
    sync();
    const onSys = () => {
      if (readMode() === "system") {
        setDark(mq.matches);
        startThemeTransition();
        document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
      }
    };
    mq.addEventListener?.("change", onSys);
    window.addEventListener("storage", sync);
    return () => {
      mq.removeEventListener?.("change", onSys);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const pick = useCallback((m: "light" | "dark" | "system") => {
    setThemeMode(m);
    setModeState(m);
    setDark(isDarkNow());
  }, []);
  return { mode, dark, pick };
}

/* Sun/moon icon button — desktop header + admin topbar */
export function ThemeIconToggle() {
  const { dark, pick } = useTheme();
  return (
    <button
      className="icon-btn theme-toggle"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => pick(dark ? "light" : "dark")}
    >
      {dark ? (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.4" />
          <path d="M12 2.5v2.4M12 19.1v2.4M4.3 4.3l1.7 1.7M18 18l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.3 19.7 6 18M18 6l1.7-1.7" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.4 14.2A8.5 8.5 0 0 1 9.8 3.6a8.5 8.5 0 1 0 10.6 10.6z" />
        </svg>
      )}
    </button>
  );
}

/* Label + switch row — mobile drawer */
export function ThemeSwitchRow() {
  const { dark, pick } = useTheme();
  return (
    <button
      className="theme-row"
      onClick={() => pick(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="theme-row-label">Dark mode</span>
      <span className={"theme-switch" + (dark ? " on" : "")}>
        <span className="theme-knob" />
      </span>
    </button>
  );
}

/* Three-way picker — account page */
export function AppearancePicker() {
  const { mode, pick } = useTheme();
  const OPTS: { v: "light" | "dark" | "system"; label: string; sub: string }[] = [
    { v: "light", label: "Light", sub: "Classic cream" },
    { v: "dark", label: "Dark", sub: "Night, low glare" },
    { v: "system", label: "System", sub: "Follow phone setting" },
  ];
  return (
    <div className="theme-picker">
      {OPTS.map((o) => (
        <button key={o.v} className={"theme-pick" + (mode === o.v ? " on" : "")} onClick={() => pick(o.v)}>
          <span className={"theme-dot" + (mode === o.v ? " on" : "")} />
          <span>
            <b>{o.label}</b>
            <i>{o.sub}</i>
          </span>
        </button>
      ))}
    </div>
  );
}
