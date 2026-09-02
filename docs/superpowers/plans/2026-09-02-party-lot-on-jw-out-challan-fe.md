# Party Lot on JW-Out Challan — FE Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The printed yarn-delivery challan prints the **party's** lot number (blank when absent, never the minted lot), and both detail pages show the party lot above the minted lot.

**Architecture:** Read-side only. `partyLotNo` arrives already resolved on `JwChallanOutItemResponse` (BE plan). FE does three disjoint things: swap the printed cell + widen its column (`challan-print`), stack the two numbers in two detail-page table cells, and move every fixture that a now-required schema field breaks. No new component, no new helper, no new dependency.

**Tech Stack:** React 18 + Vite, TypeScript strict, vitest + Testing Library + MSW, `@react-pdf/renderer` 4.6.1, `pdftoppm` (poppler) for the visual matrix.

**Spec:** `fabtraq-be/docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md` — §3.3, §3.4, §3.6, §4.1 Q3, §6 step 3, §7 V4/V5/V7/V8, §8 items 1, 2, 4 are this plan's.

**Contract (from the shared plan, `2026-09-02-party-lot-on-jw-out-challan-shared.md`):**

```ts
// @pashwashah04/fabtraq-shared@1.28.0 — JwChallanOutItemResponse gains:
partyLotNo: string | null;   // required-nullable; sits between sourceLotNumber and bagCount
```

## Global Constraints

- Branch `feat/inventory-rewoven` in all four repos (verified on disk 2026-09-02). No new branch.
- Node 22, strict TS, **no `any`**, **no `.js` import extensions**, files < 500 lines.
- Shared pin moves `1.27.0` → `1.28.0` exactly once, in Task 0 (`fabtraq-fe/package.json:28`).
- `partyLotNo` is printed and displayed **verbatim** — never split on `" / "`, re-joined, re-sorted, or re-derived. `combinePartyLots` already ran BE-side (spec §3.3, L3).
- **No fallback to the minted lot on paper, ever** (L2). Blank `''` on the PDF; `—` on screen (L6 / spec §3.4 — the two differ on purpose).
- `formatLotIdentity` (`fabtraq-fe/src/features/inventory/lib/lot-labels.ts:34`) is deliberately **not** used — it is the one-line picker wording and would invert the order L6 locks (spec §3.4).
- Column widths must sum to 100.0 and the cumulative span before `boxFromColumn: 6` must stay 88.0 (spec §3.3 table; `render.tsx:208-212`).
- Per-task gate: **`npm run verify`** from `fabtraq-fe/`. That one script already chains `format:check && lint && typecheck && contract:paths && test:coverage && build` (`fabtraq-fe/package.json:24`) — verified on disk, so no separate `contract:paths` step is needed.
- **One test run at a time.** `npm test` takes a lock via `scripts/test-lock.mjs` (`package.json:18`); a held lock fails fast naming the PID. Never run the visual matrix concurrently with `npm run verify`. Redirect suite output to a file and read the file — never grep the first pass.
- Every commit message ends with:
  ```
  Co-Authored-By: RuFlo <ruv@ruv.net>
  Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv
  ```

**Scratchpad** (all suite output and PNGs go here, never into a repo):
`/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad`

Referred to below as `$SP`. Every step spells the path out in full; `$SP` is shorthand for the reader, not a variable the executor must export.

---

## Waves and e2e checkpoints

**Wave 3 precondition (hard gate — do not start Task 0 until both are true):**
1. `@pashwashah04/fabtraq-shared@1.28.0` is **published** to GitHub Packages (shared plan Task 2, executed inside BE Wave 2).
2. The BE is wired and green — a BE on 1.28.0 whose mapper does not supply `partyLotNo` throws at `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.ts:136` (spec §6 step 2). **FE cannot bump before BE ships**: `parseOrThrow` (`fabtraq-fe/src/features/jw-challans-out/api.ts:27-64`) would reject every live response.

Task 0 Step 1 checks precondition 1 mechanically. Precondition 2 is confirmed by the BE plan's completion report.

| Wave | Tasks | Independence proof |
|---|---|---|
| **3-pre** | Task 0 — bump + fixtures | Touches `package.json`, `package-lock.json`, `tests/msw/handlers/jw-challans-out.ts`, `src/features/challan-print/documents/yarn-delivery.test.ts`. Must land first: every later task typechecks against 1.28.0. Runs alone. |
| **3a** | Task 1 — challan-print | `src/features/challan-print/**`, `scripts/challan-visual.ts`, three `docs/specs/` mirrors. |
| **3b** | Task 2 — the two detail pages | `src/features/jw-challans-out/jw-challan-out-detail.page.tsx`, `src/features/weaving-dispatches/weaving-dispatch-detail.page.tsx`, their two integration tests, and **new** fixtures appended to two MSW handler files. |

**Tasks 1 and 2 run concurrently** — verified disjoint by file list: Task 1 touches nothing under `src/features/jw-challans-out/` or `src/features/weaving-dispatches/`; Task 2 touches nothing under `src/features/challan-print/` or `scripts/`. They share only `tests/msw/handlers/jw-challans-out.ts`, and only if Task 0 has already landed its edit there — Task 2 **appends a new exported fixture at the end of the file** and never re-edits `mockJwChallanOutItem`. If both are dispatched into the same repo checkout, give each its own git worktree (CLAUDE.md Stage 4). Never share a worktree or a database with a possibly-running agent.

**e2e checkpoints.** e2e is a **separate plan** and this plan runs no Playwright. End of Wave 3 is an `e2e-required` checkpoint: the e2e plan runs `challan-pdf.spec.ts` and `weaving-dispatch.spec.ts` live, one spec at a time, after its own lockstep changes. Dev servers must be **stopped** for single-spec runs, and a full `npm run e2e` wipes `fabtraq_dev`. Output goes to a file.

**Lockstep audit — what a locator or text change here could break, grep-verified on disk 2026-09-02:**

| Risk | Verdict | Evidence |
|---|---|---|
| An e2e or FE assertion matching the lot cell by exact text | **None.** `grep -rn "LOT-260301-0001" fabtraq-fe/src fabtraq-fe/tests` returns only fixture definitions and the two `documents/yarn-delivery.test.ts` row assertions this plan itself rewrites (`:36`, `:118`, `:133`), plus unrelated jw-challans-in fixtures (`tests/msw/handlers/jw-challans-in.ts:39,65,134`). | grep, 2026-09-02 |
| The weaving weft-table header assertion | **Survives untouched.** `fabtraq-fe/tests/integration/features/weaving-dispatches/detail.page.test.tsx:131` asserts `screen.getByText('Lot No')`; the header at `weaving-dispatch-detail.page.tsx:279` is unchanged by this plan. | file:line |
| The jw-out page header | Reads **`Source Lot`** on disk (`jw-challan-out-detail.page.tsx:291`), not "Lot No" as spec §3.4's prose implies. **Both headers stay exactly as they are** — a second header would imply two columns (§3.4). No test asserts either string on the jw-out page. | file:line |
| e2e specs asserting a lot **cell** on either detail page | **None.** `e2e/tests/flows/jw-out.spec.ts` and `weaving-dispatch.spec.ts` use `lot_number` only for form input (`selectByAriaLabel(page, 'Source lot for line 1', …)` at `jw-out.spec.ts:100`, `weaving-dispatch.spec.ts:186`) and for SQL ledger assertions. | grep |
| FE smoke | **No edit.** `fabtraq-fe/tests/smoke/jw-challans-out.smoke.ts:43-47,` validates through `jwChallanOutResponseSchema` itself, so it picks the field up from the bump alone. | file:line |

---

### Task 0: Bump shared to 1.28.0 and move the fixtures the required field breaks

Small on purpose. It is its own task because it is the one change that must land before either Wave-3 task compiles, and because a reviewer can reject the bump independently of the feature work.

**Files:**
- Modify: `fabtraq-fe/package.json:28` (`"@pashwashah04/fabtraq-shared": "1.27.0"` → `"1.28.0"`)
- Modify: `fabtraq-fe/package-lock.json` (by `npm install`, never by hand)
- Modify: `fabtraq-fe/tests/msw/handlers/jw-challans-out.ts:33-55` (the `mockJwChallanOutItem` literal) and `:300-323` (the POST create handler's per-item map)
- Modify: `fabtraq-fe/src/features/challan-print/documents/yarn-delivery.test.ts:31-56` (the `item()` factory)

**Interfaces:**
- Consumes: `JwChallanOutItemResponse.partyLotNo: string | null` from `@pashwashah04/fabtraq-shared@1.28.0`.
- Produces: an FE tree that typechecks on 1.28.0 with every fixture carrying `partyLotNo`. Task 1 consumes the `item()` factory's `partyLotNo`; Task 2 consumes `mockJwChallanOutItem`'s.

**Fixture-value decision (read before Step 4).** The `item()` factory in `documents/yarn-delivery.test.ts` gets a **real party lot value**, not `null`. Its two existing full-row assertions (`:118`, `:133`) are `toStrictEqual` over the whole row array and both currently expect `'LOT-260301-0001'` at index 2; those are the happy-path row-mapping tests and they must keep asserting a *present* value, or Task 1's positive case goes untested and V5 collapses into `toBe('')`. The MSW `mockJwChallanOutItem` stays **`null`** — that is the default the team lead specified, and Task 2 adds a separate valued fixture beside it.

- [ ] **Step 1: Confirm the registry actually has 1.28.0**

A bare `npm view` 404s on the public registry — run it from a directory whose `.npmrc` maps the `@pashwashah04` scope to GitHub Packages with a token (spec §6 step 1). `fabtraq-fe/` is such a directory.

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npm view @pashwashah04/fabtraq-shared version
```
Expected: `1.28.0`. If it prints `1.27.0`, **stop and report** — the Wave 3 precondition is not met and nothing below will work.

- [ ] **Step 2: Bump the pin and install**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npm pkg set dependencies.@pashwashah04/fabtraq-shared=1.28.0
npm install
rm -rf node_modules/.vite
```
The `.vite` removal is not optional: a stale Vite dep cache bundles the old schema and the whole change silently does nothing (challan-print BRIEF §8; memory `feedback_vite_dep_cache_tarball`).

- [ ] **Step 3: Run typecheck to see the required field go red**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npm run typecheck 2>&1 | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t0-typecheck-red.txt
```
Expected: FAIL. Errors of the form `Property 'partyLotNo' is missing in type ... but required in type 'JwChallanOutItemResponse'` at `tests/msw/handlers/jw-challans-out.ts` and `src/features/challan-print/documents/yarn-delivery.test.ts`. This is the tripwire spec §6 step 3 predicts; it is the failing "test" for this task.

If any file **other than** those two is named, stop and report — spec §3.6 lists exactly these two FE producers, with `tests/msw/handlers/weaving-dispatches.ts:68` fixed transitively because it spreads `mockJwChallanOut`.

- [ ] **Step 4: Add `partyLotNo` to the three fixture sites**

In `fabtraq-fe/tests/msw/handlers/jw-challans-out.ts`, in the `mockJwChallanOutItem` literal, immediately after the `sourceLotNumber` line (`:38`):

```ts
  sourceLotNumber: 'LOT-260301-0001' as LotNumber,
  // Default fixture has no party lot — the detail pages must render `—` for it
  // (spec 2026-09-02-party-lot-on-jw-out-challan-design.md §3.4).
  // `mockJwChallanOutWithPartyLot` below carries a value.
  partyLotNo: null,
  bagCount: 5,
```

In the same file, in the POST create handler's per-item map, immediately after `sourceLotNumber: it.sourceLotNumber,` (`:305`):

```ts
      sourceLotNumber: it.sourceLotNumber,
      // The create input carries no party lot; the BE resolves it at read time
      // from the lot's origin row (spec §3.2), which this mock does not model.
      partyLotNo: null,
      bagCount: it.bagCount ?? null,
```

In `fabtraq-fe/src/features/challan-print/documents/yarn-delivery.test.ts`, in the `item()` factory, immediately after `sourceLotNumber` (`:36`):

```ts
    sourceLotNumber: 'LOT-260301-0001' as LotNumber,
    partyLotNo: 'PL-441',
```

No other site is touched. The items at `tests/msw/handlers/jw-challans-out.ts:80` (by reference), `:93`, `:129`, `:145`, `:181`, `:188` spread `mockJwChallanOutItem` and override scalar fields only, so they inherit the field (spec §3.6).

- [ ] **Step 5: Run typecheck to verify it goes green**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npm run typecheck 2>&1 | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t0-typecheck-green.txt
```
Expected: exit 0, no output.

The two row assertions at `:118` and `:133` still expect `'LOT-260301-0001'` at index 2 and still pass — `documents/yarn-delivery.ts:20` has not changed yet. Task 1 turns them red on purpose.

- [ ] **Step 6: Gate**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npm run verify 2>&1 | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t0-verify.txt; tail -30 /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t0-verify.txt
```
Expected: format:check, lint, typecheck, contract:paths, test:coverage (all suites green, thresholds 80/75/80 per `fabtraq-fe/vitest.config.ts:18-23`) and build all exit 0.

- [ ] **Step 7: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
git add package.json package-lock.json tests/msw/handlers/jw-challans-out.ts src/features/challan-print/documents/yarn-delivery.test.ts
git commit -m "chore(fe): bump shared to 1.28.0 and carry partyLotNo in fixtures

A required-nullable partyLotNo on JwChallanOutItemResponse breaks every FE
producer; MSW handlers are jsonValidated so a missed site fails the suite.

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §3.6, §6 step 3

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

### Task 1 (Wave 3a): Print the party lot and widen its column

**Files:**
- Modify: `fabtraq-fe/src/features/challan-print/documents/yarn-delivery.ts:20`
- Modify: `fabtraq-fe/src/features/challan-print/templates/yarn-delivery.ts:7-8`
- Test: `fabtraq-fe/src/features/challan-print/documents/yarn-delivery.test.ts:113-137` (rewrite two assertions, add two)
- Test: `fabtraq-fe/src/features/challan-print/templates/yarn-delivery.test.ts:5-21` (add two assertions)
- Modify: `fabtraq-fe/scripts/challan-visual.ts:21-22` (dead OUT_DIR) and `:219-233` (case 14)
- Modify (doc, ×3 byte-identical): `fabtraq-be/docs/specs/2026-08-21-challan-pdf-design.md:128` → mirrored to `fabtraq-fe/docs/specs/` and `fabtraq-shared/docs/specs/` with `cp`
- Modify (not committed anywhere — see Step 12): `.claude/agents/modules/challan-print/BRIEF.md`

**Interfaces:**
- Consumes: `JwChallanOutItemResponse.partyLotNo: string | null` (Task 0); the `item()` factory now defaults `partyLotNo: 'PL-441'`.
- Produces: nothing other tasks import. `YARN_COLUMNS` keeps its exported name, arity (6) and element shape; only two `widthPct` numbers change.

**Geometry, restated so the executor can check it without opening the spec** (spec §3.3):

| Check | Before | After |
|---|---|---|
| Σ `widthPct` | 6.5 + 42.0 + 15.0 + 10.5 + 14.0 + 12.0 = **100.0** | 6.5 + 37.0 + 20.0 + 10.5 + 14.0 + 12.0 = **100.0** |
| Cumulative span before `boxFromColumn: 6` (`documents/yarn-delivery.ts:39`) | 6.5 + 42 + 15 + 10.5 + 14 = **88.0** | 6.5 + 37 + 20 + 10.5 + 14 = **88.0** |
| `labelSpanIsNarrow` (`render.tsx:208-212`, `spanPct < 50`) | 88.0 → `false` | 88.0 → `false` |

Only the boundary between columns 2 and 3 moves. Every boundary from column 4 rightwards, and therefore the whole totals strip, is byte-identical. **Note for Step 5:** Σ = 100.0 and span = 88.0 are *invariant* across this change — they are regression guards, not the red test. The genuinely-failing assertion is the explicit `37.0` / `20.0` widths.

`shrinkToFit` **stays** on the Lot No. column: a long combined party lot shrinks to the 6pt floor and then pre-truncates with `…` rather than being handed to react-pdf's line breaker, whose forced break injects a hyphen glyph and falsifies the identifier (I2; `render.tsx:266-275`). L7 accepts that a 2-way long vendor-format merge truncates.

`render.tsx`, `paginate.ts`, `types.ts`, `font-metrics.ts`, `fonts.ts`: **no change**. The renderer keeps zero domain knowledge (I1).

- [ ] **Step 1: Capture the BEFORE PNGs**

The visual script writes `${OUT_DIR}/${name}.pdf` and pdftoppm writes `${OUT_DIR}/${name}-1.png` under deterministic names (`challan-visual.ts:127-129`), so a second run **overwrites** the first. Capture "before" into its own directory now, while the code is still at 42/15.

First point `OUT_DIR` at a live path. `fabtraq-fe/scripts/challan-visual.ts:21-22` currently hardcodes a dead session scratchpad. Replace those two lines with:

```ts
// ponytail: session-scoped scratchpad path, restated each session. Upgrade to an
// env var (CHALLAN_VISUAL_OUT) if this outlives more than one workstream.
const OUT_DIR =
  process.env.CHALLAN_VISUAL_OUT ??
  '/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/challan-visual';
```

Then run the matrix into a `before/` directory:

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
which pdftoppm   # must print a path; poppler is required
CHALLAN_VISUAL_OUT=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/challan-visual/before \
  npx vitest run --config scripts/vitest.visual.config.ts 2>&1 \
  | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t1-visual-before.txt
```
Expected: 14 cases pass. `challan-visual.ts` cannot run under plain `tsx`/`vite-node` — react-pdf resolves to its browser build outside vitest's ssr graph (BRIEF §8). Do not run this while any other vitest or Playwright run is in flight.

**Green cases are not the success criterion here.** If `CHALLAN_VISUAL_OUT` never reaches the test process, all 14 still pass and the PNGs land in the *default* directory — which Step 10 then overwrites, silently destroying the before/after comparison. Assert the files landed where you asked:

```bash
ls /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/challan-visual/before/*.png | wc -l
```
Expected: **14 or more**. If it prints 0 or errors, the env override did not take — pass the path another way (edit the default in `challan-visual.ts` for the duration) before going on. Do not proceed to Step 2 on an empty directory.

- [ ] **Step 2: Read the two before PNGs**

Open, with the Read tool, and describe what the Lot No. and Quality columns actually look like:
- `.../challan-visual/before/08-yarn-120-char-quality-1.png`
- `.../challan-visual/before/14-yarn-lot-no-edge-1.png`

Record both absolute paths and a one-line observation each. These are the baseline half of V7.

- [ ] **Step 3: Rewrite the two document tests that assert the minted lot, and add the two V5 cases**

In `fabtraq-fe/src/features/challan-print/documents/yarn-delivery.test.ts`, replace the assertion at `:115-122` (inside `it('maps a row: quality, lot no., cone, weights bare 3-decimal')`) and at `:130-137` (inside `it('renders a null cone and null grossWeight as blank, never 0.000')`) so cell index 2 is the **party** lot, then append two new cases to the same `describe('yarnDeliveryDocument')` block:

```ts
  it('maps a row: quality, PARTY lot no., cone, weights bare 3-decimal', () => {
    const doc = yarnDeliveryDocument(BASE_CHALLAN, GOSRANI);
    expect(doc.pages[0]?.rows[0]).toStrictEqual([
      '',
      '30s Combed Cotton',
      'PL-441',
      '10',
      '108.000',
      '104.000',
    ]);
  });

  it('renders a null cone and null grossWeight as blank, never 0.000', () => {
    const doc = yarnDeliveryDocument(
      { ...BASE_CHALLAN, items: [item({ cones: null, grossWeight: null })] },
      GOSRANI,
    );
    expect(doc.pages[0]?.rows[0]).toStrictEqual([
      '',
      '30s Combed Cotton',
      'PL-441',
      '',
      '',
      '104.000',
    ]);
  });

  // L2 + V5: a null party lot prints a BLANK cell and must never fall back to the
  // minted lot — the consignee cannot reconcile Gosrani's internal identity.
  it('prints an empty Lot No. cell when partyLotNo is null, and never the minted lot', () => {
    const doc = yarnDeliveryDocument(
      { ...BASE_CHALLAN, items: [item({ partyLotNo: null })] },
      GOSRANI,
    );
    const row = doc.pages[0]?.rows[0];
    expect(row?.[2]).toBe('');
    expect(row).not.toContain('LOT-260301-0001');
  });

  // L3: a merged party lot is combinePartyLots' own output, printed verbatim —
  // the document layer never splits, re-joins, re-sorts or truncates it.
  it('prints a combined party lot verbatim, separator and order untouched', () => {
    const combined = 'PL-441 / VND-2026-0087 / 7712-B';
    const doc = yarnDeliveryDocument(
      { ...BASE_CHALLAN, items: [item({ partyLotNo: combined })] },
      GOSRANI,
    );
    expect(doc.pages[0]?.rows[0]?.[2]).toBe(combined);
  });
```

- [ ] **Step 4: Run the document tests and confirm all four fail**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npx vitest run src/features/challan-print/documents/yarn-delivery.test.ts 2>&1 \
  | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t1-doc-red.txt
```
Expected: FAIL — the four cases above report `'LOT-260301-0001'` where `'PL-441'`, `''` or the combined string is expected. The mapper still reads `item.sourceLotNumber`.

- [ ] **Step 5: Add the width assertions to the template test**

In `fabtraq-fe/src/features/challan-print/templates/yarn-delivery.test.ts`, append two cases to `describe('YARN_COLUMNS')`. The first is the red one; the second is an explicit regression guard for geometry that this change deliberately leaves invariant.

```ts
  // spec 2026-09-02-party-lot-on-jw-out-challan-design.md L7: the Lot No. column
  // now carries the party's own lot (often a merged " / " string) and needs the
  // width; Quality gives up the 5 points.
  it('gives Quality 37% and Lot No. 20%, with Lot No. still shrinkToFit', () => {
    expect(YARN_COLUMNS[1]).toStrictEqual({ header: 'Quality', widthPct: 37.0, align: 'left' });
    expect(YARN_COLUMNS[2]).toStrictEqual({
      header: 'Lot No.',
      widthPct: 20.0,
      align: 'left',
      shrinkToFit: true,
    });
  });

  // Regression guard, invariant across the 42/15 → 37/20 move: only the boundary
  // between cols 2 and 3 shifts, so the totals strip (boxFromColumn: 6) and
  // labelSpanIsNarrow (render.tsx:208-212, spanPct < 50 → false) are untouched.
  it('keeps the cumulative span before the totals box at 88%', () => {
    const span = YARN_COLUMNS.slice(0, 5).reduce((sum, col) => sum + col.widthPct, 0);
    expect(span).toBeCloseTo(88, 5);
  });
```

The existing `Σ = 100` case at `:6-10` is left as it is — it already guards the other half of the arithmetic and passes both before and after.

- [ ] **Step 6: Run the template test and confirm the widths case fails**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npx vitest run src/features/challan-print/templates/yarn-delivery.test.ts 2>&1 \
  | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t1-tpl-red.txt
```
Expected: FAIL on `gives Quality 37% and Lot No. 20%` — received `widthPct: 42` / `widthPct: 15`. The 88% guard and the Σ = 100 case **pass** already; that is intended and is why the widths case is the red one.

- [ ] **Step 7: Make both changes**

`fabtraq-fe/src/features/challan-print/documents/yarn-delivery.ts:17-24` — one line changes:

```ts
  const rows = c.items.map((item) => [
    '',
    item.qualityName,
    // The party's own lot number, verbatim (already " / "-combined BE-side). Blank
    // when the origin recorded none — never the minted lot, which the consignee
    // cannot reconcile (spec 2026-09-02-party-lot-on-jw-out-challan-design.md L1-L3).
    item.partyLotNo ?? '',
    item.cones === null ? '' : String(item.cones),
    weight3(item.grossWeight),
    weight3(item.netWeight),
  ]);
```

`fabtraq-fe/src/features/challan-print/templates/yarn-delivery.ts:7-8` — two numbers change:

```ts
  { header: 'Quality', widthPct: 37.0, align: 'left' },
  { header: 'Lot No.', widthPct: 20.0, align: 'left', shrinkToFit: true },
```

- [ ] **Step 8: Run both test files and confirm green**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npx vitest run src/features/challan-print/ 2>&1 \
  | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t1-print-green.txt
```
Expected: PASS, all 12 colocated challan-print files. `render.test.tsx` runs under `// @vitest-environment node` and uses fs paths — do not "fix" it (BRIEF §7 traps).

- [ ] **Step 9: Re-point visual case 14 at party-lot values**

Replace the rows and the stale comment in `fabtraq-fe/scripts/challan-visual.ts:219-233`. Case 14 must now exercise what the column actually prints: a 3-way short merge that should fit, a 2-way long vendor-format merge that L7 accepts will truncate, a blank cell, and a short control.

```ts
it('14. yarn — party lot numbers at the column-width edge (merged and blank)', async () => {
  // The Lot No. column prints partyLotNo verbatim at 20% (spec
  // 2026-09-02-party-lot-on-jw-out-challan-design.md L1-L3, L7). At 20% of the
  // 186 mm content width the interior is ~31 chars at 9pt before shrinkToFit
  // starts; below the 6pt floor the value pre-truncates with an ellipsis.
  const rows = [
    ['', '20s CP', 'PL-441 / PL-442 / PL-443', '10', '9.000', '8.000'], // 3-way short merge, should fit
    ['', '20s CP', 'VND/2026-27/LOT-00871-A / VND/2026-27/LOT-00872-B', '10', '9.000', '8.000'], // 2-way long vendor merge — L7 accepts truncation
    ['', '20s CP', '', '', '', '8.000'], // null origin → blank cell (L2), never the minted lot
    ['', '20s CP', 'PL-441', '10', '9.000', '8.000'], // short control
  ];
  await renderAndCapture(
    '14-yarn-lot-no-edge',
    yarnDoc({
      pages: paginate(rows, rowsPerPageFor(rows.length, YARN_ROWS)),
      totals: { label: 'TOTAL', boxFromColumn: 6, cells: [null, null, null, null, null, '32.000'] },
    }),
  );
});
```

Case 8 (`:170-185`, the 120-char quality name) is **not edited** — it is the case this change degrades, and it must stay exactly as it is so the before/after PNGs are comparable (spec §3.3, Q3).

- [ ] **Step 10: Capture the AFTER PNGs and read all four**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
CHALLAN_VISUAL_OUT=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/challan-visual/after \
  npx vitest run --config scripts/vitest.visual.config.ts 2>&1 \
  | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t1-visual-after.txt
```
Expected: 14 cases pass, and the same directory check as Step 1:

```bash
ls /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/challan-visual/after/*.png | wc -l
```
Expected: **14 or more**. An empty `after/` means the override did not take and Step 1's `before/` PNGs may have just been overwritten — stop and re-capture both.

Then **read** with the Read tool, as a first-time user would:
- `.../challan-visual/after/08-yarn-120-char-quality-1.png` — does the 120-char quality name still read? Spec §3.3 predicts it loses ~4.9 characters **per wrapped line** at 37%, so it may clip several words rather than five characters. This is Q3.
- `.../challan-visual/after/14-yarn-lot-no-edge-1.png` — does the 3-way short merge fit complete on one line? Does the 2-way long vendor merge truncate with a visible `…` and no hyphen glyph (I2)? Is the third row's cell genuinely blank?

**Put all four absolute PNG paths in the task report**, with a before/after verdict for each. If the case-8 after PNG shows a quality name clipped to the point of ambiguity, do not silently proceed — report it as the Q3 trigger; spec §4.1 names 39/18 as the fallback split, and that is the owner's call, not the executor's.

- [ ] **Step 11: Amend the challan-pdf design doc and re-mirror it byte-for-byte**

`fabtraq-be/docs/specs/2026-08-21-challan-pdf-design.md:128` currently reads:

```
`No. 6.5 | Quality 42.0 | Lot No. 15.0 | Cone 10.5 | Gr. Wt. 14.0 | Net Wt. 12.0`
```

Replace that line with:

```
`No. 6.5 | Quality 37.0 | Lot No. 20.0 | Cone 10.5 | Gr. Wt. 14.0 | Net Wt. 12.0`
(Lot No. widened 2026-09-02 — the column now prints the party's own lot number, often a
" / "-combined string; Quality gave up the 5 points. See
`docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md` §3.3.)
```

Then mirror with `cp`, never by hand. This doc has **three** copies, verified on disk 2026-09-02: canonical in `fabtraq-be/docs/specs/`, plus `fabtraq-fe/docs/specs/` and `fabtraq-shared/docs/specs/`. There is **no root `docs/` copy and no `e2e/` copy** (challan-print BRIEF §3 item 1).

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software
cp fabtraq-be/docs/specs/2026-08-21-challan-pdf-design.md fabtraq-fe/docs/specs/2026-08-21-challan-pdf-design.md
cp fabtraq-be/docs/specs/2026-08-21-challan-pdf-design.md fabtraq-shared/docs/specs/2026-08-21-challan-pdf-design.md
cmp fabtraq-be/docs/specs/2026-08-21-challan-pdf-design.md fabtraq-fe/docs/specs/2026-08-21-challan-pdf-design.md
cmp fabtraq-be/docs/specs/2026-08-21-challan-pdf-design.md fabtraq-shared/docs/specs/2026-08-21-challan-pdf-design.md
```
Expected: both `cmp` calls silent. Prettier ignores `*.md` in all three repos on purpose (memory `feedback_prettier_skips_mirrored_docs`), so `format:check` will not reformat the mirrors apart.

- [ ] **Step 12: Refresh the stale handbook lines (spec §8 items 2 and 4)**

Edit `.claude/agents/modules/challan-print/BRIEF.md`:

| Line | Now reads | Change to |
|---|---|---|
| `:24-28` (§1 "In flight 2026-09-01") | "not yet in any local checkout"; "current FE still prints `sourceLotNumber` … at 42/15" | Shipped 2026-09-02: `documents/yarn-delivery.ts:20` prints `item.partyLotNo ?? ''`; `templates/yarn-delivery.ts:7-8` is 37/20. Cite `fabtraq-be/docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md`. |
| `:100` (I20) | "(the FE line does not exist yet — see §1)" | Cite the live line `fabtraq-fe/src/features/challan-print/documents/yarn-delivery.ts:20` alongside the shared schema. |
| `:105` (§5) | "resolved BE-side via `findPartyLotsByLotNumbers` **+ `combinePartyLots`**" | Wrong per spec §3.2 and §8 item 7: resolution is **single-hop**, the value is already joined, and it is never re-derived. Drop the `combinePartyLots` clause. |
| `:112` (§6) | "FE fixtures lack `partyLotNo`: … `jw-challans-out.ts:38,131,147,183` build items without it … FE is on shared 1.27.0 (`fabtraq-fe/package.json:27`)" | Closed 2026-09-02. Note that the inference was wrong (those sites **spread** `mockJwChallanOutItem` and inherit the field — spec §3.6), and that the pin is at `fabtraq-fe/package.json:**28**`, now `1.28.0`. |
| `:111` (§6) | "Spec §4:128 **will go stale**"; "Same for `scripts/challan-visual.ts` case 14 comment" | Both done in this commit. |
| `:115` (§6) | "`challan-visual.ts:21-22` hardcodes a dead session scratchpad path as OUT_DIR" | Now `CHALLAN_VISUAL_OUT` with a scratchpad default (Step 1). |

Re-verify every line number before quoting it — a stale `file:line` in a handbook is a finding, not an excuse (BRIEF header).

**This file lands in no commit.** `.claude/agents/` sits at the repo root, which is **not a git repository** (verified: `git -C fabtraq-fe ls-files` reports the path is outside the repository, and the root has no `.git`). The four checkouts are `fabtraq-be`, `fabtraq-fe`, `fabtraq-shared` and `e2e`. Say so explicitly in the task report so nobody hunts for the handbook change in a diff.

- [ ] **Step 13: Gate**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npm run verify 2>&1 | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t1-verify.txt; tail -30 /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t1-verify.txt
```
Expected: every stage exits 0; coverage still at or above 80/75/80. Do not start this while Task 2's agent may be running a suite — the lock will fail fast naming the PID.

- [ ] **Step 14: Commit (two repos)**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
git add src/features/challan-print/documents/yarn-delivery.ts \
        src/features/challan-print/documents/yarn-delivery.test.ts \
        src/features/challan-print/templates/yarn-delivery.ts \
        src/features/challan-print/templates/yarn-delivery.test.ts \
        scripts/challan-visual.ts \
        docs/specs/2026-08-21-challan-pdf-design.md
git commit -m "feat(challan-print): print the party lot on the yarn challan, widen Lot No. to 20%

The consignee cannot reconcile Gosrani's minted LOT-… against anything they
hold. Lot No. now prints partyLotNo verbatim, blank when absent, never falling
back to the minted lot. Quality 42->37, Lot No. 15->20; sum stays 100.0 and the
span before the totals box stays 88.0, so the totals strip is untouched.

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §3.3, §8

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

The canonical doc and the shared mirror are separate repos and need their own commits:

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
git add docs/specs/2026-08-21-challan-pdf-design.md
git commit -m "docs(challan-print): yarn column widths are 37/20 after the party-lot change

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §8 item 1

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"

cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-shared
git add docs/specs/2026-08-21-challan-pdf-design.md
git commit -m "docs(challan-print): yarn column widths are 37/20 after the party-lot change

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §8 item 1

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

### Task 2 (Wave 3b): Stack the party lot above the minted lot on both detail pages

Runs concurrently with Task 1. Disjoint file set, proved in the Waves table above.

**Files:**
- Modify: `fabtraq-fe/src/features/jw-challans-out/jw-challan-out-detail.page.tsx:316`
- Modify: `fabtraq-fe/src/features/weaving-dispatches/weaving-dispatch-detail.page.tsx:296`
- Modify: `fabtraq-fe/tests/msw/handlers/jw-challans-out.ts` (append one exported fixture)
- Modify: `fabtraq-fe/tests/msw/handlers/weaving-dispatches.ts` (append one exported fixture)
- Test: `fabtraq-fe/tests/integration/features/jw-challans-out/detail.page.test.tsx` (append two cases)
- Test: `fabtraq-fe/tests/integration/features/weaving-dispatches/detail.page.test.tsx` (append two cases)

**Interfaces:**
- Consumes: `JwChallanOutItemResponse.partyLotNo: string | null` (Task 0); `mockJwChallanOutItem.partyLotNo === null` (Task 0 Step 4).
- Produces: `mockJwChallanOutWithPartyLot: JwChallanOutResponse` and `mockWeavingDispatchWithPartyLot: WeavingDispatchResponse`, each with its own id, resolved by the existing GET-by-id handlers. Nothing outside these two test files imports them.

**Why new fixtures and not a `server.use` override.** `renderAt` calls `server.use(auth, ...jwChallanOutHandlers)` **inside itself** (`tests/integration/features/jw-challans-out/detail.page.test.tsx:92-96`; the weaving twin at `:87-91`). An override registered before `renderAt` is shadowed by that call, and one registered after races the on-mount query. The handler files already carry this idiom three times over — `mockJwChallanOutWithReceipt`, `mockJwChallanOutFullyReceived`, `mockJwChallanOutMixedReceipt` — each a distinct id the GET-by-id handler resolves. Follow it.

**The cell shape** (spec §3.4, L6) — party lot leads, minted lot beneath in muted text, `—` when null:

```tsx
<TableCell className="text-xs">
  <div className="font-mono">{item.partyLotNo ?? '—'}</div>
  <div className="font-mono text-muted-foreground">{item.sourceLotNumber}</div>
</TableCell>
```

`—` on screen, not blank: an internal screen with an em-dash reads as "we have no party lot for this", which is information. A blank *printed* cell is L2's deliberate silence on a document the party signs. **Both column headers stay exactly as they are** — `Source Lot` on the jw-out page (`:291`) and `Lot No` on the weaving page (`:279`). A second header would imply two columns.

- [ ] **Step 1: Add the two valued fixtures**

At the **end** of `fabtraq-fe/tests/msw/handlers/jw-challans-out.ts`'s fixture block — after the last existing `mockJwChallanOut*` export and before the handler array — add:

```ts
export const JWO_PARTY_LOT_ID = '00000000-0000-0000-0000-000000000c31' as JwChallanOutId;

/** A challan whose one item DOES carry a party lot — the detail page must show it
 * above the minted lot (spec 2026-09-02-party-lot-on-jw-out-challan-design.md §3.4). */
export const mockJwChallanOutWithPartyLot: JwChallanOutResponse = {
  ...mockJwChallanOut,
  id: JWO_PARTY_LOT_ID,
  challanNo: 'JWO-2026-27-091' as JwChallanOutNo,
  items: [{ ...mockJwChallanOutItem, partyLotNo: 'PL-441' }],
};
```

Confirm the GET-by-id handler resolves it. The existing handler switches on the id across the exported fixtures; add `mockJwChallanOutWithPartyLot` to that lookup exactly the way `mockJwChallanOutMixedReceipt` is added. Read the handler before editing — do not guess its shape.

At the end of `fabtraq-fe/tests/msw/handlers/weaving-dispatches.ts`'s fixture block, add:

```ts
export const WD_PARTY_LOT_ID = '00000000-0000-0000-0000-000000000e30' as WeavingDispatchId;

/** A dispatch whose weft item carries a party lot. The weft challan is the whole
 * JwChallanOutResponse embedded (weaving-dispatch.ts:168), so it inherits the
 * field for free — spec §3.5. */
export const mockWeavingDispatchWithPartyLot: WeavingDispatchResponse = {
  ...mockWeavingDispatch,
  id: WD_PARTY_LOT_ID,
  // Same spread shape as mockWeavingDispatch at :68 — the weft challan must point
  // back at ITS OWN dispatch, not at WD_ID.
  weftChallanOut: { ...mockJwChallanOutWithPartyLot, weavingDispatchId: WD_PARTY_LOT_ID },
};
```

`mockWeavingDispatch.weftChallanOut` at `:68` is `{ ...mockJwChallanOut, weavingDispatchId: WD_ID }`, so the **default** weaving fixture's weft item has `partyLotNo: null` — which is the `—` case. Register the new dispatch in that file's GET-by-id handler the same way `mockWeavingDispatchBeamOnly` is registered. Import `mockJwChallanOutWithPartyLot` from `./jw-challans-out`, matching how the file already imports `mockJwChallanOut`.

- [ ] **Step 2: Write the four failing integration tests**

Append to `describe('JwChallanOutDetailPage')` in `fabtraq-fe/tests/integration/features/jw-challans-out/detail.page.test.tsx` (add `mockJwChallanOutWithPartyLot` to the import list at `:14-22`):

```ts
  // L6 / V4: the party lot leads, the minted lot sits beneath it in muted text —
  // staff trace stock by the minted one, the party knows only their own.
  it('shows the party lot above the minted lot for an item that has one', async () => {
    renderAt(`/jw-challans-out/${mockJwChallanOutWithPartyLot.id}`);

    await waitFor(() => {
      expect(screen.getByText(mockJwChallanOutWithPartyLot.challanNo)).toBeInTheDocument();
    });

    const partyLot = await screen.findByText('PL-441');
    expect(partyLot).toBeInTheDocument();
    const mintedLot = screen.getByText('LOT-260301-0001');
    expect(mintedLot).toBeInTheDocument();
    expect(mintedLot).toHaveClass('text-muted-foreground');
    // DOCUMENT_POSITION_FOLLOWING === 4: the minted lot comes after the party lot.
    expect(partyLot.compareDocumentPosition(mintedLot) & 4).toBe(4);
  });

  // V4: no party lot on screen reads as an em-dash — "we have no party lot for
  // this" is information. The PDF's blank cell (L2) is a different, deliberate
  // silence; the two surfaces differ on purpose.
  it('shows an em-dash above the minted lot when partyLotNo is null', async () => {
    renderAt(`/jw-challans-out/${mockJwChallanOut.id}`);

    await waitFor(() => {
      expect(screen.getByText(mockJwChallanOut.challanNo)).toBeInTheDocument();
    });

    const mintedLot = await screen.findByText('LOT-260301-0001');
    expect(mintedLot).toHaveClass('text-muted-foreground');
    const cell = mintedLot.closest('td');
    expect(cell).not.toBeNull();
    expect(within(cell as HTMLElement).getByText('—')).toBeInTheDocument();
  });
```

`within` is not currently imported in this file (`:3` imports `fireEvent, render, screen, waitFor`) — add it.

Append to `describe('WeavingDispatchDetailPage')` in `fabtraq-fe/tests/integration/features/weaving-dispatches/detail.page.test.tsx` (add `mockWeavingDispatchWithPartyLot` to the import list at `:13-18`; `within` is already imported at `:3`):

```ts
  // V8: the weft challan is the whole JwChallanOutResponse embedded, so it
  // inherits partyLotNo with no weaving-side schema or mapper change (spec §3.5).
  it('shows the party lot above the minted lot in the weft table', async () => {
    renderAt(`/weaving-dispatches/${mockWeavingDispatchWithPartyLot.id}`);

    await waitFor(() => {
      expect(
        screen.getByText(
          new RegExp(escapeRegExp(mockWeavingDispatchWithPartyLot.beamChallanNo as string)),
        ),
      ).toBeInTheDocument();
    });

    const partyLot = await screen.findByText('PL-441');
    const mintedLot = screen.getByText('LOT-260301-0001');
    expect(mintedLot).toHaveClass('text-muted-foreground');
    expect(partyLot.compareDocumentPosition(mintedLot) & 4).toBe(4);
  });

  it('shows an em-dash above the minted lot when the weft item has no party lot', async () => {
    renderAt(`/weaving-dispatches/${mockWeavingDispatch.id}`);

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(escapeRegExp(mockWeavingDispatch.beamChallanNo as string))),
      ).toBeInTheDocument();
    });

    const mintedLot = await screen.findByText('LOT-260301-0001');
    const cell = mintedLot.closest('td');
    expect(cell).not.toBeNull();
    expect(within(cell as HTMLElement).getByText('—')).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run both integration files and confirm all four fail**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npx vitest run tests/integration/features/jw-challans-out/detail.page.test.tsx \
               tests/integration/features/weaving-dispatches/detail.page.test.tsx 2>&1 \
  | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t2-red.txt
```
Expected: FAIL — `Unable to find an element with the text: PL-441` (and `—`) on all four. Both pages still render only `item.sourceLotNumber` in a single-line cell.

If a test fails instead with an MSW "no handler" or a 404, the fixture is not registered in its GET-by-id handler — go back to Step 1.

- [ ] **Step 4: Change the jw-out cell**

`fabtraq-fe/src/features/jw-challans-out/jw-challan-out-detail.page.tsx:316`. The map variable in this file is `item` (`:313`). Replace the single line:

```tsx
                    <TableCell className="font-mono text-xs">{item.sourceLotNumber}</TableCell>
```

with:

```tsx
                    <TableCell className="text-xs">
                      {/* Party lot leads — the job worker knows only their own number.
                          Minted lot beneath in muted text: staff trace stock by it.
                          Spec 2026-09-02-party-lot-on-jw-out-challan-design.md §3.4 (L6). */}
                      <div className="font-mono">{item.partyLotNo ?? '—'}</div>
                      <div className="font-mono text-muted-foreground">{item.sourceLotNumber}</div>
                    </TableCell>
```

Match the file's existing indentation exactly — the surrounding cells sit at the same depth (`:315-329`). The `Source Lot` header at `:291` is **not** touched.

- [ ] **Step 5: Change the weaving weft cell**

`fabtraq-fe/src/features/weaving-dispatches/weaving-dispatch-detail.page.tsx:296`. **The map variable in this file is `it`, not `item`** (`:292`, `{weftItems.map((it, i) => (`). Replace:

```tsx
                    <TableCell className="font-mono text-xs">{it.sourceLotNumber}</TableCell>
```

with:

```tsx
                    <TableCell className="text-xs">
                      {/* Same stacked cell as the JW-Out detail page — the weft challan is
                          the whole JwChallanOutResponse embedded, so it inherits partyLotNo
                          with no weaving-side BE change (spec §3.4, §3.5). */}
                      <div className="font-mono">{it.partyLotNo ?? '—'}</div>
                      <div className="font-mono text-muted-foreground">{it.sourceLotNumber}</div>
                    </TableCell>
```

The `Lot No` header at `:279` is **not** touched — `detail.page.test.tsx:131` asserts that exact string and must keep passing.

- [ ] **Step 6: Run both integration files and confirm green**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npx vitest run tests/integration/features/jw-challans-out/detail.page.test.tsx \
               tests/integration/features/weaving-dispatches/detail.page.test.tsx 2>&1 \
  | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t2-green.txt
```
Expected: PASS, including the pre-existing `renders the Beams/Weft sections` case that asserts `getByText('Lot No')` (`:131`) and the two quality-name cases (`jw-challans-out` `:158-171`, `weaving-dispatches` `:241-256`).

- [ ] **Step 7: Verify the change visually as a first-time user**

Green tests prove nothing about looks (memory `feedback_verify_ui_visually`). Take a live screenshot of the JW-Out detail page's Line items table and of the weaving-dispatch weft table, and read them: is the muted minted lot clearly secondary without being unreadable? Do two lines in one cell push the row height out of line with its neighbours? Does the `—` row look intentional rather than broken?

Save the screenshots under the scratchpad and put both absolute paths in the task report.

- [ ] **Step 8: Gate**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npm run verify 2>&1 | tee /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t2-verify.txt; tail -30 /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/fe-t2-verify.txt
```
Expected: every stage exits 0; coverage at or above 80/75/80. One test run at a time — if Task 1 is mid-suite, wait for its lock.

- [ ] **Step 9: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
git add src/features/jw-challans-out/jw-challan-out-detail.page.tsx \
        src/features/weaving-dispatches/weaving-dispatch-detail.page.tsx \
        tests/msw/handlers/jw-challans-out.ts \
        tests/msw/handlers/weaving-dispatches.ts \
        tests/integration/features/jw-challans-out/detail.page.test.tsx \
        tests/integration/features/weaving-dispatches/detail.page.test.tsx
git commit -m "feat(jw-challans-out,weaving-dispatches): show the party lot above the minted lot

A floor query from the party (\"which challan carried our PL-441?\") had no answer
on screen. Both detail pages now stack the party lot over the minted lot in muted
text, em-dash when absent. The weft table inherits the field via the embedded
JwChallanOutResponse — no weaving-side BE change.

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §3.4, §3.5

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

## Per-task diff review

Per CLAUDE.md Stage 4, each task's diff goes to its module reviewer before the next dispatch. Max 2 rounds, then the owner.

| Task | Reviewer |
|---|---|
| 0 | `challan-print-fe-reviewer` (it moves the print fixture) |
| 1 | `challan-print-fe-reviewer` |
| 2 | `jw-challan-out-fe-reviewer` **and** `weaving-fe-reviewer` — the weaving-owned cell at `weaving-dispatch-detail.page.tsx:296` is the one weaving-side edit in the whole workstream (spec §3.5) and must be seen by that module's reviewer |

Run `node .claude/helpers/check-citations.mjs` on any agent report that cites `file:line`.

---

## Self-review

**Spec coverage.** §3.3 printed cell + widths → Task 1 Steps 3-8. §3.4 both detail cells → Task 2 Steps 4-5. §3.5 weaving inherits, no schema change → Task 2 Step 1 fixture + Step 5, and asserted by the V8 test. §3.6 FE fixture sites (`msw/handlers/jw-challans-out.ts:33` and the POST map, `documents/yarn-delivery.test.ts:36`) → Task 0 Step 4; `msw/handlers/weaving-dispatches.ts` is transitive and needs no edit for the bump, only the new fixture in Task 2. §4.1 Q3 → Task 1 Step 10 reads case 8 and escalates rather than deciding. §6 step 3 (bump, `.vite`, then everything together) → Task 0 Steps 2-4. §7 V4 → Task 1 Step 3 case 3 (blank) + Task 2 Step 2 cases 2 and 4 (`—`). V5 → Task 1 Step 3 case 3's `not.toContain`. V7 → Task 1 Steps 1-2 and 10 (before/after PNGs) plus the template test's width and span assertions. V8 → Task 2 Step 2 weaving case 1. §8 item 1 (doc widths + re-mirror) → Task 1 Step 11. §8 item 2 (case 14 comment) → Step 9. §8 item 4 (challan-print BRIEF, plus item 7's `:105` error) → Step 12. §8 items 3, 5, 6 belong to the BE and shared plans, not this one. V1's `list`/`create` real-wire leg is the smoke suite, which needs no edit. V9 (open the PDF and read the column live) is a Stage-5 release gate, not a task here.

**Not in this plan, on purpose.** The `jw-challan-out` BRIEF refresh (§8 item 3) is the BE plan's — its stale lines are about `findPartyLotsByLotNumbers` not being called from that service, which the BE change closes. e2e spec changes are the e2e plan's. The shared publish is the shared plan's Task 2, executed inside BE Wave 2.

**Placeholder scan.** Every code step carries the real block. No "TBD", no "add appropriate error handling", no "similar to Task N" — the stacked-cell JSX is written out in full in both Task 2 steps because the local map variable differs (`item` vs `it`) and the two pages must not be copy-pasted blind.

**Type consistency.** One field name throughout: `partyLotNo`, `string | null`, matching the shared plan's contract line exactly. `YARN_COLUMNS` keeps its name and 6-element arity. New fixture exports are named once and referenced by those names: `JWO_PARTY_LOT_ID` / `mockJwChallanOutWithPartyLot`, `WD_PARTY_LOT_ID` / `mockWeavingDispatchWithPartyLot`. The party-lot literal is `'PL-441'` in every fixture and every assertion. `CHALLAN_VISUAL_OUT` is the env var name in both Step 1 and Step 10.

**Two known asymmetries, both deliberate.** The `documents/yarn-delivery.test.ts` `item()` factory defaults `partyLotNo` to `'PL-441'` while MSW's `mockJwChallanOutItem` defaults to `null`: the unit factory needs a present value or the happy-path row assertion stops testing anything, and the MSW default is the `—` case both detail-page tests need. And the PDF prints `''` while the screens print `—`: L2's silence on a signed document versus information on an internal screen (§3.4).
