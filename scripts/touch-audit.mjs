#!/usr/bin/env node
/* ============================================================================
   touch-audit — the three iPhone rules, as assertions
   ----------------------------------------------------------------------------
   The owner accepts a product card and a product rail with three thumb tests:

     1. ONE tap opens the product page (never two)
     2. a swipe changes the photo / turns the rail, and never opens the product page
     3. a vertical drag scrolls the page

   Run:  node scripts/touch-audit.mjs          (npm run test:touch)
   No install, no browser, no database. The gesture maths lives in
   components/gesture-math.ts as pure functions, so every decision a phone makes
   can be asserted here exactly as it happens on the device — and the wiring that
   cannot be pure (which listener, which phase, which element) is checked against
   the source it has to be in.

   The browser half of the same acceptance test drives a real Chromium with real
   touch events:  scripts/_sandbox/gesture/real.mjs (see README.md in that folder).

   The rules are worded from the reports they come from:
     "product image swipe korle change hoy na"      → the surface owns the horizontal
                                                      axis (touchmove, non-passive) and
                                                      always settles — even on a cancel
     "product page open korte 2 bar tap korte hoy"  → a tap is never eaten by the drag
                                                      that happened before it
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

/* The component files explain the bugs they fixed in comments — which quote the very API names
   these checks look for ("setPointerCapture", "350ms"). Scan CODE, not prose. */
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
   gesture-math.ts must stay pure: no imports, no DOM, no timers. It is compiled with the
   repo's own TypeScript and executed in a bare context — so an accidental
   `import ... from "react"` fails this audit instead of silently shipping. */
const ts = (await import(pathToFileURL(path.join(REPO, "node_modules", "typescript", "lib", "typescript.js")).href)).default;
const src = read("components/gesture-math.ts");
const compiled = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "gesture-math.ts",
}).outputText;
const moduleShim = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleShim,
  exports: moduleShim.exports,
  require: (id) => { throw new Error("gesture-math.ts must stay dependency-free (it imported " + id + ")"); },
  Math, Date, console, performance: { now: () => 0 },
});
const G = moduleShim.exports;
const clampTo = (n, max) => Math.max(0, Math.min(max, n));

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
check('a fresh tap a thumb away is NEVER swallowed — the "2 bar lagbe" bug',
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
   G.slideAfter({ dx: 9999, ms: 1, width: 300, index: 0, count: 1 })].every((i) => clampTo(i, 0) === i));
check("a rail turns one page on 18% of its width, and stays on a nudge",
  G.railTarget({ dx: -72, width: 400, ms: 400, page: 0, pages: 4 }) === 0 &&
  G.railTarget({ dx: -73, width: 400, ms: 400, page: 0, pages: 4 }) === 1);
check("a narrow rail still needs a deliberate drag (24px floor)",
  G.railTarget({ dx: -24, width: 80, ms: 400, page: 1, pages: 4 }) === 1 &&
  G.railTarget({ dx: -26, width: 80, ms: 400, page: 1, pages: 4 }) === 2);
check("a rail flick counts even when short, and never leaves the rail",
  G.railTarget({ dx: -20, width: 400, ms: 20, page: 0, pages: 4 }) === 1 &&
  G.railTarget({ dx: 300, width: 400, ms: 30, page: 0, pages: 4 }) === 0 &&
  G.railTarget({ dx: -300, width: 400, ms: 30, page: 3, pages: 4 }) === 3);
check("a cancelled rail gesture still turns (it is not rewound)",
  G.railTarget({ dx: -200, width: 400, ms: 900, page: 0, pages: 4 }) === 1);

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
check("the rail owns the horizontal axis (touch-action: pan-y)",
  /touch-action:\s*pan-y/.test(ruleBody(".crs-track") + ruleBody(".rel-scroll")));
check("the card link keeps taps instant (touch-action: manipulation)",
  rules.some((r) => r.selector.split(",").map((s) => s.trim()).includes("a") && /touch-action:\s*manipulation/.test(r.body)));
check("the dots row exists, and only the current one is marked",
  /\.pcard-dots\s*\{/.test(css) && /\.pcard-dots i\.on\s*\{/.test(css));
check("entrance animations on a touch screen never MOVE the card (fade only)",
  rules.some((r) => /\.reveal/.test(r.selector) && /transform:\s*none/.test(r.body) &&
    r.media.some((m) => /hover:\s*none/.test(m))));
check("the badges never eat a tap", /\.pcard-badges\s*\{[^}]*pointer-events:\s*none/.test(css));

/* A hover rule that changes the geometry (transform/size/display) of the element under the
   finger makes iOS spend the first tap on the hover state and drop the click. Every such rule
   must therefore be inside @media (hover: hover) — the one thing a touch screen cannot do. */
const GEOMETRY = /(^|[;{\s])(transform|display|visibility|height|width|top|left|right|bottom|margin|padding|aspect-ratio|flex|grid-template)\s*:/;
const nakedHover = rules.filter((r) =>
  r.selector.includes(":hover") && GEOMETRY.test(r.body) &&
  !r.media.some((m) => /hover:\s*hover/.test(m)));
check("no unguarded :hover rule moves the thing the finger is on",
  nakedHover.length === 0, nakedHover.map((r) => r.selector).join(" | "));

/* ============================================================ the component wiring */
section("component wiring (the parts a pure function cannot see)");
const gallery = stripComments(read("components/card-gallery.tsx"));
const swipe = stripComments(read("components/use-swipe.ts"));
const rail = stripComments(read("components/swipe-rail.ts"));
const parts = stripComments(read("components/parts.tsx"));

/* the body of one arrow function, by brace balance — so a check about one handler cannot
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

check("no pointer capture anywhere (WebKit retargets the tap's click)",
  !/setPointerCapture/.test(gallery) && !/setPointerCapture/.test(swipe) && !/setPointerCapture/.test(rail));
check("the touch stream is driven by real, non-passive touchmove listeners (React's would be passive)",
  /addEventListener\("touchmove",\s*onTouchMove,\s*\{\s*passive:\s*false\s*\}\)/.test(swipe) &&
  /"touchstart",\s*onTouchStart/.test(swipe) && /"touchend",\s*onTouchEnd/.test(swipe));
check("a horizontal drag is taken away from the browser at the axis lock",
  /move\(t\.clientX, t\.clientY\) === "x"\) e\.preventDefault\(\)/.test(swipe));
check("a cancelled gesture keeps its distance (no rewind to where it started)",
  /finish\(true, t\?\.clientX, t\?\.clientY\)/.test(swipe) &&
  /cancelled,/.test(functionBody(swipe, "const r: SwipeRelease =")) &&
  /o\(\)\.onEnd\?\.\(r\)/.test(functionBody(swipe, "const finish =")));
check("the swallow is checked by place AND time, never by a blind timer",
  /shouldSwallow\(plan\.current/.test(swipe) && !/setTimeout/.test(swipe));
check("a new gesture clears the previous swallow (swipe, then tap → one tap)",
  /plan\.current = null;\s*c\.onStart\?\.\(\)/.test(swipe));
check("nothing in the drag machine re-renders (no useState)",
  !/useState/.test(swipe));
check("the rail leaves a card's own photo gallery alone",
  /closest\?\.\("\.cg-swipeable"\)/.test(rail));
check("the rail keeps the mouse out (a desktop drag means select text)",
  /mouse:\s*false/.test(rail));
check("the rail drives scrollLeft page-wise, so its arrows/dots/onScroll maths is untouched",
  /goTo\(target\)/.test(rail) && !/scrollBy/.test(rail));
check("the gallery takes its thresholds from the shared module (no drift back to magic numbers)",
  /from "\.\/gesture-math"/.test(gallery) && !/THRESHOLD\s*=|VELOCITY\s*=/.test(gallery) && !/0\.18|0\.35|350/.test(gallery));
check("the card's incoming photo is mounted on the next frame, never inside the touch task",
  /requestAnimationFrame\(mountNeighbours\)/.test(gallery));
check("the track is moved in whole pixels (percentage calc() is dropped by some WebKit builds)",
  /translate3d\(\$\{Math\.round\(x\)\}px/.test(gallery));
check("a release re-measures the card before it settles (rotation cannot desync the track)",
  /width:\s*stepPx\(\)/.test(gallery) && /stepPx\(\) \?\? 0|stepPx\b/.test(gallery));
check("...and an unmeasured card still swipes (the fallback lives in the pure module)",
  G.FALLBACK_WIDTH === 300 && G.slideAfter({ dx: -80, ms: 60, width: 0, index: 0, count: 3 }) === 1);
check("the dots follow the photo (the index is reported up to the card)",
  /onIndexChange=\{setI\}/.test(stripComments(read("components/card-media.tsx"))) &&
  /onIdx\.current\?\.\(next\)/.test(gallery));
check("the quick-add button is a SIBLING of the card link (a nested button eats the tap)",
  /<\/Link>\s*\n\s*<QuickAdd/.test(parts));
check("an arrow press never starts a drag", /closest\?\.\("\.cg-arrow"\)/.test(gallery));

/* ------------------------------------------------------------------ summary */
console.log(`\ntouch-audit: ${pass}/${fail}`);
if (fail) {
  console.log("  → a rule the owner tests by thumb on a phone just broke; see the ✗ lines above");
  process.exit(1);
}
console.log("  the browser half: see scripts/_sandbox/gesture/README.md (real Chromium + touch events)");
