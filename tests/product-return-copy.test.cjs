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
  assert.match(source, /<b>Easy exchange<\/b><span>Within 2 days<\/span>/);
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
