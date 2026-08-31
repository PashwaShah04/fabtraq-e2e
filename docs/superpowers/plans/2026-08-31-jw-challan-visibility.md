# JW Challan Visibility & Seed Ledger Fidelity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two JW-challan detail pages state what actually happened, and make the seed write the ledger the application writes.

**Architecture:** Four findings, three of them one-line-deep and one of them a
root cause with three symptoms. F1 is the only contract change: `pendingAtJW`
and its siblings exist on the BE (`getOutItemRollup`) but never reach the wire,
so the JW-Out page substitutes `placementStatus` for receipt status and offers
a write-off action the BE then rejects. F2 and F3 are FE-only. F4 replaces
hand-rolled seed ledger writes with calls to the application's own ledger
writers, so the seed cannot drift from the convention again.

**Tech Stack:** zod (shared schemas), TypeScript strict, Express 5 + Prisma 5 (BE), React 18 + react-hook-form (FE), vitest everywhere, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-31-jw-challan-visibility-design.md` — read it before Task 1.

## Global Constraints

- Branch: **`feat/inventory-rewoven` in all four repos.** No new branches, no worktrees.
- Node 22 only. npm only. No new dependencies.
- No `any`, no `.js` import extensions, no default exports, no `console.*`.
- `fabtraq-shared` version: **1.26.0 → 1.27.0**, published to GitHub Packages (owner decision D3). Minor, matching precedent for additive response fields. Consumers are `fabtraq-be` and `fabtraq-fe` only.
  - **The registry is the authority, not local `package.json`.** Checked 2026-08-31: local said `1.26.0` while the registry topped out at `1.25.0` — 1.26.0 had been bumped and consumed by BE/FE (`^1.26.0`, installed) but never published, so a clean `npm ci` on this branch could not resolve it. 1.26.0 has since been published. Always `npm view @pashwashah04/fabtraq-shared version` first.
  - **`npm publish` packs the WORKING TREE, not the commit.** `prepare: tsup` rebuilds `dist/` at publish time from whatever is on disk, so publishing "version N" while newer schema work sits uncommitted in `src/` silently ships that work inside version N. Before publishing: `git stash push -- src/ tests/`, confirm `git status --porcelain` shows only docs, build, run the export diff, publish, then `git stash pop`.
  - **Export diff before every publish:** `npm pack @pashwashah04/fabtraq-shared@<published latest> --pack-destination <tmp>`, then compare the exported names in its `dist/index.d.ts` against the local build's. Anything present in the published one and missing locally is an export you are about to delete. For 1.26.0 this read 0 removed / 53 added, and confirmed `outItemRollupSchema` was correctly ABSENT — which is what proved the stash had held.
  - Consumers install a local `--no-save` tarball until Task 8 publishes. After any tarball install in `fabtraq-fe`, `rm -rf node_modules/.vite` or the dev server keeps bundling the stale schema. Verify at RUNTIME (`require(...).outItemRollupSchema`), not by grepping `node_modules` — the two disagreed once on this box.
- Tolerance for "is anything still pending" is the existing kg tolerance constant, never a bare `> 0` — a float residue would resurrect the dead button.
- Commit after each task. Pushes batched at the end of the workstream.
- BE integration tests run against the isolated **`fabtraq_test`** DB via a `DATABASE_URL` override. They wipe whatever DB they touch; never let them inherit the dev `.env`.
- `db:seed` does not reset. Use `db:reset && db:seed` after any integration run.
- e2e specs move in the **same commits** as the FE change they cover.
- Every role-gated element ships with both-branch tests (shown-for-allowed + hidden-for-disallowed) in the same change.

---

### Task 1: Shared — `outItemRollupSchema` on the out-item response  ✅ DONE (fd81c43, comment fix 21241a0)

**Files:**
- Modify: `fabtraq-shared/src/schemas/transaction/jw-challan-out.ts` (`jwChallanOutItemResponseSchema`)
- Modify: `fabtraq-shared/tests/schemas/transaction/jw-challan-out.test.ts`
- Modify: `fabtraq-shared/package.json` (version → 1.27.0)

**Interfaces:**
- Produces: `outItemRollupSchema`, `OutItemRollupResponse`, and a **required** `rollup` field on every out-item in `jwChallanOutResponseSchema.items`.
- Consumed by: Tasks 2, 4, 5.

**Blast radius — read before writing.** `jwChallanOutResponseSchema` is the
response schema for **five** registry endpoints, not one: `listJwChallansOut`
(wrapped in `pageOfSchema`), `getJwChallanOutById`, `createJwChallanOut`,
`updateJwChallanOut`, `cancelJwChallanOut`
(`src/registry/transaction/jw-challans-out.registry.ts:26-65`). A required
`rollup` therefore obliges **all five** BE paths to populate it, including the
list. That is the intended cost of `required` — see spec §3.1 for why optional
is rejected — but the spec's "the list endpoint is untouched" line is wrong and
is corrected in the same commit.

- [x] **Step 1: Write the failing schema tests**
  - A fixture out-item without `rollup` must now fail `jwChallanOutResponseSchema.safeParse`.
  - A fixture with a complete `rollup` must parse, and `pendingAtJW` must reject a negative.
- [x] **Step 2: Add `outItemRollupSchema`** with the seven fields mirroring the BE's `OutItemRollup`, each doc-commented, and wire `rollup` into `jwChallanOutItemResponseSchema`.
- [x] **Step 3: Bump to 1.27.0.** Do not publish yet — Task 8 publishes once, after BE and FE are green against a local tarball.
- [x] **Step 4:** `format:check`, `lint`, `typecheck`, `test`, `build` green.

---

### Task 2: BE — populate the rollup on all five response paths  ✅ DONE (ed2fbdc)

**Files:**
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.ts`
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts` (5 `mapJwChallanOutRow` call sites: ~80, ~221, ~245, ~280, ~336)
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.test.ts`
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.test.ts`
- Modify: `fabtraq-be/docs/openapi.json` (re-emit, do not hand-edit)

**Interfaces:**
- Consumes: Task 1's schema.
- Produces: every JW-Out response carries a true rollup.

- [x] **Step 1: Failing mapper test** — a mapped response without a supplied rollup must throw at the `jwChallanOutResponseSchema.parse` boundary the mapper already runs.
- [x] **Step 2: Extend the mapper** with a third parameter `rollupMap: ReadonlyMap<string, OutItemRollup>`, following the existing `lockMap` parameter precedent exactly. **Not defaulted** — TypeScript must force every call site to supply it. A default empty map would let a caller silently ship a response that then throws at parse, converting a compile error into a runtime 500.
- [x] **Step 3: One private helper on the service** that fetches the rollup for a row's items via `this.inventory.getOutItemRollup({ outItemIds, tx })` and calls the mapper. Repoint all five call sites at it.
  - The list path must collect every item id across the **whole page** and make **one** call, hoisted above the `items.map`. `getOutItemRollup` issues a fixed ~6 reads regardless of id count (verified), so batching keeps the list at a fixed per-page cost.
  - **Do not copy the neighbouring shape:** `list` resolves placement locks per row (`Promise.all(items.map(… resolveLocksForOutRow(row)))`, `jw-challan-out.service.ts:218-223`). Mirroring that for the rollup would make it N-per-page.
- [x] **Step 4: Integration test** — `GET /jw-challans-out/:id` on the seeded fully-received challan returns `pendingAtJW === 0` and `fullyReceived === true` for both items; a partially-received fixture returns a non-zero `pendingAtJW`. Happy + error path per the done-ness bar.
- [x] **Step 5:** re-emit OpenAPI; the CI drift gate must be green. Full BE gate set.

---

### Task 3: BE — seed through the real ledger writers (F4)  ⏳ IN PROGRESS

**Files:**
- Modify: `fabtraq-be/prisma/seed.ts` (8 hand-rolled `stockLedger.create` calls at ~503, ~587, ~700, ~781, ~924, ~945, ~1037, ~1154)
- Add: `e2e/tests/guards/seed-ledger-shape.spec.ts`

**Interfaces:** independent of Tasks 1–2; may run in parallel.

**Where the guard lives, and why not in BE integration.** The invariant is
about the *seeded* database, and `tests/helpers/setup-integration.ts`
truncates before each file — a BE integration test would run against an empty
DB and assert nothing. `prisma/seed.ts` also exports nothing (`main()` is
module-private, invoked at import), so a test cannot re-seed for itself. The
e2e suite already runs `db:reset && db:seed` before Playwright and has a `db`
fixture for raw SQL, so a spec under `tests/guards/` gets the fresh seed for
free. That is the guard's natural home.

- [ ] **Step 1: Write the failing invariant spec first.** Against the freshly seeded DB: (a) no `challan_out` or `challan_in` row is both floor-located **and** carries a `jobWorkerId`; (b) every `challan_out` item has both a floor-debit leg and a JW-credit leg; (c) every `challan_in` yarn item with sources has one JW-debit leg per source. This spec must be **red** on the current seed — confirm that before fixing, or it proves nothing. (Measured baseline: 5 `challan_out` rows, 0 JW legs, 5 hybrids; 3 `challan_in` rows, 0 JW-debit legs.)
- [ ] **Step 2: Replace the OUT writes.** `const inventory = new PrismaInventoryService(prisma)` once, then `await inventory.applyChallanOutLedger({ challanOutId, outItemId, date, qualityId, skuId, lotNumber, unit, jobWorkerId, processedTypes, tx })` at each of the five OUT sites. The writer reads the item's `placement` rows from `tx`, so each call must follow the `placement.create` calls it depends on — the seed already orders them that way. Delete the hand-rolled rows; do not keep them "for reference".
- [ ] **Step 3: Replace the IN writes** with `applyChallanInYarnLedger`, passing the real `sources` array so the per-source JW-debit legs are written on the source identity, not the received one.
- [ ] **Step 4: D2 — add a dyed SKU.** A `DYED MAROON` / shade `DYE-R01` SKU on the `20s CP` quality, and file the S3 received lot under it instead of reusing `SKU-001 RED`.
- [ ] **Step 5:** `db:reset && db:seed`, invariant test green, full BE gate set.

---

### Task 4: FE — one placement-status vocabulary (F2)

**Scope is three sites, not one.** The grep found three independent
vocabularies for the same three states (spec §1.2 table): JW-Out says
"Partially placed / Fully placed", Place Stock says "Partial / Placed", JW-In
renders the raw enum. Unifying on the explicit wording is a deliberate,
user-visible change to the Place Stock queue.

**Files:**
- Add: `fabtraq-fe/src/features/inventory/lib/placement-status.tsx` (beside `lot-labels.ts`, the existing vocabulary module)
- Modify: `fabtraq-fe/src/features/jw-challans-out/jw-challan-out-detail.page.tsx` (delete the module-local maps)
- Modify: `fabtraq-fe/src/features/jw-challans-in/jw-challan-in-detail.page.tsx:287`
- Modify: `fabtraq-fe/src/features/placements/columns.tsx` (delete its private `PlacementStatusBadge`)
- Modify: the tests and e2e specs asserting "Partial" / "Placed"

- [ ] **Step 1: Failing tests** — the JW-In detail renders "Fully placed", not `fully_placed`; the Place Stock queue renders "Fully placed", not "Placed".
- [ ] **Step 2:** add the vocabulary module exporting the label map, the variant map and a `PlacementStatusBadge`.
- [ ] **Step 3:** repoint all three sites; delete both sets of local constants. Re-grep to prove no raw render survives.
- [ ] **Step 4:** update every test/e2e assertion on the old Place Stock wording, in this commit.
- [ ] **Step 5:** full FE gate set.

---

### Task 5: FE — JW-Out page tells the receipt story (F1 symptoms a/b/c)

**Files:**
- Modify: `fabtraq-fe/src/features/jw-challans-out/jw-challan-out-detail.page.tsx`
- Modify: its integration test
- Modify: the JW-Out MSW handlers + fixtures (every fixture gains `rollup`; the MSW-schema gate enforces it)

**Interfaces:** consumes Tasks 1, 2 and 4.

- [ ] **Step 1: Failing tests, all three symptoms**
  - a fully-received item renders **no** "Close as loss" button; a pending item renders one (both branches, and both role branches per the role-gate rule);
  - the line-item status column header reads `Placement`;
  - the header renders Received / Wastage / Pending summing the items.
- [ ] **Step 2: Gate the button** on `rollup.pendingAtJW > TOLERANCE`.
- [ ] **Step 3: Rename `Status` → `Placement`** and add a right-aligned `Pending` column rendering `rollup.pendingAtJW`.
- [ ] **Step 4: Header stats** — `Received`, `Wastage`, `Pending` beside `Total Net Wt`.
- [ ] **Step 5:** full FE gate set.

---

### Task 6: FE — the receipt reconciles on screen (F3 + D1)

**Files:**
- Modify: `fabtraq-fe/src/features/jw-challans-in/jw-challan-in-detail.page.tsx` (`SourcesTable`, `YarnItemCard`)
- Modify: its integration test

- [ ] **Step 1: Failing tests** — the sources table shows a `Still at JW` column and a totals row reading Σconsumed / ΣstillAtJw / Σwastage; the item card shows the received lot's SKU with its colour swatch.
- [ ] **Step 2:** add the column and the `TableFooter` totals row, computed in the component from rows already fetched. **Display only** — the BE `superRefine` stays the sole authority on conservation; do not re-implement the rule in the FE.
- [ ] **Step 3:** add the SKU stat via `ColourSwatch` + `formatSkuDisplay`, the same pair the sources table uses. Source the name/shade from the yarn-SKU list the page already loads.
- [ ] **Step 4:** full FE gate set.

---

### Task 7: e2e — lockstep

**Files:** `e2e/tests/flows/` — the JW-Out and JW-In detail specs.

- [ ] **Step 1:** update for the renamed `Placement` column, the new `Pending` column, the conditional "Close as loss", the receipt totals row and the SKU stat.
- [ ] **Step 2:** assert the button's **absence** on a fully-received item and its **presence** on a pending one — an assertion that only ever checks presence can never go red for this bug.
- [ ] **Step 3:** stop the dev servers, `npm run e2e`, full suite green.

---

### Task 8: Release

- [ ] **Step 1:** publish `fabtraq-shared@1.27.0`; verify the published tarball's `.d.ts` exports `outItemRollupSchema`.
- [ ] **Step 2:** bump BE + FE to `^1.27.0` from the registry, `rm -rf fabtraq-fe/node_modules/.vite`, re-run both gate sets.
- [ ] **Step 3: Re-verify the original symptom, not a synthetic path.** Reopen the re-seeded `JWO-…-003` / `JWI-…-003` pair in a live browser: no "Close as loss" on a fully-received item, header states 180 / 165 / 15 / 0, receipt totals reconcile to 165, SKU visible, chip reads "Fully placed".
- [ ] **Step 4: Visual verification** — Playwright screenshots of both pages, read as a first-time user. Green tests prove nothing about looks.
- [ ] **Step 5:** push all four branches. **Never merge to main** — raise PRs.
