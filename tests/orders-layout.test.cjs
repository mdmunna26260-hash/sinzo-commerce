const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Exercise the actual component's filters and selection with a minimal hook host.
// CSS breakpoints still require a browser visual check; these are behavior tests.
function screen(initialTab = 'ALL', options = {}) {
  const state = []; let cursor = 0;
  const pushed = [];
  const module = { exports: {} };
  const mocks = {
    react: {
      useState(init) { const i = cursor++; if (!(i in state)) state[i] = typeof init === 'function' ? init() : init; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
      useMemo: fn => fn(),
      useRef(value) { const i = cursor++; if (!(i in state)) state[i] = { current: value }; return state[i]; },
      useEffect: () => {},
    },
    'next/link': { __esModule: true, default: 'Link' },
    'next/navigation': { useRouter: () => ({ push: url => pushed.push(url), refresh() {} }) },
    '@/lib/admin-workflow': require('./load-ts.cjs').loader()('lib/admin-workflow.ts'),
    '@/lib/escape-html': require('./load-ts.cjs').loader()('lib/escape-html.ts'),
    '@/lib/order-whatsapp': require('./load-ts.cjs').loader()('lib/order-whatsapp.ts'),
    '@/components/dates': { FmtDate: 'FmtDate' },
    '@/lib/afetch': { withToken: url => url + (url.includes('?') ? '&' : '?') + 't=preview', copyText: async () => true, afetch: options.request || (async () => { throw new Error('Unexpected API call'); }) },
    '@/lib/phone': { telLink: phone => 'tel:' + phone, waLink: phone => 'https://wa.me/' + phone },
  };
  const compiled = ts.transpileModule(fs.readFileSync('app/admin/(panel)/orders/client.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', 'confirm', 'alert', compiled)(id => mocks[id] || require(id), module, module.exports, () => options.confirmResult !== false, message => options.alert?.(message));
  const base = { phone: '01712345678', address: 'Dhaka', area: 'INSIDE_DHAKA', total: 1200, paymentMethod: 'COD', riskLevel: 'LOW', createdAt: new Date().toISOString() };
  const initial = [
    { ...base, id: 1, code: 'ORD-1', name: 'Customer One', status: options.initialStatus || 'PENDING', paymentStatus: 'PENDING', items: [{ title: 'Very long product title', variant: 'Black / XL', image: '/api/media/test-image', qty: 2 }] },
    { ...base, id: 2, area: 'OUTSIDE_DHAKA', code: 'ORD-2', name: 'Customer Two', status: options.secondStatus || 'DELIVERED', paymentStatus: 'PAID', courierConsignmentId: 'TRACK-222', items: [{ title: 'Preorder item', qty: 1, preorder: true }] },
  ];
  const nodes = () => {
    cursor = 0;
    const root = module.exports.default({ initial, initialTab, initialQueue: options.initialQueue || "" });
    const out = [];
    function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object' || !node.props) return;
      out.push(node); walk(node.props.children);
    }
    walk(root); return out;
  };
  return {
    nodes, pushed,
    find: predicate => { const node = nodes().find(predicate); assert.ok(node, 'Expected matching element'); return node; },
    cards: () => nodes().filter(n => n.type === 'article').map(n => n.props['aria-label']),
  };
}

test('orders render readable mobile cards alongside the desktop table and collapsed extra filters', () => {
  const ui = screen();
  assert.deepEqual(ui.cards(), ['Order ORD-1', 'Order ORD-2']);
  assert.equal(ui.find(n => n.props.id === 'orders-extra-filters').props.hidden, true);
  ui.find(n => n.type === 'table');
  ui.find(n => n.type === 'small' && n.props.children === 'Black / XL');
  ui.find(n => n.props['aria-label'] === 'WhatsApp Customer One');
  ui.find(n => n.props['aria-label'] === 'Call customer for ORD-1');
  assert.equal(ui.find(n => n.props['aria-label'] === 'View ORD-1 for Customer One').props.href, '/admin/orders/1?t=preview');
});
test('search matches customer and consignment while preserving the search input value', () => {
  const ui = screen();
  const input = () => ui.find(n => n.props.type === 'search');
  input().props.onChange({ target: { value: 'customer one' } });
  assert.deepEqual(ui.cards(), ['Order ORD-1']);
  input().props.onChange({ target: { value: 'TRACK-222' } });
  assert.deepEqual(ui.cards(), ['Order ORD-2']);
});
test('status buttons and PREORDER deep links apply the expected order filters', () => {
  const ui = screen();
  const tabs = () => ui.nodes().filter(n => n.type === 'button' && n.props.className?.startsWith('orders-status-tab'));
  tabs()[1].props.onClick();
  assert.deepEqual(ui.cards(), ['Order ORD-1']);
  assert.equal(tabs()[1].props['aria-pressed'], true);
  assert.deepEqual(screen('PREORDER').cards(), ['Order ORD-2']);
  assert.equal(screen('INVALID').cards().length, 2);
});
test('extra filters expand and payment/date filters combine without expanding the header by default', () => {
  const ui = screen();
  ui.find(n => n.props['aria-controls'] === 'orders-extra-filters').props.onClick();
  assert.equal(ui.find(n => n.props.id === 'orders-extra-filters').props.hidden, false);
  const selects = ui.nodes().filter(n => n.type === 'select');
  selects[0].props.onChange({ target: { value: 'PAID' } });
  assert.deepEqual(ui.cards(), ['Order ORD-2']);
  ui.nodes().filter(n => n.type === 'select')[1].props.onChange({ target: { value: 'yesterday' } });
  assert.deepEqual(ui.cards(), []);
  ui.find(n => n.type === 'button' && n.props.children === 'Reset filters').props.onClick();
  assert.equal(ui.cards().length, 2);
});
test('card selection exposes bulk actions and select-all shares state with the table', () => {
  const ui = screen();
  assert.equal(ui.nodes().some(n => n.type === 'fieldset'), false);
  ui.find(n => n.props['aria-label'] === 'Select ORD-1').props.onChange();
  ui.find(n => n.type === 'fieldset');
  assert.equal(ui.find(n => n.props['aria-label'] === 'Select ORD-1').props.checked, true);
  assert.deepEqual(ui.pushed, []);
  ui.find(n => n.props['aria-label'] === 'Select all matching orders').props.onChange();
  assert.equal(ui.find(n => n.props['aria-label'] === 'Select all matching orders in table').props.checked, true);
  ui.find(n => n.type === 'button' && n.props.children === 'Clear selection').props.onClick();
  assert.equal(ui.nodes().some(n => n.type === 'fieldset'), false);
});

test('cards render image thumbnails with a broken-image placeholder fallback and WP/Call links', () => {
  const ui = screen();
  const image = ui.find(n => n.type === 'img');
  assert.equal(image.props.src, '/api/media/test-image/w80');
  const target = { hidden: false }; image.props.onError({ currentTarget: target });
  assert.equal(target.hidden, true);
  const wp = ui.find(n => n.props['aria-label'] === 'WhatsApp Customer One');
  assert.ok(wp.props.href.startsWith('https://wa.me/'));
  assert.ok(wp.props.href.includes('ORD-1'));
  assert.equal(wp.props.href.includes('?t='), false);
  assert.equal(ui.find(n => n.props['aria-label'] === 'Call customer for ORD-1').props.href, 'tel:01712345678');
  assert.equal(ui.nodes().some(n => n.props['aria-label'] === 'Copy phone for ORD-1'), false);
});
test('sent orders show their consignment next to the order code and cannot be sent again', () => {
  const ui = screen('ALL', { initialStatus: 'CONFIRMED' });
  const cid = ui.find(n => n.props.className === 'order-mobile-consignment');
  assert.ok(cid.props.children.includes('TRACK-222'));
  const sends = ui.nodes().filter(n => n.props.className === 'abtn order-send');
  assert.equal(sends[0].props.disabled, false);
  assert.equal(sends[1].props.disabled, true);
});
test('courier send uses the existing endpoint only after confirmation and immediately shows the returned id', async () => {
  const calls = [];
  const ui = screen('ALL', { initialStatus: 'CONFIRMED', request: async (url, opts) => {
    calls.push([url, opts.method]);
    return { ok: true, json: async () => ({ ok: true, consignment: { consignment_id: 789123, delivery_status: 'in_review' } }) };
  } });
  await ui.find(n => n.props.className === 'abtn order-send').props.onClick();
  assert.deepEqual(calls, [['/api/admin/orders/1/courier', 'POST']]);
  assert.ok(ui.nodes().filter(n => n.props.className === 'order-mobile-consignment').some(n => n.props.children.includes('789123')));
  ui.find(n => n.props.className === 'abtn order-parcel');
});
test('mini status control uses the inventory-aware order update endpoint and updates status filters', async () => {
  const calls = [];
  const ui = screen('PENDING', { request: async (url, opts) => {
    calls.push([url, opts.method, JSON.parse(opts.body)]);
    return { ok: true, json: async () => ({ ok: true, order: { status: 'CONFIRMED', paymentStatus: 'PENDING' } }) };
  } });
  await ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.onChange({ target: { value: 'CONFIRMED' } });
  assert.deepEqual(calls, [['/api/admin/orders/1', 'PUT', { status: 'CONFIRMED' }]]);
  assert.deepEqual(ui.cards(), []);
});
test('cancelled confirmations never call the courier or status APIs', async () => {
  const ui = screen('ALL', { initialStatus: 'CONFIRMED', confirmResult: false });
  await ui.find(n => n.props.className === 'abtn order-send').props.onClick();
  await ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.onChange({ target: { value: 'CANCELLED' } });
  assert.equal(ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.value, 'CONFIRMED');
});
test('failed fulfillment actions show an error and do not falsely change status or mark courier sent', async () => {
  const ui = screen('ALL', { initialStatus: 'CONFIRMED', request: async () => ({ ok: false, json: async () => ({ error: 'Inventory conflict' }) }) });
  await ui.find(n => n.props.className === 'abtn order-send').props.onClick();
  assert.equal(ui.find(n => n.props.className === 'abtn order-send').props.disabled, false);
  await ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.onChange({ target: { value: 'DELIVERED' } });
  assert.equal(ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.value, 'CONFIRMED');
  ui.find(n => n.props.role === 'alert');
});


test('WP draft includes products and follows the latest saved order status', async () => {
  const ui = screen('ALL', { request: async () => ({ ok: true, json: async () => ({ ok: true, order: { status: 'CONFIRMED', paymentStatus: 'PENDING' } }) }) });
  const draft = () => new URL(ui.find(n => n.props['aria-label'] === 'WhatsApp Customer One').props.href).searchParams.get('text');
  assert.ok(draft().includes('Very long product title (Black / XL) x2'));
  assert.equal(draft().includes('confirmed kora hoyeche'), false);
  await ui.find(n => n.props['aria-label'] === 'Change status for ORD-1').props.onChange({ target: { value: 'CONFIRMED' } });
  assert.ok(draft().includes('confirmed kora hoyeche'));
  assert.ok(draft().includes('Order ID: ORD-1'));
});

test('bulk courier network failures release the shared mutation lock for retry', async () => {
  let attempts = 0; const alerts = [];
  const ui = screen('ALL', { request: async () => { attempts++; throw new Error('Offline'); }, alert: message => alerts.push(message) });
  ui.find(n => n.props['aria-label'] === 'Select ORD-1').props.onChange();
  await ui.find(n => n.type === 'button' && n.props.children === 'Send to Steadfast').props.onClick();
  assert.equal(ui.find(n => n.type === 'fieldset').props.disabled, false);
  await ui.find(n => n.type === 'button' && n.props.children === 'Send to Steadfast').props.onClick();
  assert.equal(attempts, 2);
  assert.equal(alerts.length, 2);
});
test('an in-flight bulk courier request blocks a second booking action', async () => {
  let finish; let calls = 0;
  const ui = screen('ALL', { request: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  ui.find(n => n.props['aria-label'] === 'Select ORD-1').props.onChange();
  const pending = ui.find(n => n.type === 'button' && n.props.children === 'Send to Steadfast').props.onClick();
  await ui.find(n => n.props.className === 'abtn order-confirm').props.onClick();
  assert.equal(calls, 1);
  finish({ ok: true, json: async () => ({ sent: 1, failed: 0 }) });
  await pending;
});

test('pending primary action confirms through the real status endpoint, then exposes courier booking', async () => {
  const calls = [];
  const ui = screen('ALL', { request: async (url, opts) => {
    calls.push([url, opts.method, JSON.parse(opts.body)]);
    return { ok: true, json: async () => ({ ok: true, order: { status: 'CONFIRMED' } }) };
  } });
  await ui.find(n => n.props.className === 'abtn order-confirm').props.onClick();
  assert.deepEqual(calls, [['/api/admin/orders/1', 'PUT', { status: 'CONFIRMED' }]]);
  assert.equal(ui.find(n => n.props.className === 'abtn order-send').props.disabled, false);
});
test('delivery zone combines with product search and clear/reset controls', () => {
  const ui = screen();
  ui.find(n => n.props['aria-label'] === 'Filter by delivery zone').props.onChange({ target: { value: 'OUTSIDE_DHAKA' } });
  assert.deepEqual(ui.cards(), ['Order ORD-2']);
  ui.find(n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value: '  Black / XL  ' } });
  assert.deepEqual(ui.cards(), []);
  ui.find(n => n.props.children === 'Reset all filters').props.onClick();
  assert.equal(ui.cards().length, 2);
  ui.find(n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value: 'Very long product' } });
  assert.deepEqual(ui.cards(), ['Order ORD-1']);
  ui.find(n => n.props['aria-label'] === 'Clear order search').props.onClick();
  assert.equal(ui.cards().length, 2);
});
test('booked open orders link to real parcel details and closed orders stay disabled', () => {
  const ui = screen('ALL', { initialStatus: 'SHIPPED' });
  assert.equal(ui.find(n => n.props.className === 'abtn order-send').props.disabled, true);
  // The delivered fixture stays closed even though it has a CID.
  assert.equal(ui.nodes().some(n => n.props.className === 'abtn order-parcel'), false);
  const shipped = screen('ALL', { secondStatus: 'SHIPPED' });
  assert.equal(shipped.find(n => n.props.className === 'abtn order-parcel').props.href, '/admin/orders/2?t=preview');
});

test('READY tab shows only unbooked confirmed/processing/packed orders', () => {
  const ui = screen('READY', { initialStatus: 'CONFIRMED', secondStatus: 'PACKED' });
  // The second fixture already has a courier consignment and must be excluded.
  assert.deepEqual(ui.cards(), ['Order ORD-1']);
  assert.deepEqual(screen('READY').cards(), []);
});
test('dashboard queue context leaves its server-filtered subset when switching tabs', () => {
  const ui = screen('READY', { initialStatus: 'CONFIRMED', initialQueue: 'ready to send' });
  ui.find(n => n.type === 'button' && n.props.className?.startsWith('orders-status-tab') && n.props['aria-pressed'] === false).props.onClick();
  assert.deepEqual(ui.pushed, ['/admin/orders?tab=ALL&t=preview']);
});

test('mini internal note saves only adminNote and displays the saved text', async () => {
  const calls = [];
  const ui = screen('ALL', { request: async (url, opts) => { calls.push([url, JSON.parse(opts.body)]); return { ok: true, json: async () => ({ ok: true, order: { adminNote: 'Call after 5 PM' } }) }; } });
  ui.find(n => n.props['aria-label'] === 'Add internal note for ORD-1').props.onClick();
  ui.find(n => n.props['aria-label'] === 'Internal note for ORD-1').props.onChange({ target: { value: 'Call after 5 PM' } });
  await ui.find(n => n.type === 'button' && n.props.children === 'Save note').props.onClick();
  assert.deepEqual(calls, [['/api/admin/orders/1', { adminNote: 'Call after 5 PM' }]]);
  ui.find(n => n.props['aria-label'] === 'Edit internal note for ORD-1');
  ui.find(n => n.props.children === 'Call after 5 PM');
});
test('mini note failure retains draft and cancellation warns before discarding it', async () => {
  const ui = screen('ALL', { confirmResult: false });
  ui.find(n => n.props['aria-label'] === 'Add internal note for ORD-1').props.onClick();
  ui.find(n => n.props['aria-label'] === 'Internal note for ORD-1').props.onChange({ target: { value: 'Keep this draft' } });
  await ui.find(n => n.type === 'button' && n.props.children === 'Save note').props.onClick();
  assert.equal(ui.find(n => n.props['aria-label'] === 'Internal note for ORD-1').props.value, 'Keep this draft');
  ui.find(n => n.props.role === 'alert');
  ui.find(n => n.type === 'button' && n.props.children === 'Cancel').props.onClick();
  assert.equal(ui.find(n => n.props['aria-label'] === 'Internal note for ORD-1').props.value, 'Keep this draft');
  assert.equal(ui.find(n => n.type === 'button' && n.props.children === 'Save note').props.disabled, false);
});
test('mini note save shares the row mutation lock and prevents double submits', async () => {
  let resolve, calls = 0;
  const ui = screen('ALL', { request: () => { calls++; return new Promise(r => { resolve = r; }); } });
  ui.find(n => n.props['aria-label'] === 'Add internal note for ORD-1').props.onClick();
  ui.find(n => n.props['aria-label'] === 'Internal note for ORD-1').props.onChange({ target: { value: 'Draft' } });
  const button = ui.find(n => n.type === 'button' && n.props.children === 'Save note');
  const saving = button.props.onClick(); await button.props.onClick(); assert.equal(calls, 1);
  resolve({ ok: true, json: async () => ({ ok: true, order: { adminNote: 'Draft' } }) }); await saving;
  ui.find(n => n.props['aria-label'] === 'Edit internal note for ORD-1');
});
