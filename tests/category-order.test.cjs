const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
const { flattenCategoryTree } = loader()('lib/category-tree.ts');

const cats = [
  { id: 1, name: 'Alpha', slug: 'a', parentId: null, position: 2 },
  { id: 2, name: 'Zulu', slug: 'z', parentId: null, position: 1 },
  { id: 3, name: 'Child A', slug: 'ca', parentId: 2, position: 2 },
  { id: 4, name: 'Child Z', slug: 'cz', parentId: 2, position: 1 },
];
test('saved category order applies to roots and children without separating subtrees', () => {
  assert.deepEqual(flattenCategoryTree(cats).map(c => c.id), [2, 4, 3, 1]);
});
test('legacy categories retain alphabetical order when positions are equal', () => {
  assert.deepEqual(flattenCategoryTree(cats.map(c => ({ ...c, position: 0 }))).map(c => c.id), [1, 2, 3, 4]);
});

function endpoint({ denied = false, fail = false } = {}) {
  const writes = [], invalidated = [];
  const tx = { category: {
    findUnique: async ({ where }) => cats.find(c => c.id === where.id),
    findMany: async ({ where }) => cats.filter(c => c.parentId === where.parentId),
    update: async args => { if (fail) throw new Error('database failure'); writes.push(args); },
  } };
  const { POST } = loader({
    '@/lib/db': { db: { $transaction: async fn => fn(tx) } },
    '@/lib/admin-guard': { requirePerm: async perm => {
      assert.equal(perm, 'categories');
      return denied ? { res: Response.json({ error: 'Forbidden' }, { status: 403 }) } : { user: { email: 'admin@example.test' } };
    } },
    '@/lib/auth': { logAudit: async () => {} },
    'next/cache': { revalidateTag: tag => invalidated.push(tag), revalidatePath: () => {} },
  })('app/api/admin/categories/reorder/route.ts');
  return { writes, invalidated, post: body => POST(new Request('http://test/api/admin/categories/reorder', { method: 'POST', body: JSON.stringify(body) })) };
}
test('reorder is permission protected', async () => {
  const api = endpoint({ denied: true });
  assert.equal((await api.post({ ids: [2, 1] })).status, 403);
  assert.equal(api.writes.length, 0);
});
test('reorder rejects malformed, duplicate, unknown, incomplete and mixed-parent lists', async () => {
  for (const ids of [[], [1, 1], ['1', 2], [0], [1.5], [99], [1], [1, 3], null]) {
    const api = endpoint();
    assert.equal((await api.post({ ids })).status, 400);
    assert.equal(api.writes.length, 0);
  }
});
test('reorder persists all sibling positions and invalidates storefront cache', async () => {
  for (const ids of [[2, 1], [4, 3]]) {
    const api = endpoint();
    assert.equal((await api.post({ ids })).status, 200);
    assert.deepEqual(api.writes.map(w => [w.where.id, w.data.position]), ids.map((id, i) => [id, i + 1]));
    assert.deepEqual(api.invalidated, ['categories']);
  }
});
test('database failure is not reported as a successful reorder', async () => {
  const api = endpoint({ fail: true });
  assert.equal((await api.post({ ids: [2, 1] })).status, 500);
  assert.equal(api.invalidated.length, 0);
});
