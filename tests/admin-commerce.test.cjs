const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

const { parseProductInput, ProductInputError } = loader()('lib/product-input.ts');
const product = (patch = {}) => ({ title: '  Arena   Shirt  ', price: '0', stock: '0', lowStock: '0', images: [], variants: [], ...patch });

test('admin product input preserves valid zero values instead of replacing them with defaults', () => {
  const parsed = parseProductInput(product({ comparePrice: '0', cost: 0, soldCount: '0', variants: [{ price: '0', stock: '0' }] }));
  assert.equal(parsed.title, 'Arena Shirt');
  assert.equal(parsed.price, 0);
  assert.equal(parsed.stock, 0);
  assert.equal(parsed.lowStock, 0);
  assert.equal(parsed.comparePrice, 0);
  assert.equal(parsed.cost, 0);
  assert.equal(parsed.soldCount, 0);
  assert.equal(parsed.variants[0].price, 0);
  assert.equal(parsed.variants[0].stock, 0);
});

test('admin product input rejects malformed money, stock, dates and enum values', () => {
  for (const patch of [
    { price: -1 }, { price: Infinity }, { price: true }, { stock: 1.5 }, { stock: -1 },
    { lowStock: 'oops' }, { soldCount: 2.2 }, { saleEnds: 'not-a-date' },
    { preorderDate: {} }, { status: 'PUBLISHED' }, { soldMode: 'surprise' },
  ]) assert.throws(() => parseProductInput(product(patch)), ProductInputError);
});

test('admin product input bounds arrays and accepts only safe media URLs', () => {
  assert.throws(() => parseProductInput(product({ images: 'not-an-array' })), ProductInputError);
  assert.throws(() => parseProductInput(product({ variants: 'not-an-array' })), ProductInputError);
  assert.throws(() => parseProductInput(product({ images: ['javascript:alert(1)'] })), ProductInputError);
  assert.throws(() => parseProductInput(product({ images: ['/same.jpg', '/same.jpg'] })), ProductInputError);
  assert.throws(() => parseProductInput(product({ images: Array.from({ length: 31 }, (_, i) => `/image-${i}.jpg`) })), ProductInputError);
  assert.equal(parseProductInput(product({ images: ['/api/media/abc', 'https://images.example/item.jpg'] })).images.length, 2);
});

test('variant IDs and product relations must be positive database IDs', () => {
  for (const patch of [
    { categoryId: 0 }, { colorGroupId: -1 }, { variants: [{ id: 1.5 }] }, { variants: [{ id: true }] },
    { variants: [{ id: 7 }, { id: 7 }] },
  ]) assert.throws(() => parseProductInput(product(patch)), ProductInputError);
});

function deletionHarness(orderPatch = {}, deducted = false) {
  const calls = [];
  const order = {
    id: 7, code: 'ORD-1007', name: 'Test Buyer', total: 1200, status: 'PENDING',
    couponCode: 'SAVE10', courierConsignmentId: null, items: [], ...orderPatch,
  };
  const tx = {
    coupon: { updateMany: async (query) => calls.push(['coupon', query]) },
    abandonedCheckout: { updateMany: async (query) => calls.push(['abandoned', query]) },
    waMessage: { updateMany: async (query) => calls.push(['wa', query]) },
    inboxMessage: { updateMany: async (query) => calls.push(['inbox', query]) },
    order: { delete: async (query) => calls.push(['delete', query]) },
    auditLog: { create: async (query) => calls.push(['audit', query]) },
  };
  const db = { $transaction: async (fn) => fn(tx) };
  const mod = loader({
    './db': { db },
    './db-ensure': { ensureExtraTables: async () => calls.push(['ensure']) },
    './deliver-stock': { lockOrder: async () => order, stockWasDeducted: async () => deducted },
  })('lib/order-deletion.ts');
  return { ...mod, calls };
}

test('admin order deletion cleans coupon, recovery and message references atomically', async () => {
  const { deleteAdminOrder, calls } = deletionHarness();
  assert.deepEqual(await deleteAdminOrder(7, 'admin@example.test'), { id: 7, code: 'ORD-1007' });
  assert.ok(calls.some(([name]) => name === 'coupon'));
  assert.ok(calls.some(([name, query]) => name === 'abandoned' && query.data.checkoutStatus === 'OPEN'));
  assert.equal(calls.filter(([name]) => name === 'wa').length, 2);
  assert.ok(calls.some(([name]) => name === 'delete'));
  assert.ok(calls.some(([name, query]) => name === 'audit' && query.data.action === 'ORDER_DELETED'));
});

test('delivered, stock-deducted and courier-active orders cannot be hard-deleted', async () => {
  for (const [patch, deducted] of [
    [{ status: 'DELIVERED' }, false],
    [{ status: 'CANCELLED' }, true],
    [{ status: 'SHIPPED', courierConsignmentId: 'SF-1' }, false],
  ]) {
    const { deleteAdminOrder, calls, OrderDeletionError } = deletionHarness(patch, deducted);
    await assert.rejects(deleteAdminOrder(7, 'admin@example.test'), OrderDeletionError);
    assert.equal(calls.some(([name]) => name === 'delete'), false);
  }
});
