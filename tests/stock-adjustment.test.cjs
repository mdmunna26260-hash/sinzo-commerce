const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
const { parseStockAdjustment, adjustedStock, StockAdjustmentError } = loader()('lib/stock-adjustment.ts');
const parse = (patch = {}) => parseStockAdjustment({ productId: 1, qty: '2', ...patch });

test('manual stock accepts the numeric strings sent by the stock form', () => {
  assert.deepEqual(parse(), { productId: 1, qty: 2, mode: 'add', unitCost: null, note: '' });
  assert.equal(adjustedStock(10, 'add', -2), 8);
});

test('an exact stock count and purchase cost can explicitly be zero', () => {
  assert.deepEqual(parse({ mode: 'set', qty: '0', unitCost: '0' }), { productId: 1, qty: 0, mode: 'set', unitCost: 0, note: '' });
  assert.equal(adjustedStock(10, 'set', 0), 0);
});

test('manual stock never rounds a fractional or malformed quantity', () => {
  for (const qty of [1.5, '1.5', '', ' ', null, true, [], {}, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => parse({ qty }), StockAdjustmentError);
  }
});

test('zero additions and negative exact counts are refused', () => {
  assert.throws(() => parse({ qty: 0 }), StockAdjustmentError);
  assert.throws(() => parse({ mode: 'set', qty: -1 }), StockAdjustmentError);
});

test('stock mode, product ID, body and purchase cost are validated', () => {
  for (const mode of ['bogus', true, null]) assert.throws(() => parse({ mode }), StockAdjustmentError);
  for (const productId of [0, -1, 1.5, true, '', 2_147_483_648]) assert.throws(() => parse({ productId }), StockAdjustmentError);
  for (const body of [null, [], 'bad']) assert.throws(() => parseStockAdjustment(body), StockAdjustmentError);
  for (const unitCost of [-1, Infinity, {}, true, 'oops', 1_000_000_001]) assert.throws(() => parse({ unitCost }), StockAdjustmentError);
});

test('stock calculations cannot underflow or overflow the database integer', () => {
  assert.throws(() => adjustedStock(1, 'add', -2), StockAdjustmentError);
  assert.throws(() => adjustedStock(2_147_483_647, 'add', 1), StockAdjustmentError);
  assert.equal(adjustedStock(2_147_483_646, 'add', 1), 2_147_483_647);
});

test('stock notes stay text and are bounded', () => {
  assert.equal(parse({ note: 'n'.repeat(150) }).note.length, 120);
  assert.throws(() => parse({ note: { bad: true } }), StockAdjustmentError);
});
