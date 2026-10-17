const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const control = read('components/auto-scroll-control.tsx');

test('catalogue auto-scroll is opt-in and reduced-motion safe', () => {
  assert.match(control, /useState\(false\)/, 'must default to off');
  assert.match(control, /prefers-reduced-motion: reduce/);
  assert.match(control, /if \(media\.matches\) setActive\(false\)/);
  assert.doesNotMatch(control, /localStorage/, 'the opt-in must not silently persist');
});

test('catalogue auto-scroll pauses for real interaction and hidden tabs', () => {
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    assert.ok(control.includes(`addEventListener("${event}"`), `${event} should pause auto-scroll`);
  }
  assert.match(control, /document\.visibilityState === "visible"/);
  assert.match(control, /pausedUntil\.current/);
  assert.match(control, /requestAnimationFrame/);
});

test('auto-scroll control is present on shop results and collection pages', () => {
  assert.match(read('app/products/shop-layout.tsx'), /<AutoScrollControl \/>/);
  assert.match(read('app/collections/[slug]/page.tsx'), /<AutoScrollControl \/>/);
});
