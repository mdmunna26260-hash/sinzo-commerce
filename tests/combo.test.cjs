/* Combo offers: quantity tiers (2 ta 1600 / 3 ta 2300) + cross-product bundles.
   Run with: npm run test:unit */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

const { normalizeComboOffers, serializeComboOffers, comboQuote, cartComboQuote, normalizeBundles, bestBundleSavings } = loader()('lib/combo.ts');
const { buildCheckoutItems } = loader()('lib/checkout-items.ts');

test('normalizeComboOffers: parses JSON string, drops invalid rows, sorts+dedups', () => {
  assert.deepEqual(normalizeComboOffers('[{"qty":3,"total":2300},{"qty":2,"total":1600},{"qty":1,"total":100},{"qty":2,"total":9999}]'),
    [{ qty: 2, total: 1600 }, { qty: 3, total: 2300 }]);
  assert.deepEqual(normalizeComboOffers('not json'), []);
  assert.deepEqual(normalizeComboOffers(null), []);
  assert.equal(serializeComboOffers([{ qty: 2, total: 1600 }]), '[{"qty":2,"total":1600}]');
  assert.equal(serializeComboOffers([]), null);
});

test('comboQuote: 900 taka product — 1/2/3/5 items', () => {
  const offers = [{ qty: 2, total: 1600 }, { qty: 3, total: 2300 }];
  assert.deepEqual(comboQuote(900, 1, offers), { subtotal: 900, savings: 0, tierQty: null });
  assert.deepEqual(comboQuote(900, 2, offers), { subtotal: 1600, savings: 200, tierQty: 2 });
  assert.deepEqual(comboQuote(900, 3, offers), { subtotal: 2300, savings: 400, tierQty: 3 });
  // 5 items: best is tier3 + 2 base = 2300+1800 = 4100 (same as 2+2+1)
  assert.equal(comboQuote(900, 5, offers).subtotal, 4100);
  assert.equal(comboQuote(900, 5, offers).savings, 400); // base 4500 − 4100
});

test('comboQuote: a worse-than-base tier never increases price', () => {
  const bad = [{ qty: 2, total: 2000 }]; // 2x900=1800 base is cheaper
  assert.equal(comboQuote(900, 2, bad).subtotal, 1800);
  assert.equal(comboQuote(900, 2, bad).savings, 0);
});

test('cartComboQuote: same product across sizes combines; others untouched', () => {
  const lines = [
    { productId: 1, price: 900, qty: 1, comboOffers: '[{"qty":2,"total":1600},{"qty":3,"total":2300}]' },
    { productId: 1, price: 900, qty: 2, comboOffers: '[{"qty":2,"total":1600},{"qty":3,"total":2300}]' }, // +3 total → tier3
    { productId: 2, price: 500, qty: 1, comboOffers: null },
  ];
  const q = cartComboQuote(lines);
  assert.equal(q.subtotal, 2300 + 500);
  assert.equal(q.savings, 400);
});

test('bundles: applies only when every product is in the cart, best bundle wins', () => {
  const bundles = [
    { id: 1, price: 2500, active: true, productIds: [1, 2] },
    { id: 2, price: 1000, active: true, productIds: [1, 3] },
    { id: 3, price: 999, active: false, productIds: [2, 3] }, // inactive → ignored
  ];
  const lines = [
    { productId: 1, price: 900, qty: 1 },
    { productId: 2, price: 1800, qty: 1 },
    { productId: 3, price: 500, qty: 2 },
  ];
  // bundle1: 900+1800=2700 → save 200; bundle2: 900+500=1400 → save 400 (best)
  assert.equal(bestBundleSavings(lines, bundles), 400);
  assert.equal(bestBundleSavings([{ productId: 1, price: 900, qty: 1 }], bundles), 0); // missing products
  assert.deepEqual(normalizeBundles([{ price: 100, productIds: [1] }]), []); // single product ≠ bundle
});

test('buildCheckoutItems: server applies combo only to comboEligible products + bundle, reports savings', () => {
  const products = [
    { id: 1, title: 'Tee', price: 900, stock: 99, comboEligible: true, comboOffers: '[{"qty":2,"total":1600},{"qty":3,"total":2300}]', variants: [], images: [] },
    { id: 2, title: 'Pant', price: 1800, stock: 99, comboEligible: true, comboOffers: null, variants: [], images: [] },
    { id: 3, title: 'Cap', price: 500, stock: 99, comboEligible: false, comboOffers: '[{"qty":2,"total":100}]', variants: [], images: [] },
  ];
  const lines = [
    { productId: 1, variantId: null, qty: 3 },
    { productId: 2, variantId: null, qty: 1 },
    { productId: 3, variantId: null, qty: 2 },
  ];
  const bundles = [{ id: 1, price: 2500, active: true, productIds: [1, 2] }]; // 1 unit of 1+2 = 2700 → save 200
  const r = buildCheckoutItems(lines, products, { bundles });
  // tee: tier3 ≈2300; pant 1800; cap NOT eligible → 2x500=1000; bundle (base 2700−2500) −200
  assert.equal(r.subtotal, 4900); // exact — no rounding drift
  assert.ok(Math.abs(r.comboSavings - 600) < 1, "comboSavings ~600, got " + r.comboSavings);
});

test('buildCheckoutItems: no rounding drift on tier subtotal (3x900 → exactly 2300)', () => {
  const products = [{ id: 1, title: 'Tee', price: 900, stock: 99, comboEligible: true, comboOffers: '[{"qty":2,"total":1600},{"qty":3,"total":2300}]', variants: [], images: [] }];
  const r = buildCheckoutItems([{ productId: 1, variantId: null, qty: 3 }], products, {});
  assert.equal(r.subtotal, 2300);
  assert.equal(r.comboSavings, 400);
  // displayed line prices still sum to the group total (±0.02 rounding on per-unit display)
  assert.ok(Math.abs(r.items.reduce((s, i) => s + i.price * i.qty, 0) - 2300) < 0.05);
});

/* ── department-level combo rule ── */
const { normalizeDeptTiers, deptDiscount } = loader()('lib/combo.ts');

test('dept rule: 1 item no discount, 2 items = set amount, 3 items = bigger amount', () => {
  const tiers = [{ qty: 2, discount: 200 }, { qty: 3, discount: 400 }];
  assert.equal(deptDiscount(1, tiers), 0);
  assert.equal(deptDiscount(2, tiers), 200);
  assert.equal(deptDiscount(3, tiers), 400);
  assert.equal(deptDiscount(7, tiers), 400); // best reachable tier only
  assert.deepEqual(normalizeDeptTiers([{ qty: 3, discount: 400 }, { qty: 2, discount: 200 }, { qty: 1, discount: 50 }]), tiers);
});

test('buildCheckoutItems: department rule counts only comboEligible units', () => {
  const products = [
    { id: 1, title: 'A', price: 900, stock: 99, comboEligible: true, comboOffers: null, variants: [], images: [] },
    { id: 2, title: 'B', price: 500, stock: 99, comboEligible: true, comboOffers: null, variants: [], images: [] },
    { id: 3, title: 'C', price: 300, stock: 99, comboEligible: false, comboOffers: null, variants: [], images: [] },
  ];
  const tiers = [{ qty: 2, discount: 200 }, { qty: 3, discount: 400 }];
  // 1 eligible + 1 non-eligible = only 1 combo unit → no discount
  let r = buildCheckoutItems([{ productId: 1, variantId: null, qty: 1 }, { productId: 3, variantId: null, qty: 1 }], products, { deptTiers: tiers });
  assert.equal(r.subtotal, 1200); assert.equal(r.comboSavings, 0);
  // 2 eligible units (different products) → 200 off
  r = buildCheckoutItems([{ productId: 1, variantId: null, qty: 1 }, { productId: 2, variantId: null, qty: 1 }], products, { deptTiers: tiers });
  assert.equal(r.subtotal, 1400 - 200); assert.equal(r.comboSavings, 200);
  // 3 eligible units → 400 off
  r = buildCheckoutItems([{ productId: 1, variantId: null, qty: 2 }, { productId: 2, variantId: null, qty: 1 }], products, { deptTiers: tiers });
  assert.equal(r.subtotal, 2300 - 400); assert.equal(r.comboSavings, 400);
});

/* ── free gift rule ── */
const { normalizeGiftRule, giftEntitlement } = loader()('lib/gift.ts');

test('gift rule: tiers, entitlement, pool validation', () => {
  const rule = normalizeGiftRule({ enabled: true, tiers: [{ amount: 2500, freeQty: 1 }, { amount: 5000, freeQty: 2 }], productIds: [7, 8], excludeProductIds: [9] });
  assert.equal(giftEntitlement(2499, rule), 0);
  assert.equal(giftEntitlement(2500, rule), 1);
  assert.equal(giftEntitlement(4999, rule), 1);
  assert.equal(giftEntitlement(5000, rule), 2);
  assert.deepEqual(rule.productIds, [7, 8]);
});

test('buildCheckoutItems: free gift line priced 0, validated against threshold, excluded products dont count', () => {
  const products = [
    { id: 1, title: 'Shirt', price: 2600, stock: 99, comboEligible: false, comboOffers: null, variants: [{ id: 11, size: 'M', stock: 5, price: null }], images: [] },
    { id: 7, title: 'Free Tee', price: 500, stock: 99, comboEligible: false, comboOffers: null, variants: [{ id: 71, size: 'L', stock: 9, price: null }], images: [] },
    { id: 9, title: 'Excluded', price: 9999, stock: 99, comboEligible: false, comboOffers: null, variants: [], images: [] },
  ];
  const gift = { enabled: true, tiers: [{ amount: 2500, freeQty: 1 }], productIds: [7], excludeProductIds: [9] };
  // 2600 shirt + 9999 excluded → eligible 2600 ≥ 2500 → 1 free allowed
  let r = buildCheckoutItems([
    { productId: 1, variantId: 11, qty: 1 },
    { productId: 9, variantId: null, qty: 1 },
    { productId: 7, variantId: 71, qty: 1, freeGift: true },
  ], products, { gift });
  assert.equal(r.giftSavings, 500);
  assert.equal(r.subtotal, 2600 + 9999); // gift charged 0
  const giftItem = r.items.find((i) => i.productId === 7);
  assert.equal(giftItem.price, 0);
  // below threshold → reject
  assert.throws(() => buildCheckoutItems([{ productId: 7, variantId: 71, qty: 1, freeGift: true }], products, { gift }), /no longer available/);
  // gift not in pool → reject
  assert.throws(() => buildCheckoutItems([{ productId: 1, variantId: 11, qty: 1 }, { productId: 9, variantId: null, qty: 1 }, { productId: 1, variantId: 11, qty: 1, freeGift: true }], products, { gift }), /not in the offer pool/);
});
