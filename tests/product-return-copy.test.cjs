const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../app/products/[slug]/client.tsx'), 'utf8');
const copy = source.slice(source.indexOf('<h4>Return &amp; exchange</h4>'), source.indexOf('<h4>Caring for it</h4>'));

test('PDP return copy explains inspection and return before the delivery agent leaves', () => {
  assert.match(copy, /check your product in the presence of the delivery agent/);
  assert.match(copy, /at the time of delivery, before the agent leaves/);
});

test('PDP exchange copy uses two days and requires undamaged products with original tags', () => {
  assert.match(copy, /Exchanges are available within 2 days of delivery/);
  assert.match(copy, /undamaged, with all original tags intact/);
  assert.match(copy, /Damaged products or items without their original tags cannot be accepted for return or exchange/);
  // the trust row is three cards now, so the promise is split across title + subline
  assert.match(source, /<b>Check on delivery<\/b><span>Export quality product<\/span>/);
  assert.match(source, /<b>Easy exchange<\/b><span>Within 2 days<\/span>/);
  assert.match(source, /<b>Easy return<\/b><span>Before the rider leaves<\/span>/);
  assert.doesNotMatch(source, /7-day easy return|7-day return &amp; exchange|returns are free, we arrange the courier pickup/);
});

test('PDP delivery offers four-hour Pathao delivery within Dhaka and the requested WhatsApp contact', () => {
  const delivery = source.slice(source.indexOf('<summary><span>Need urgent delivery at Dhaka?</span>'), source.indexOf('{/* size chart modal */}'));
  assert.match(delivery, /Need urgent delivery at Dhaka\?/);
  assert.match(delivery, /delivery address is within Dhaka/);
  assert.match(delivery, /delivery via Pathao within 4 hours/);
  assert.match(delivery, /href="https:\/\/wa\.me\/8801576450711" target="_blank" rel="noopener noreferrer"/);
  assert.match(delivery, />01576450711<\/a>/);
  assert.doesNotMatch(delivery, /Inside Dhaka|Outside Dhaka|Cash on Delivery|Free delivery on orders|Track the parcel|<ul/);
});

/* Description is the reason most visitors are on the page, so it ships OPEN with a − on the
   right (the reference design). The other two rows stay collapsed to keep the page compact. */
const detailsTagBefore = (marker) => {
  const at = source.indexOf(marker);
  assert.ok(at > 0, 'expected ' + marker + ' in the PDP source');
  return source.slice(source.lastIndexOf('<details', at), at);
};

test('PDP description starts expanded and the other rows start collapsed', () => {
  const description = detailsTagBefore('<span>Description</span>');
  assert.match(description, /<details className="acc-item" open>/);
  for (const collapsed of ['<span>Return &amp; care</span>', '<span>Need urgent delivery at Dhaka?</span>']) {
    assert.doesNotMatch(detailsTagBefore(collapsed), /\sopen[\s>]/, collapsed + ' must not start open');
  }
});

test('PDP trust row is three cards, one per promise', () => {
  const cards = source.match(/className="pdp-trust-card"/g) || [];
  assert.equal(cards.length, 3);
  assert.match(source, /className="pdp-trust" aria-label="Delivery and payment promises"/);
});

/* The description size is a setting, not a hard-coded number: the renderer must not carry
   inline px values (they would win over the CSS variable) and layout.tsx must emit the var. */
const fs2 = require('node:fs');
const path2 = require('node:path');
const root = path2.join(__dirname, '..');

test('PDP description text is sized by the --pdp-desc-size variable, not inline px', () => {
  const renderer = source.slice(source.indexOf('function FormattedDescription'));
  assert.match(renderer, /className="pdp-desc-body"/);
  for (const cls of ['pdp-desc-p', 'pdp-desc-h', 'pdp-desc-list', 'pdp-desc-li']) {
    assert.match(renderer, new RegExp('className="' + cls + '"'), cls + ' missing');
  }
  assert.doesNotMatch(renderer, /fontSize:\s*1[0-9]/, 'description still has a hard-coded font size');
  assert.doesNotMatch(renderer, /marginBottom:\s*1[0-9]/, 'description still has a hard-coded paragraph gap');
});

test('the description size and line-gap settings reach :root and are clamped', () => {
  const layout = fs2.readFileSync(path2.join(root, 'app/layout.tsx'), 'utf8');
  assert.match(layout, /safeCssFontSize\(theme\.descriptionSize\)/);
  assert.match(layout, /--pdp-desc-size:\$\{descSize\}px/);
  assert.match(layout, /safeCssLineHeight\(theme\.descriptionLineHeight\)/);
  assert.match(layout, /--pdp-desc-lh:\$\{descLineHeight\}/);
  const css = fs2.readFileSync(path2.join(root, 'app/globals.css'), 'utf8');
  assert.match(css, /\.pdp-desc-body \{ font-size: var\(--pdp-desc-size, 14px\)/);
  // line spacing must be the setting, not a literal — and both paragraphs and the wrapper
  // have to read it, otherwise a change moves only half the block
  assert.match(css, /\.pdp-desc-body \{[^}]*line-height: var\(--pdp-desc-lh, 1\.45\)/);
  assert.match(css, /\.acc-body \.pdp-desc-p \{[^}]*line-height: var\(--pdp-desc-lh, 1\.45\)/);
  assert.doesNotMatch(css, /line-height: 1\.55/);
  assert.match(css, /\.acc-body \.pdp-desc-p \{[^}]*margin: 0 0 \.45em/);
  const settings = fs2.readFileSync(path2.join(root, 'app/admin/(panel)/settings/client.tsx'), 'utf8');
  assert.match(settings, /Description text size \(px\)/);
  assert.match(settings, /descriptionSize/);
  assert.match(settings, /Description line gap/);
  assert.match(settings, /descriptionLineHeight/);
});
