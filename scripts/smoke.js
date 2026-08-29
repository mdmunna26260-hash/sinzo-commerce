/* Smoke test: core flows against a running instance (BASE_URL, default localhost:3000) */
const BASE = process.env.BASE_URL || "http://localhost:3000";
let cookie = "";
async function req(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) } });
  const sc = r.headers.get("set-cookie");
  if (sc && sc.includes("sz_session")) cookie = sc.split(";")[0];
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra || ""); }
}
(async () => {
  console.log("Smoke test →", BASE);
  // admin login first (seeded super admin) so tests adapt to whatever products exist
  let r = await req("/api/admin/login", { method: "POST", body: JSON.stringify({ email: "Sinzo.bd@gmail.com", password: "do you love me?" }) });
  check("admin login works", r.status === 200 && r.body?.ok, JSON.stringify(r.body));
  const plist = (await req("/api/admin/products")).body?.products || [];
  check("admin products list", plist.length >= 1, "(got " + plist.length + ")");
  const live = plist.find((p) => p.status === "ACTIVE" && p.stock > 0) || plist[0];
  const slug = live?.slug || "";
  const needle = (live?.title || "").split(" ").slice(-1)[0] || live?.title || "";

  // storefront pages (PDP uses a real product slug from the DB)
  for (const p of ["/", "/products", "/cart", "/checkout", "/track", "/wishlist", "/products/" + slug, "/collections/best-sellers"]) {
    const r = await fetch(BASE + p);
    check("GET " + p, r.status === 200, "(" + r.status + ")");
  }
  // search api (search a word from a real product title)
  r = await req("/api/search?q=" + encodeURIComponent(needle));
  check("search finds existing product", r.body?.products?.length > 0, "(q=" + needle + ")");
  // coupon api
  r = await req("/api/coupon", { method: "POST", body: JSON.stringify({ code: "WELCOME10", subtotal: 2000 }) });
  check("coupon WELCOME10 valid", r.body?.valid === true && r.body.discount === 200);
  r = await req("/api/coupon", { method: "POST", body: JSON.stringify({ code: "BOGUS", subtotal: 2000 }) });
  check("invalid coupon rejected", r.body?.valid === false);
  // admin auth guard (fresh request, no cookie)
  {
    const s = cookie; cookie = "";
    r = await req("/api/admin/products");
    check("admin api blocked without login", r.status === 401);
    cookie = s;
  }
  // checkout flow (real order)
  const target = live;
  const variant = (target.variants || []).find((v) => v.stock > 0) || null;
  r = await req("/api/checkout", { method: "POST", body: JSON.stringify({
    name: "Smoke Test Customer", phone: "01812345678", address: "House 99, Road 12, Banani, Dhaka",
    area: "INSIDE_DHAKA", paymentMethod: "COD", couponCode: "WELCOME10",
    items: [{ productId: target.id, variantId: variant?.id || null, qty: 1 }],
  })});
  check("COD order placed", r.status === 200 && /^ORD-\d+$/.test(r.body?.code || ""), JSON.stringify(r.body));
  const code = r.body?.code;
  // order appears in admin
  r = await req("/api/admin/orders?q=" + code);
  check("order visible in admin", r.body?.orders?.length === 1);
  const orderId = r.body?.orders?.[0]?.id;
  // status update
  r = await req("/api/admin/orders/" + orderId, { method: "PUT", body: JSON.stringify({ status: "CONFIRMED" }) });
  check("order status update", r.status === 200);
  // public tracking
  r = await req("/api/track/order", { method: "POST", body: JSON.stringify({ code, phone: "01812345678" }) });
  check("customer can track order", r.body?.order?.status === "CONFIRMED");
  // CAPI not configured -> honest response
  r = await req("/api/track/event", { method: "POST", body: JSON.stringify({ name: "AddToCart", eventId: "t1", data: { value: 100 } }) });
  check("tracking endpoint responds (CAPI honest about config)", r.status === 200);
  // settings update reflects
  r = await req("/api/admin/settings", { method: "PUT", body: JSON.stringify({ group: "shipping", value: { insideDhaka: 90 } }) });
  check("settings update", r.status === 200);
  r = await req("/api/admin/settings", { method: "PUT", body: JSON.stringify({ group: "shipping", value: { insideDhaka: 80 } }) });
  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
