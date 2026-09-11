"use client";
import { useMemo, useState } from "react";
import { recommendSize, validateRecInput, type RecResult } from "@/lib/size-rec";

/* Size Recommendation — exact rule-based, product-aware.
   FT/IN first (default), CM optional. Only recommends sizes configured for
   this product; undefined combos show the size-chart fallback message. */

type Props = {
  sizes: string[]; // product's configured sizes (sorted)
  stockMap: Record<string, number>; // size → stock for the currently selected color
};

const labelS: React.CSSProperties = { fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 };
const inputS: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 4, fontSize: 14 };

export default function SizeRecommendation({ sizes, stockMap }: Props) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<"ft" | "cm">("ft");
  const [cm, setCm] = useState("");
  const [ft, setFt] = useState("");
  const [inch, setInch] = useState("");
  const [wt, setWt] = useState("");

  const { errors, incomplete, result } = useMemo(() => {
    const v = validateRecInput({ unit, cm, ft, inch, wt });
    if (v.incomplete || Object.keys(v.errors).length || v.heightCm == null || v.weightKg == null) {
      return { errors: v.errors, incomplete: v.incomplete, result: null as RecResult | null };
    }
    const raw = recommendSize({ heightCm: v.heightCm, weightKg: v.weightKg, sizes, stockMap });
    /* FINAL SAFETY CHECK: never display a size that isn't configured for this product */
    const safe = raw.status !== "uncertain" && sizes.includes(raw.size) ? raw : ({ status: "uncertain" } as RecResult);
    return { errors: v.errors, incomplete: false, result: safe };
  }, [unit, cm, ft, inch, wt, sizes, stockMap]);

  return (
    <div style={{ marginTop: -4, marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer", padding: 0, textDecoration: "underline" }}
      >
        📐 Not sure? Get size recommendation
      </button>

      {open && (
        <div className="srec" style={{ padding: 14, borderRadius: 8, marginTop: 8, display: "grid", gap: 10 }}>
          {/* HEIGHT — FT/IN first (default), CM optional */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <label style={{ ...labelS, marginBottom: 0, letterSpacing: ".08em", textTransform: "uppercase" }}>Height</label>
              <div style={{ display: "flex", gap: 6 }}>
                {(["ft", "cm"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    aria-pressed={unit === u}
                    className={"srec-unit" + (unit === u ? " on" : "")}
                    style={{
                      fontSize: 11,
                      padding: "4px 12px",
                      borderRadius: 99,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {u === "ft" ? "FT / IN" : "CM"}
                  </button>
                ))}
              </div>
            </div>

            {unit === "ft" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={labelS}>Feet</label>
                    <input type="number" inputMode="numeric" min={3} max={7} step={1} value={ft} onChange={(e) => setFt(e.target.value)} placeholder="5" className="srec-input" style={inputS} />
                    {errors.feet && <div className="err">{errors.feet}</div>}
                  </div>
                  <div>
                    <label style={labelS}>Inches</label>
                    <input type="number" inputMode="numeric" min={0} max={11} step={1} value={inch} onChange={(e) => setInch(e.target.value)} placeholder="7" className="srec-input" style={inputS} />
                    {errors.inches && <div className="err">{errors.inches}</div>}
                  </div>
                </div>
                <div>
                  <label style={labelS}>Weight (kg)</label>
                  <input type="number" inputMode="decimal" min={20} max={250} step="any" value={wt} onChange={(e) => setWt(e.target.value)} placeholder="70" className="srec-input" style={inputS} />
                  {errors.weight && <div className="err">{errors.weight}</div>}
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelS}>Height (cm)</label>
                  <input type="number" inputMode="decimal" min={100} max={230} step="any" value={cm} onChange={(e) => setCm(e.target.value)} placeholder="170" className="srec-input" style={inputS} />
                  {errors.height && <div className="err">{errors.height}</div>}
                </div>
                <div>
                  <label style={labelS}>Weight (kg)</label>
                  <input type="number" inputMode="decimal" min={20} max={250} step="any" value={wt} onChange={(e) => setWt(e.target.value)} placeholder="70" className="srec-input" style={inputS} />
                  {errors.weight && <div className="err">{errors.weight}</div>}
                </div>
              </div>
            )}
          </div>

          {/* result */}
          {incomplete && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Enter your height and weight to get a size suggestion.</div>}
          {!incomplete && (errors.height || errors.feet || errors.inches || errors.weight) && (
            <div style={{ fontSize: 12.5, color: "var(--danger)" }}>Please fix the highlighted fields — no suggestion shown for invalid values.</div>
          )}
          {!incomplete && !Object.keys(errors).length && result?.status === "ok" && (
            <div style={{ fontSize: 13 }}>
              Recommended: <b style={{ color: "var(--accent)", fontSize: 16 }}>{result.size}</b>{" "}
              <span style={{ color: "var(--ok)", fontWeight: 600 }}>✓ Available</span>
              {result.note === "closest" && (
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Closest available size for this product — please check the size chart before ordering.</div>
              )}
            </div>
          )}
          {!incomplete && !Object.keys(errors).length && result?.status === "oos" && (
            <div style={{ fontSize: 13 }}>
              Recommended: <b style={{ color: "var(--accent)", fontSize: 16 }}>{result.size}</b>{" "}
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>(not in stock for this product)</span>
            </div>
          )}
          {!incomplete && !Object.keys(errors).length && result?.status === "uncertain" && (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Unable to determine a reliable size. Please check the size chart.</div>
          )}
        </div>
      )}
    </div>
  );
}
