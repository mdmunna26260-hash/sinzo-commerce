const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
const { nextDockScroll } = loader()('lib/dock-scroll.ts');
const start = { lastY: 100, travel: 0, hidden: false };

test('dock hides after deliberate downward scrolling and shows on upward scrolling', () => {
  let s = nextDockScroll(start, 115, 1000);
  assert.equal(s.hidden, false);
  s = nextDockScroll(s, 125, 1000);
  assert.equal(s.hidden, true);
  s = nextDockScroll(s, 120, 1000);
  assert.equal(s.hidden, true);
  s = nextDockScroll(s, 114, 1000);
  assert.equal(s.hidden, false);
});
test('dock ignores alternating trackpad jitter', () => {
  let s = start;
  for (const y of [102, 100, 104, 101, 105, 102]) s = nextDockScroll(s, y, 1000);
  assert.equal(s.hidden, false);
});
test('dock shows near page top and on pages without scrollable content', () => {
  assert.equal(nextDockScroll({ lastY: 70, travel: 24, hidden: true }, 40, 1000).hidden, false);
  assert.equal(nextDockScroll(start, 200, 0).hidden, false);
});
test('iOS rubber-band overscroll does not create a false direction change at bottom', () => {
  let s = { lastY: 1000, travel: 24, hidden: true };
  s = nextDockScroll(s, 1050, 1000);
  s = nextDockScroll(s, 1000, 1000);
  assert.equal(s.hidden, true);
  assert.equal(s.lastY, 1000);
  assert.equal(nextDockScroll(s, 989, 1000).hidden, false);
});
test('negative rubber-band scroll is clamped at top', () => {
  assert.deepEqual(nextDockScroll(start, -50, 1000), { lastY: 0, travel: 0, hidden: false });
});
