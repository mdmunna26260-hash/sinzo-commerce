#!/usr/bin/env node
/* ============================================================================
   touch-audit — the iPhone rules, as assertions
   ----------------------------------------------------------------------------
   The owner accepts a product card with three thumb tests:
     1. ONE tap opens the product page (never two)
     2. a swipe on a multi-photo card changes the photo AND its dot, and never
        opens the product page
     3. a vertical drag scrolls the page
   Run:  node scripts/touch-audit.mjs          (npm run test:touch)
   No install, no browser, no database: the gesture maths lives in
   components/gallery-gesture.ts as pure functions, so the decisions a phone
   makes can be asserted here exactly as they happen on the device.

   The rules below are worded from the two iPhone reports they come from:
     "product e click korle 2 bar lagbe"  → a tap may never be eaten by a drag's
                                            swallow window (place + time checked)
     "swipe korle change hoy na"          → the gallery owns the horizontal axis,
                                            the page keeps the vertical one
   The browser-level half of the acceptance test lives in
   scripts/_sandbox/card-tap-test.cjs (real Chromium, real touch events).
   ============================================================================ */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra == null ? "" : "→ " + extra); }
};
const section = (t) => console.log("\n" + t);

/* The component files explain the bugs they fixed in comments — which quote the very API
   names these checks look for ("setPointerCapture", "350ms"). Scan CODE, not prose. */
function stripComments(code) {
  let out = "", i = 0, mode = "code", quote = "";
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { mode = "string"; quote = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; continue; } i++; continue; }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (c === "\\") { out += c + (n ?? ""); i += 2; continue; }
    if (c === quote) mode = "code";
    out += c; i++;
  }
  return out;
}

/* ------------------------------------------------------------------ the module under test
   gallery-gesture.ts must stay pure: no imports, no DOM, no timers. It is compiled
   with the repo's own TypeScript and executed in a bare context — so an accidental
   `import ... from "react"` fails this audit instead of silently shipping. */
const ts = (await import(pathToFileURL(path.join(REPO, "node_modules", "typescript", "lib", "typescript.js")).href)).default;
const src = read("components/gallery-gesture.ts");
const compiled = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "gallery-gesture.ts",
}).outputText;
const moduleShim = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleShim,
  exports: moduleShim.exports,
  require: (id) => { throw new Error("gallery-gesture.ts must stay dependency-free (it imported " + id + ")"); },
  Math, Date, console, performance: { now: () => 0 },
});
const G = moduleShim.exports;
const clamp0 = (n) => Math.max(0, Math.min(2, n));

/* ============================================================ 1. a tap opens the product */
section("1 · one tap opens the product page");
check("a still finger has no axis at all", G.lockAxis(2, 1) === "", G.lockAxis(2, 1));
check("movement below the lock is still a tap", G.lockAxis(5, 5) === "", G.lockAxis(5, 5));
check("the wobble of a real thumb is not a drag",
  G.isDrag("", 0) === false && G.isDrag("x", 6) === false && G.isDrag("x", 12) === false);
check("a tap never arms a swallow plan", G.swallowPlan({ axis: "", rawDx: 0, x: 10, y: 10, now: 0 }) === null);
check("the drag's own click is swallowed (place + time match)",
  G.shouldSwallow({ until: 300, x: 200, y: 300 }, { x: 203, y: 302, now: 40 }) === true);
check("a click that arrives after the window is not swallowed",
  G.shouldSwallow({ until: 300, x: 200, y: 300 }, { x: 203, y: 302, now: 400 }) === false);
check("a fresh tap a thumb away is NEVER swallowed — the \"2 bar lagbe\" bug",
  G.shouldSwallow({ until: 300, x: 200, y: 300 }, { x: 200, y: 390, now: 40 }) === false);
check("the swallow radius is inclusive, and only just",
  G.shouldSwallow({ until: 300, x: 200, y: 300 }, { x: 228, y: 300, now: 40 }) === true &&
  G.shouldSwallow({ until: 300, x: 200, y: 300 }, { x: 229, y: 300, now: 40 }) === false);
check("no plan, no swallow", G.shouldSwallow(null, { x: 200, y: 300, now: 0 }) === false);

/* ================================================== 2. a swipe changes the photo, not the page */
section("2 · a swipe changes the photo (and its dot), and never opens the page");
check("horizontal dominance takes the axis", G.lockAxis(20, 4) === "x", G.lockAxis(20, 4));
check("a drag stays a drag when the rubber band compresses it",
  G.isDrag("x", 40) === true && G.resist(40, 0, 3) === 14,
  `resist=${G.resist(40, 0, 3)}`);
check("the middle of the gallery is not resisted", G.resist(40, 1, 3) === 40);
check("the resistance only ever shrinks the travel",
  Math.abs(G.resist(40, 0, 3)) < 40 && G.resist(-40, 2, 3) === -14);
check("travel past the move ratio turns the page",
  G.slideAfter({ dx: -60, ms: 100, width: 300, index: 0, count: 3 }) === 1);
check("a short, slow pull springs back",
  G.slideAfter({ dx: -20, ms: 400, width: 300, index: 0, count: 3 }) === 0);
check("a quick flick turns the page even when short",
  G.slideAfter({ dx: -20, ms: 20, width: 300, index: 0, count: 3 }) === 1);
check("the first photo cannot be swiped past",
  G.slideAfter({ dx: 80, ms: 60, width: 300, index: 0, count: 3 }) === 0);
check("the last photo cannot be swiped past",
  G.slideAfter({ dx: -80, ms: 60, width: 300, index: 2, count: 3 }) === 2);
check("a card that was never measured still swipes",
  G.slideAfter({ dx: -80, ms: 60, width: 0, index: 0, count: 3 }) === 1);
check("results are always a real slide index",
  [G.slideAfter({ dx: -9999, ms: 1, width: 300, index: 0, count: 1 }),
   G.slideAfter({ dx: 9999, ms: 1, width: 300, index: 0, count: 1 })].every((i) => clamp0(i) === i));

/* ================================================== 3. a vertical drag scrolls the page */
section("3 · a vertical drag scrolls the page");
check("vertical dominance keeps the page", G.lockAxis(4, 20) === "y", G.lockAxis(4, 20));
check("a mostly-vertical diagonal keeps the page", G.lockAxis(9, 12) === "y", G.lockAxis(9, 12));
check("a scroll never counts as a drag", G.isDrag("y", 200) === false);
check("a scroll never arms a swallow plan (its click, if any, is a tap)",
  G.swallowPlan({ axis: "y", rawDx: 200, x: 1, y: 1, now: 0 }) === null);

/* ============================================================ the card's CSS + DOM contract */
section("card contract (the CSS half of the same three rules)");
const css = read("app/globals.css");

/* walk every rule, remembering which @media it sits in — comments stripped first so a brace
   inside a comment cannot derail the scan */
function* cssRules(source, media = []) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  while (i < clean.length) {
    const open = clean.indexOf("{", i);
    if (open < 0) return;
    const selector = clean.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < clean.length && depth > 0) {
      if (clean[j] === "{") depth++;
      else if (clean[j] === "}") depth--;
      j++;
    }
    const body = clean.slice(open + 1, j - 1);
    if (/^@(media|supports|layer|container|scope)/.test(selector)) yield* cssRules(body, [...media, selector]);
    else if (!selector.startsWith("@")) yield { selector, body, media };
    i = j;
  }
}
const rules = [...cssRules(css)];
const ruleBody = (sel) => rules.filter((r) => r.selector === sel).map((r) => r.body).join("\n");
const mediaOf = (sel) => rules.filter((r) => r.selector === sel).map((r) => r.media.join(" ")).join(" ");

check("the gallery owns the horizontal axis (touch-action: pan-y)",
  /touch-action:\s*pan-y/.test(ruleBody(".cg")));
check("the card link keeps taps instant (touch-action: manipulation)",
  rules.some((r) => r.selector.split(",").map((s) => s.trim()).includes("a") && /touch-action:\s*manipulation/.test(r.body)));
check("entrance animations on a touch screen never MOVE the card (fade only)",
  rules.some((r) => /\.reveal/.test(r.selector) && /transform:\s*none/.test(r.body) &&
    r.media.some((m) => /hover:\s*none/.test(m))));
check("the dots row exists, and only the current one is marked",
  /\.pcard-dots\s*\{/.test(css) && /\.pcard-dots i\.on\s*\{/.test(css));

/* A hover rule that changes the geometry (transform/size/display) of the element under the
   finger makes iOS spend the first tap on the hover state and drop the click. Every such rule
   must therefore be inside @media (hover: hover) — the one thing a touch screen cannot do. */
const GEOMETRY = /(^|[;{\s])(transform|display|visibility|height|width|top|left|right|bottom|margin|padding|aspect-ratio|flex|grid-template)\s*:/;
const nakedHover = rules.filter((r) =>
  r.selector.includes(":hover") && GEOMETRY.test(r.body) &&
  !r.media.some((m) => /hover:\s*hover/.test(m)));
check("no unguarded :hover rule moves the thing the finger is on",
  nakedHover.length === 0, nakedHover.map((r) => r.selector).join(" | "));
check("the card's hover zoom is a hover:hover rule",
  /hover:\s*hover/.test(mediaOf(".pcard:hover .pcard-img .cg-img")));

/* ============================================================ the component wiring */
section("component wiring (the parts a pure function cannot see)");
const gallery = stripComments(read("components/card-gallery.tsx"));
const media = stripComments(read("components/card-media.tsx"));
const parts = stripComments(read("components/parts.tsx"));

/* the body of one arrow function, by brace balance — so a check about onDown() cannot
   accidentally read the next function down the file */
function functionBody(code, header) {
  const start = code.indexOf(header);
  if (start < 0) return "";
  const open = code.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") { depth--; if (depth === 0) return code.slice(open, i + 1); }
  }
  return "";
}

const lockAt = gallery.indexOf("lockAxis(mx, my)");
const captureAt = gallery.indexOf("setPointerCapture(d.id)");
check("pointer capture is taken at the axis lock, never on pointerdown",
  lockAt > 0 && captureAt > lockAt, `lockAt=${lockAt} captureAt=${captureAt}`);
check("no pointerdown handler captures the pointer any more (WebKit retargets the click)",
  !/setPointerCapture/.test(functionBody(gallery, "const onDown =")),
  functionBody(gallery, "const onDown =").includes("setPointerCapture") ? "onDown still captures" : "onDown not found");
check("there is no blind swallow flag left (the click is checked, not timed)",
  !/swallowed\.current\s*=\s*(true|false)/.test(gallery) && /shouldSwallow\(/.test(gallery));
check("the tap/drag decision uses the finger's raw travel, not the resisted paint",
  /d\.raw = mx/.test(gallery) && /rawDx:\s*d\.raw/.test(gallery));
check("every threshold comes from the shared module (no drift back to magic numbers)",
  /from "\.\/gallery-gesture"/.test(gallery) && !/THRESHOLD\s*=|VELOCITY\s*=/.test(gallery) &&
  !/0\.18|0\.35|350/.test(gallery));
check("a release re-measures the card before it settles (rotation can't desync the track)",
  /stepPx\(\) \|\| 300/.test(gallery));
check("the track is moved in whole pixels (percentage calc() is dropped by some WebKit builds)",
  /translate3d\(\$\{Math\.round\(x\)\}px/.test(gallery));
check("the dots follow the photo (index reported up to the card)",
  /onIndexChange=\{setI\}/.test(media) && /onIdx\.current\?\.\(next\)/.test(gallery));
check("the quick-add button is a SIBLING of the card link (a nested button eats the tap)",
  /<\/Link>\s*\n\s*<QuickAdd/.test(parts));

/* ------------------------------------------------------------------ summary */
console.log(`\ntouch-audit: ${pass}/${fail}`);
if (fail) {
  console.log("  → a rule the owner tests by thumb on an iPhone just broke; see the ✗ lines above");
  process.exit(1);
}
