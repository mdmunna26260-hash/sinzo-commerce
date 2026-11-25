const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('app/products/[slug]/client.tsx');
const page = read('app/products/[slug]/page.tsx');
const css = read('app/products/[slug]/pdp.css');

test('PDP redesign preserves original cart payload, add/buy handlers and ViewContent effect', () => {
  // Snapshot taken before the visual redesign. This protects the existing purchase
  // and advertising contract from being replaced by the reference's demo handlers.
  const original = JSON.parse(read('tests/fixtures/pdp-purchase-contract.json'));
  const ast = ts.createSourceFile('client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const actual = {};
  function walk(node) {
    if (ts.isVariableDeclaration(node) && ['line', 'addLine', 'buyNow'].includes(node.name.getText(ast))) actual[node.name.getText(ast)] = node.initializer.getText(ast);
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.getText(ast).includes('trackEvent("ViewContent"')) actual.viewContentEffect = node.getText(ast);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.deepEqual(actual, original);
  assert.doesNotMatch(source, /submitQuickOrder|codCheckoutModal|UNIT_PRICE|ORD-1080/);
});

test('editorial layout uses scoped route CSS and moves policies into the purchase column', () => {
  assert.match(page, /import "\.\/pdp\.css"/);
  assert.match(page, /<main className="container pdp-shell">/);
  assert.match(page, /aria-label="Breadcrumb"/);
  assert.ok(source.indexOf('className="pdp-info"') < source.indexOf('className="pdp-details"'));
  assert.match(css, /\.pdp-editorial \.mgal-viewport \{[^}]*border: 0;[^}]*border-radius: 0;/);
  assert.match(css, /margin-inline: -16px; width: calc\(100% \+ 32px\)/);
  assert.match(css, /object-fit: contain/);
  assert.doesNotMatch(css, /@import|fonts\.googleapis|cdn\.tailwindcss/);
});

test('both PDP galleries use the requested 4:5 ratio without changing the global admin ratio', () => {
  assert.match(css, /\.pdp-editorial \.pdp-main-img,\s*\.pdp-editorial \.mgal-viewport \{ aspect-ratio: 4 \/ 5;/);
  assert.doesNotMatch(css, /aspect-ratio: 4 \/ 4\.4/);
  const layout = read('app/layout.tsx');
  assert.match(layout, /safeAspectRatio\(theme\.productImageRatio\)/);
  assert.match(layout, /--img-ratio:\$\{imgRatio\}/);
});

test('quick-buy bar reuses buyNow, respects stock/busy state and hides for dialogs', () => {
  const bar = source.slice(source.indexOf('{showQuickBar &&'), source.indexOf('{/* size chart modal */}'));
  assert.match(bar, /!chart && !lightbox/);
  assert.match(bar, /onClick=\{buyNow\}/);
  assert.match(bar, /disabled=\{\(avail <= 0 && !preorder\) \|\| buying \|\| adding\}/);
  assert.match(bar, /price\.toLocaleString/);
  assert.match(bar, /Size \$\{size\}/);
  assert.match(source, /actions\.getBoundingClientRect\(\)\.bottom <= 80/);
  assert.match(source, /window\.removeEventListener\("scroll", update\)/);
  assert.match(source, /cancelAnimationFrame\(frame\)/);
});

test('gallery uses real image counts and accessible dialogs without losing responsive delivery', () => {
  const mobile = read('components/mobile-gallery.tsx');
  assert.match(source, /\{N \? img \+ 1 : 0\} \/ \{N\}/);
  assert.match(mobile, /\{active \+ 1\} \/ \{N\}/);
  assert.match(mobile, /fetchPriority=\{i === 0 \? "high" : undefined\}/);
  assert.match(mobile, /onTouchCancel=\{onTouchEnd\}/);
  assert.match(source, /role="dialog" aria-modal="true" aria-label="Size guide"/);
  assert.match(source, /role="dialog" aria-modal="true" aria-label="Product images"/);
  assert.match(source, /document\.body\.style\.overflow = overflow/);
  assert.match(source, /previous\.focus\(\{ preventScroll: true \}\)/);
  // Both galleries and the server preload still share a single sizes contract.
  assert.match(page, /imageSizes=\{PDP_SIZES\}/);
  assert.match(source, /sizes=\{PDP_SIZES\}/);
  assert.match(mobile, /sizes=\{PDP_SIZES\}/);
});

test('gallery has no text label and description starts expanded with a native collapse control', () => {
  assert.doesNotMatch(source, /pdp-gallery-tag/);
  assert.doesNotMatch(read('components/mobile-gallery.tsx'), /pdp-gallery-tag|>Product gallery</);
  const description = source.slice(source.indexOf('<details className="acc-item pdp-description"'), source.indexOf('<summary><span>Return &amp; care</span>'));
  assert.match(description, /<details className="acc-item pdp-description" open aria-labelledby="pdp-description-heading"/);
  assert.match(description, /<summary id="pdp-description-heading"/);
  assert.match(description, /<i className="acc-ico" aria-hidden="true"/);
  assert.match(description, /<FormattedDescription text=\{product\.description\}/);
  assert.match(css, /\.pdp-shell > \.reviews \{ padding: 20px 0; \}/);
  assert.match(css, /\.pdp-shell > \.pdp-related \{ padding: 12px 0 16px; \}/);
});
