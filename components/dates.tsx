"use client";
import { useEffect, useState } from "react";

function fmt(d: Date, mode: string, tz?: string): string {
  const o: Intl.DateTimeFormatOptions =
    mode === "date" ? { day: "numeric", month: "short", year: "numeric" } :
    mode === "time" ? { hour: "2-digit", minute: "2-digit" } :
    { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };
  if (tz) o.timeZone = tz;
  return d.toLocaleString("en-GB", o);
}

/* Hydration-safe date text:
   - server + first client render use UTC (identical output → no mismatch)
   - after mount it swaps to the visitor's local timezone */
export function FmtDate({ iso, mode = "datetime" }: { iso: string | Date; mode?: "datetime" | "date" | "time" }) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const valid = !isNaN(d.getTime());
  const [txt, setTxt] = useState(() => (valid ? fmt(d, mode, "UTC") : "—"));
  useEffect(() => { if (valid) setTxt(fmt(d, mode)); }, [iso, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span suppressHydrationWarning>{txt}</span>;
}
