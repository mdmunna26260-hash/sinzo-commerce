"use client";
import { useId, useMemo, useState } from "react";
import { detectGarmentType, recommendSize, validateRecInput } from "@/lib/size-rec";

type Props = {
  sizes: string[];
  stockMap: Record<string, number>;
  productTitle: string;
  categoryName?: string;
  categorySlug?: string;
  sizeChartHtml?: string | null;
  activeSize?: string | null;
  colorLabel?: string | null;
  preorder?: boolean;
  onSelectSize: (size: string) => void;
  onOpenChart?: () => void;
};

export default function SizeRecommendation({ sizes, stockMap, productTitle, categoryName, categorySlug, sizeChartHtml, activeSize, colorLabel, preorder, onSelectSize, onOpenChart }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<"ft" | "cm">("ft");
  const [cm, setCm] = useState("");
  const [ft, setFt] = useState("");
  const [inch, setInch] = useState("");
  const [wt, setWt] = useState("");
  const garment = detectGarmentType(productTitle, `${categoryName || ""} ${categorySlug || ""}`);
  const validation = useMemo(() => validateRecInput({ unit, cm, ft, inch, wt }), [unit, cm, ft, inch, wt]);
  const invalid = Object.keys(validation.errors).length > 0;
  const result = useMemo(() => {
    if (validation.incomplete || invalid || validation.heightCm === null || validation.weightKg === null) return null;
    return recommendSize({ heightCm: validation.heightCm, weightKg: validation.weightKg, sizes, stockMap, productTitle, categoryName, categorySlug, sizeChartHtml });
  }, [validation, invalid, sizes, stockMap, productTitle, categoryName, categorySlug, sizeChartHtml]);
  const fit = result && result.status !== "uncertain" ? result : null;
  const changeUnit = (next: "ft" | "cm") => {
    if (next === unit) return;
    if (validation.heightCm !== null) {
      if (next === "cm") setCm(String(Math.round(validation.heightCm * 10) / 10));
      else {
        const totalInches = Math.round(validation.heightCm / 2.54 * 10) / 10;
        setFt(String(Math.floor(totalInches / 12)));
        setInch(String(Math.round((totalInches % 12) * 10) / 10));
      }
    } else if (next === "cm") setCm("");
    else { setFt(""); setInch(""); }
    setUnit(next);
  };
  const errors = validation.errors;

  return (
    <div className="srec-wrap">
      <button type="button" className="srec-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">📐</span> Not sure? Get size recommendation
      </button>
      {open && (
        <div className="srec" id={id} role="region" aria-label="Size recommendation">
          <div className="srec-intro">
            <b>Your size, made simple</b>
            <p>Just your height and weight. {garment === "wide-leg-pants" ? "Wide-leg fit, with waist-based sizing." : garment === "pants" ? "Waist-based sizing for this pant." : garment === "shirt" ? "Chest-based sizing for this product." : "Uses the sizes configured for this product."}</p>
          </div>
          <div className="srec-height-head">
            <span className="srec-label">Height</span>
            <div className="srec-units" aria-label="Height unit">
              {(["ft", "cm"] as const).map((value) => (
                <button type="button" key={value} onClick={() => changeUnit(value)} aria-pressed={unit === value} className={"srec-unit" + (unit === value ? " on" : "")}>
                  {value === "ft" ? "FT / IN" : "CM"}
                </button>
              ))}
            </div>
          </div>
          <div className={"srec-fields" + (unit === "ft" ? " srec-fields-ft" : "")}>
            {unit === "ft" ? (
              <>
                <div>
                  <label htmlFor={id + "-ft"} className="srec-label">Feet</label>
                  <input id={id + "-ft"} type="number" inputMode="numeric" min={3} max={7} step={1} value={ft} onChange={(e) => setFt(e.target.value)} placeholder="5" className="srec-input" aria-invalid={!!errors.feet} aria-describedby={errors.feet ? id + "-ft-error" : undefined} />
                  {errors.feet && <div className="err" id={id + "-ft-error"}>{errors.feet}</div>}
                </div>
                <div>
                  <label htmlFor={id + "-in"} className="srec-label">Inches</label>
                  <input id={id + "-in"} type="number" inputMode="decimal" min={0} max={11.99} step="any" value={inch} onChange={(e) => setInch(e.target.value)} placeholder="0" className="srec-input" aria-invalid={!!errors.inches} aria-describedby={errors.inches ? id + "-in-error" : undefined} />
                  {errors.inches && <div className="err" id={id + "-in-error"}>{errors.inches}</div>}
                </div>
              </>
            ) : (
              <div>
                <label htmlFor={id + "-cm"} className="srec-label">Height (cm)</label>
                <input id={id + "-cm"} type="number" inputMode="decimal" min={100} max={230} step="any" value={cm} onChange={(e) => setCm(e.target.value)} placeholder="170" className="srec-input" aria-invalid={!!errors.height} aria-describedby={errors.height ? id + "-cm-error" : undefined} />
                {errors.height && <div className="err" id={id + "-cm-error"}>{errors.height}</div>}
              </div>
            )}
            <div className="srec-weight">
              <label htmlFor={id + "-weight"} className="srec-label">Weight (kg)</label>
              <input id={id + "-weight"} type="number" inputMode="decimal" min={20} max={250} step="any" value={wt} onChange={(e) => setWt(e.target.value)} placeholder="70" className="srec-input" aria-invalid={!!errors.weight} aria-describedby={errors.weight ? id + "-weight-error" : undefined} />
              {errors.weight && <div className="err" id={id + "-weight-error"}>{errors.weight}</div>}
            </div>
          </div>
          <div className="srec-result" aria-live="polite" aria-atomic="true">
            {invalid ? <p className="srec-invalid">Please fix the highlighted fields.</p> : validation.incomplete ? <p className="srec-help">Enter your height and weight; your suggestion updates automatically.</p> : fit ? (
              <>
                <div className="srec-recommended">Recommended: <strong>{fit.size}</strong> <span className={fit.status === "ok" ? "srec-available" : "srec-help"}>{fit.status === "ok" ? preorder ? "Available to pre-order" : "✓ Available" : colorLabel ? `Out of stock in ${colorLabel}` : "Out of stock"}</span></div>
                <div className="srec-guide">
                  <div><span>Number size</span><b>{fit.numericSize || "—"}</b></div>
                  <div><span>Alphabet size</span><b>{fit.alphaSize || "—"}</b></div>
                </div>
                <p className="srec-help">{fit.source === "chart" ? "Matched to this product’s size chart." : "Height-adjusted fit estimate."} Number/letter equivalents are a guide; only listed product sizes can be selected.</p>
                <div className="srec-actions">
                  {fit.matches.map((match) => (
                    <button type="button" className="srec-use" key={match.size} disabled={!match.available || activeSize === match.size} onClick={() => onSelectSize(match.size)}>
                      {!match.available ? `${match.size} unavailable` : activeSize === match.size ? `Size ${match.size} selected` : `Use size ${match.size}`}
                    </button>
                  ))}
                </div>
                {fit.note === "closest" && <p className="srec-help">Closest configured size. Compare the size chart before ordering.</p>}
                {(fit.garment === "pants" || fit.garment === "wide-leg-pants") && <p className="srec-help">{fit.garment === "wide-leg-pants" ? "Wide legs do not mean a larger waist. " : ""}Check the pant length/inseam for your height.</p>}
              </>
            ) : <p className="srec-help">No reliable match in this product’s sizes for these measurements. Please check the size chart.</p>}
          </div>
          <div className="srec-foot">
            <p>Height and weight give an estimate, not a guaranteed fit. Body shape and brand measurements can vary.</p>
            {onOpenChart && <button type="button" onClick={onOpenChart}>View size chart</button>}
          </div>
        </div>
      )}
    </div>
  );
}
