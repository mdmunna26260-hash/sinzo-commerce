const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
const { discountPercent, pickDiscountProducts, pickLimitedProducts } = loader()('lib/home-merchandising.ts');

const p = (id, patch = {}) => ({ id, price: 1000, comparePrice: null, stock: 20, lowStock: 5, position: id, badge: null, preorder: false, ...patch });

test('homepage discounts include only real in-stock reductions and rank the strongest offer first', () => {
  const products = [
    p(1, { price: 800, comparePrice: 1000 }),
    p(2, { price: 500, comparePrice: 1000 }),
    p(3, { price: 1200, comparePrice: 1000 }),
    p(4, { price: 600, comparePrice: 1000, stock: 0 }),
    p(5, { price: 600, comparePrice: 1000, stock: 0, preorder: true }),
  ];
  assert.deepEqual(pickDiscountProducts(products).map((x) => x.id), [2, 5, 1]);
  assert.equal(discountPercent(products[1]), 50);
  assert.equal(discountPercent(products[2]), 0);
});

test('homepage limited shelf uses honest stock quantities instead of fake scarcity', () => {
  const products = [p(1, { stock: 30 }), p(2, { stock: 6 }), p(3, { stock: 12 }), p(4, { stock: 0 }), p(5, { stock: 40, badge: 'limited' })];
  assert.deepEqual(pickLimitedProducts(products).map((x) => x.id), [2, 3, 5]);
});

test('a catalogue with healthy inventory produces no fabricated limited shelf', () => {
  const products = Array.from({ length: 7 }, (_, index) => p(index + 1, { stock: 40 - index }));
  assert.deepEqual(pickLimitedProducts(products), []);
});
