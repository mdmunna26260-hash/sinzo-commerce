# SINZO — Animation & CSS Improvement Report

Site er design language: **minimal luxury** (cream bg #faf9f7, gold accent #9a7b4f, serif headings, 2px radius).
Suggestion gulo ei aesthetic er sathe match kore — subtle, fast, premium. Heavy effect NA.
Rule: shudhu `transform` + `opacity` animate koro (GPU, smooth). `width/height/top/left` animate korben na.
Mobile-first — apnar customer mobile + COD, tai LCP impact choto rakhun.

**Already ache (thik ache, keep korun):**
- Announcement marquee (szmarquee) + prefers-reduced-motion
- `.reveal` scroll fade-up (kintu khoti jaygay use — see #2)
- Product card image zoom + quick-add slide-up
- Drawer/modal/lightbox/toast animations
- pageIn (PDP/shop/cart)
- Free-shipping bar width transition

---

## PRIORITY 1 — High impact, choto effort

### 1. Hero entrance + Ken Burns (home page)
Hero ekhon static pop kore. Fashion site gulo te hero slow zoom + staggered text.

```css
/* globals.css — hero section e add */
@keyframes kenburns { from { transform: scale(1.08); } to { transform: scale(1); } }
.hero-img { animation: kenburns 2.8s cubic-bezier(.22,.61,.36,1) both; will-change: transform; }

@keyframes heroUp { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
.hero-content .eyebrow { animation: heroUp .7s .15s cubic-bezier(.22,.61,.36,1) both; }
.hero-content h1       { animation: heroUp .7s .3s  cubic-bezier(.22,.61,.36,1) both; }
.hero-content p        { animation: heroUp .7s .45s cubic-bezier(.22,.61,.36,1) both; }
.hero-content .btn     { animation: heroUp .7s .6s  cubic-bezier(.22,.61,.36,1) both; }
```
- Text gulo ek ke orey e niche theke uthe ashbe (stagger 150ms gap) — premium feel
- Image 1.08 → 1 scale e setle hobe (ekbar e, 2.8s). Continuous zoom NA (mobile battery)
- `page.tsx` hero-content er vitore thakle class based targeting kaj korbe; na hole h1/p/Link e direct class din

### 2. Scroll-reveal expand koro (stagger soho)
`.reveal` component ache kintu shudhu 2-3 jaygay use hocche. **Same class add korlei hobe** (MutationObserver auto-detect kore):

- `app/page.tsx`: category tiles (`.ctile`), bestseller cards (`.pcard`), values icons, testimonial cards
- `app/products/infinite-grid.tsx`: grid cards
- Section headers (`.section-head2`) — sob

Stagger (ek section er card gulo ek sathe na, kothao kothao e ashbe):
```css
.reveal { transition-delay: calc(var(--rd, 0) * 70ms); } /* --rd: 0,1,2,3... inline style e din */
```
React e: `style={{ '--rd': i % 4 }}` — i = index. (4 er beshi delay lagaben na — scroll e khali lagbe)

### 3. Order SUCCESS page — checkmark draw-in
"Success order" ta apnar business er emotional peak — ekhon static. SVG check draw hote debe:

```tsx
/* app/order/success/page.tsx — .check er bitorer icon ta ei SVG e din */
<svg width="34" height="34" viewBox="0 0 34 34" fill="none">
  <path d="M8 17.5l6.5 6.5L26 11" stroke="currentColor" strokeWidth="2.6"
        strokeLinecap="round" strokeLinejoin="round"
        className="check-path"/>
</svg>
```
```css
.success-wrap .check { animation: checkPop .5s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes checkPop { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: scale(1); } }
.check-path { stroke-dasharray: 34; stroke-dashoffset: 34; animation: checkDraw .45s .35s ease-out forwards; }
@keyframes checkDraw { to { stroke-dashoffset: 0; } }
.success-wrap h1 { animation: fadeup .5s .5s ease both; }
.success-wrap .order-code { animation: fadeup .5s .65s ease both; }
```
Circle pop → check line khacche → heading/code ek ke orey e asbe. Total ~1s.

### 4. Cart badge pop + Add-to-cart confirmation
```css
/* badge count change e pop — key=count trick e retrigger */
@keyframes badgePop { 0% { transform: scale(1); } 40% { transform: scale(1.35); } 100% { transform: scale(1); } }
.cart-badge.pop { animation: badgePop .35s cubic-bezier(.34,1.56,.64,1); }
```
React e: count change detect kore (usePrevious) `.pop` class 350ms por remove koro.

Add-to-cart button (`add to cart` PDP + quick-add): successful response e button 1.2s er jonno
`✓ Added` state e jabe (background var(--ok) e, text fade) — tarpor back. Ekhon kono confirmation nei (toast e na hole).

### 5. Button press + primary CTA sheen
```css
.btn, .abtn { transition: transform .12s ease, background .2s ease, color .2s ease, border-color .2s ease; }
.btn:active, .abtn:active { transform: scale(.97); }

/* hero CTA e light sweep (desktop only) */
@media (hover:hover) {
  .hero .btn { position: relative; overflow: hidden; }
  .hero .btn::after {
    content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 40%;
    background: linear-gradient(105deg, transparent, rgba(255,255,255,.28), transparent);
    transform: skewX(-20deg); transition: left .55s ease;
  }
  .hero .btn:hover::after { left: 120%; }
}
```

## PRIORITY 2 — Good touches, medium effort

### 6. Product card hover (desktop) — lift + 2nd image crossfade
```css
@media (hover:hover) {
  .pcard { transition: transform .3s ease, box-shadow .3s ease; }
  .pcard:hover { transform: translateY(-4px); box-shadow: 0 14px 34px rgba(20,20,20,.09); }
  /* 2nd image crossfade — card-img.tsx e 2nd img render kore .pcard-img-2 class din */
  .pcard-img-2 { position: absolute; inset: 0; opacity: 0; transition: opacity .5s ease; }
  .pcard:hover .pcard-img-2 { opacity: 1; }
}
```
Hover e card ektu uthe ashbe + 2nd photo fade in — bhalo fashion pattern.

### 7. Image load fade-in (pop-free loading)
Image load howa por sudden pop hoy. Soft transition:
```css
img { opacity: 1; }
.smart-img img, .pcard-img img { opacity: 0; transition: opacity .4s ease, transform .6s ease; }
.smart-img img.loaded, .pcard-img img.loaded { opacity: 1; }
```
React e: `onLoad={(e)=>e.currentTarget.classList.add('loaded')}` (smart-img.tsx / card-img.tsx e ek jaygay).

### 8. Mobile tab bar — active indicator slide
Tabbar e ekhon only active state. Ekta sliding pill/indicator add koro:
```css
.tab-item { position: relative; }
.tab-item.active::before {
  content: ""; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 22px; height: 2.5px; border-radius: 2px; background: var(--accent);
  animation: tabIn .25s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes tabIn { from { opacity: 0; transform: translateX(-50%) scaleX(.3); } to { opacity: 1; transform: translateX(-50%) scaleX(1); } }
.tab-item:active .tab-icon { transform: scale(.9); transition: transform .1s; }
```
Gold (accent) indicator — brand sathe match kore.

### 9. Wishlist heart pop
wish-heart.tsx e toggle on hote gele:
```css
@keyframes heartPop { 0% { transform: scale(1); } 45% { transform: scale(1.35); } 70% { transform: scale(.92); } 100% { transform: scale(1); } }
.pcard-heart.on { animation: heartPop .45s cubic-bezier(.34,1.56,.64,1); color: var(--danger); }
```

### 10. Sticky header — scroll e compact + shadow
```css
@media (hover:hover) {
  .site-header { transition: box-shadow .25s ease, padding .25s ease; }
  .site-header.scrolled { box-shadow: 0 1px 0 var(--line), 0 8px 24px rgba(20,20,20,.05); }
}
```
JS e scroll > 24px hole `.scrolled` add (chrome.tsx e ek line). Tabbar e already compact-on-scroll ache — header e same language.

### 11. Skeleton shimmer (products page initial load)
Spinner er jaygay card shapelar skeleton:
```css
.skel { position: relative; overflow: hidden; background: #eceae5; border-radius: var(--radius); }
.skel::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent);
  animation: skel 1.4s infinite;
}
@keyframes skel { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
```

### 12. Form focus (checkout)
```css
.field input, .field select, .field textarea { transition: border-color .2s ease, box-shadow .2s ease; }
.field input:focus, .field textarea:focus, .field select:focus {
  border-color: var(--text); box-shadow: 0 0 0 3px rgba(154,123,79,.12);
}
```
Gold ring — checkout e confident feel.

## PRIORITY 3 — Polish (ekline r, low effort)

### 13. Global consistency
```css
:root { --ease: cubic-bezier(.22,.61,.36,1); }   /* sob transition e ei curve e standardize */
::selection { background: var(--accent); color: #fff; }
html { -webkit-tap-highlight-color: transparent; }
h1, h2, h3 { text-wrap: balance; }               /* heading wrap thik hoye jabe */
.price, .tbl td, .kpi .k-val { font-variant-numeric: tabular-nums; } /* taka/number align */

/* scrollbar subtle (desktop) */
@media (hover:hover) {
  ::-webkit-scrollbar { width: 10px; }
  ::-webkit-scrollbar-thumb { background: #d8d2c8; border-radius: 99px; border: 3px solid var(--bg); }
}
```

### 14. Admin panel (apnar daily use)
```css
.tbl tbody tr { transition: background .15s ease; }
.tbl tbody tr:hover { background: #faf8f4; }
.pill { transition: background .2s ease, color .2s ease; }   /* status update e smooth */
```

### 15. prefers-reduced-motion — global override
Ekhon shudhu marquee e ache. Sob animation ek jaygay off:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important;
  }
}
```

## KORBE NA (avoid list)

- ❌ GSAP/Framer Motion jaidok heavy JS library — CSS ei kaje pochesto
- ❌ Continuous infinite hero zoom, parallax layers (mobile battery + LCP)
- ❌ Fly-to-cart animation (fashion aesthetic er sathe na, jhamela)
- ❌ Text scramble/typing effects — brand minimal, eto flashy na
- ❌ `box-shadow` animate (blur expensive) — hover e static shadow swap o thik

## Test order (local e)

1. globals.css e Priority 1 er CSS add koro (server restart na lage — HMR e kaj korbe)
2. Hero + success page e component e alu CSS/JS change
3. Sandbox preview e test: home scroll, product card hover (desktop), cart add, checkout → success, mobile tabbar (devtools e mobile viewport)
4. `prefers-reduced-motion` on kore ekbar dekhun (devtools → Rendering → Emulate CSS prefers-reduced-motion) — sob kill hoye static site thakte hobe
5. Performance: Lighthouse mobile — LCP < 2.5s maintain koro

---

## DEPLOY LOG (2026-09-10)

- **Commit:** 5b6ac80 (animation pass) + trigger commits
- **Local test:** tsc clean, all pages 200, prod build OK, admin orders 28/28 (sandbox)
- **Vercel:** live — buildId `QcnF-DMylDahH-PshGDgL` (sha 52c2137). Deployed via Vercel REST API (token) because Vercel's new commit-email verification was webhook-blocking (email mdmuna26260@gmail.com was missing from the GitHub account; user added+verified it). After that fix, webhook auto-deploy also resumed (526c2bc auto-deployed to production).
- **VPS:** live — auto-deployed (buildId `nT6Uctpy4Y2Dn-MYJceTz`). Root cause of missed deploys: Dokploy's GitHub App connection had been lost (repo had no app/webhook, `github.githubProviders` was empty). User re-installed the GitHub App in Dokploy Settings → Git Providers; app re-linked to new provider id via `application.saveGithubProvider` (triggerType "push", buildPath ""). Verified E2E: test commit 526c2bc auto-deployed in ~60s.
- **Verified on both:** 8 new keyframes in served CSS, admin orders list working (Vercel 28, VPS 24 — order isolation by source is by design).
