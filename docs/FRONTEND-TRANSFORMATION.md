# Frontend transformation — public surfaces

**Date:** 14 September 2026
**Scope:** the public/marketing surfaces of CRA Compliance OS
**Stack added:** zero runtime dependencies

---

## 1. What was decided, and why

The brief asked for a fluid, spatial, WebGL-driven environment. Two facts about
this product constrain that:

1. It is a **compliance and security product**. Buyers are engineering leads and
   product-security teams who evaluate credibility in seconds. A shader-heavy
   dashboard reads as a toy, and your original standing requirement was that it
   feel like Linear/Vercel/Sentry — serious software.
2. You chose **motion + materials, no WebGL, no heavy dependencies** when asked.
   So: no Three.js, no GSAP/ScrollTrigger, no Lenis, no Web3.js.

The result: the **public environment** (Home, Pricing, Legal, Auth, Onboarding,
Share report) is rebuilt as a spatial, cinematic experience built entirely from
CSS transforms, CSS gradients, one shared `requestAnimationFrame` loop and
`IntersectionObserver`. The **authenticated product** (Dashboard, Repositories,
Readiness, Evidence, Incidents, Billing, Admin) is untouched — it stays a dense,
fast engineering instrument. That split is deliberate and is the single most
important design decision in this document.

---

## 2. The old visual vocabulary, removed

| Removed | Replaced with |
|---|---|
| Terminal window with `cra scan --repo` output | A floating "readiness object": layered glass planes showing the repository, inventory, severity spectrum and control statuses |
| Three-dot window chrome | Lit glass surface with a top-edge hairline highlight |
| `$ command` prompt, `✓ check` glyphs | Real UI: status pills, numeric spectrum, mono reserved for checksums |
| `grid-noise` blueprint grid | Aurora field: three drifting radial gradients plus a horizon line |
| Uniform 4-across card grids | Asymmetric bento (3+3 / 2+2+2 / 6), staggered reveals, floating satellite metadata |
| Four identical pricing cards | Weighted planes; the popular pack is elevated and ringed |
| `<details>` FAQ collapsing instantly | `grid-template-rows: 0fr → 1fr` accordion with a real height transition |
| Bordered boxes with `1px solid` | Glass material: translucent gradient + 22–30px backdrop blur + inner light |
| `border-border` everywhere | Light: shadows that read as illumination, not outlines |

Monospace is now an accent only — checksums, step numbers, per-credit prices,
timestamps and control IDs.

---

## 3. Design system

### Tokens — `apps/web/src/styles/marketing.css`

- **Type:** fluid display scale `--text-display-1/2/3` (`clamp()`), `--text-lead`, display face with `-0.035em` tracking and `text-wrap: balance`.
- **Atmosphere:** `--color-void`, `--color-deep`, `--color-iris`, `--color-violet`, `--color-teal`, `--color-amber`.
- **Materials:** `--glass-bg`, `--glass-line`, `--glass-line-strong`; shadows `--shadow-lift`, `--shadow-float`, `--shadow-glow`.
- **Easings:** `--ease-out-expo`, `--ease-out-quint`, `--ease-spring`, `--ease-in-out-soft`.

### Motion language

| Band | Duration | Used for |
|---|---|---|
| Fast | 120–240 ms | pointer feedback, cursor states |
| Medium | 320–680 ms | hovers, underlines, magnetic settle |
| Cinematic | 800–1600 ms | reveals, section entrances, accordions |
| Ambient | 9–34 s | background drift, floating objects |

### Primitives — `apps/web/src/lib/motion.tsx`

| Export | Responsibility |
|---|---|
| `useFrame(fn, enabled)` | Subscribes to **one** shared rAF loop; no per-component listeners |
| `Reveal` | IntersectionObserver entrance with stagger (`--reveal-delay`) |
| `RevealText` | Word-by-word typographic reveal; sets `aria-label` so screen readers read one clean string |
| `Magnetic` | Bounded pointer attraction (≤8px) with spring lerp; rect cached and invalidated on scroll/resize |
| `Parallax` | Scroll-linked translate + velocity inertia; **reads** scroll, never writes it |
| `Atmosphere` | Aurora field. `variant="full"` (expensive, page-level only) vs `"glow"` (single unblurred radial, for sections) |
| `CursorSystem` | Dot + trailing ring with contextual labels (`data-cursor="Explore"`); pointer devices only |
| `useReducedMotion` / `useFinePointer` | Capability detection, both guarded against missing `matchMedia` |
| `useCountUp` | Counts once on first view; under reduced motion it renders the final value immediately |

### Shared shell — `apps/web/src/components/marketing.tsx`

`MarketingLayout` (fixed atmosphere + custom cursor + skip link), `MarketingNav`
(transparent until scrolled, then glass), `MarketingFooter`, `GlassPanel`,
`SectionLabel`, `SectionIntro`, `ActionLink` (magnetic), `Accordion`, `TraceLine`.

---

## 4. Page-by-page

| Page | Change |
|---|---|
| **Home** | Hero as a scene: aurora, three-line display headline with staggered word reveal, floating readiness object with two satellite planes, ecosystem marquee, traced connectors between steps, asymmetric feature bento, animated FAQ, cinematic closing scene. All copy, claims, section IDs (`#how`, `#features`, `#faq`), nav and footer links preserved. |
| **Pricing** | Same data and purchase logic (including the "never pretend a charge happened" rule). Packs are weighted glass planes; popular pack is elevated and ringed; credit table restyled with hairlines and mono numbers only; tiers become an editorial column layout. |
| **Legal** | Editorial reading environment: sticky contents with active-section tracking, reading-progress line, display headings, generous measure. Every paragraph of every policy is unchanged. |
| **Auth** | Split scene: lit environment with a floating readiness panel on the left, glass form document on the right. Form logic, validation and GitHub OAuth are untouched. |
| **Onboarding** | First-run flow as a spatial progression: label + display heading, two glass action panels, solid progress state. Upload/GitHub logic unchanged. |
| **Share report** | Reads as a shared object: label, display title, four counted metrics, readiness plane, checksum panel. Still deliberately narrow — it never enumerates CVEs. |

---

## 5. Performance

- **No new runtime dependencies.** Added 3 dev-only packages for testing (`jsdom`, `@testing-library/react`, `@testing-library/dom`).
- **Bundle:** CSS 41.6 kB → **57.5 kB** (gzip 11.5 kB); JS 473.9 kB → **499.2 kB** (gzip 143.3 kB). The entire motion system, materials, cursor and shell cost ~16 kB CSS and ~25 kB JS.
- **One rAF loop** for every animated element; transforms are written directly to refs, never to React state.
- **Compositor-only animation:** `opacity` and `transform` only. `filter: blur()` is applied to three static layers that are then transformed, not re-blurred.
- **Cost control:** only the fixed page-level atmosphere uses the full blurred field; sections use the unblurred `glow` variant. On screens below 768 px the aurora blur drops from 70 px to 46 px and opacity from 0.5 to 0.34.
- **Pausing:** the loop stops when the tab is hidden and when no subscribers remain.
- **No scroll hijacking.** Scroll-linked effects read position and velocity; the wheel, keyboard, find-in-page and screen readers keep native behaviour. Native anchor scrolling is used for in-page navigation.

---

## 6. Accessibility

- Semantic landmarks (`header`, `main`, `footer`, `article`, `nav`), one `h1` per page, correct heading order.
- Skip-to-content link, visible focus rings preserved from the base system.
- `prefers-reduced-motion: reduce` disables all ambient animation and reveals content immediately; the custom cursor is not rendered.
- `prefers-reduced-transparency: reduce` swaps glass for opaque surfaces.
- Custom cursor: pointer devices only; native cursor is kept over inputs, textareas and selects; touch devices never see it.
- Animated figures expose their true value to assistive technology (visually-hidden final value; animated number marked `aria-hidden`).
- `RevealText` sets `aria-label` on the heading so word-split spans are not read as fragments.
- The accordion uses real `aria-expanded` / `aria-controls` / `role="region"`.
- The marquee duplicates its content for seamless scrolling, with an `sr-only` sentence carrying the ecosystem list once.

---

## 7. Verification

| Check | Result |
|---|---|
| `tsc -p tsconfig.json --noEmit` (web) | 0 errors |
| `vite build` | succeeds — 1.36 kB HTML / 57.52 kB CSS (11.53 kB gz) / 499.24 kB JS (143.31 kB gz) |
| `tsc --noEmit` (api) | 0 errors |
| API test suite | **224 passed** across 12 files |
| Web render tests | **5 passed** (Home, Pricing, Legal, Auth, Share report mount and carry their copy) |
| Route smoke (`/`, `/pricing`, `/login`, `/signup`, `/legal/privacy`, `/legal/terms`, `/share/demo`) | all 200 |
| Live | dev server on 5173, API on 8787 |

New test file: `apps/web/src/__tests__/marketing.render.test.tsx` — asserts no
`<pre>` (terminal) remains in the hero, that `#how/#features/#faq` still resolve,
that pricing renders the API catalogue, that all legal blocks are present, and
that a public share page never contains a CVE id.

Three real bugs were found and fixed while verifying the API side in the same
pass: `versionInRange` ignored OSV's `introduced: "0"` and re-introduced ranges,
`parsePyproject` mis-parsed PEP 621 array dependencies, and a malformed payment
webhook returned 500 (which would have triggered ~30 hours of provider retries).
A non-breaking space had also leaked into composed heading text and was removed.

---

## 8. Known gaps and next steps

1. **E2E suite not yet written.** `vitest.e2e.config.ts` exists with the full env block but no specs; the required signup → GitHub → scan → SBOM → vuln → compliance → purchase → consume → report journey still needs covering, including failure states.
2. **Visual QA in a browser is outstanding.** Typecheck, build, render tests and route smoke all pass, but composition should be eyeballed at 360 / 768 / 1440 / 2560 px and on a real mid-range phone before launch.
3. **Bundle:** 499 kB JS is dominated by the authenticated app. Route-level code splitting would keep the marketing bundle — the acquisition surface — much smaller.
4. **Not done by choice:** no WebGL, no 3D, no scroll hijacking, no Web3.js. If you later want the hero to carry a real 3D field, the composition is already layered for it (`Atmosphere` is a sibling of the content, not a wrapper).
5. **Docs still to write** for the wider build: architecture (B), deployment procedure (D), `.env.example` (E), production checklist (G), launch checklist (H), sales assets (I), roadmap (J).
