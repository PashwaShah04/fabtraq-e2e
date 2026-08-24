# Direct Raw-Yarn → Sizing — e2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** One live spec proving the whole new chain: an own-fixture raw lot → a sizing JW-Challan-Out with **no warping leg** → a `sizing_jw` beam receipt that mints a `Beam` row and drains the at-JW position.

**Architecture:** New test case in `tests/flows/beam-receipt.spec.ts`, alongside the existing `'sizing_jw beam receipt mixes beams from two OUT challans'` case. That existing case builds a raw → warping-OUT → warping-IN → sizing-OUT chain and **stays exactly as it is** — it is the regression guard proving the classic warped-lot path still works. The new case is the same chain with the warping legs deleted.

**Global Constraints:**
- **Specs own their fixtures.** Do not reuse "first active" job worker / lot /
  floor with any other spec. Pick a job worker this case does not share, and
  mint its own lot number.
- **Shared resolution:** spec §4 / D3 defers the version bump, so BE must be
  running against the locally-installed shared tarball (see the BE plan Task 0)
  or this spec fails at the JW-Out step with a 422. State this in the spec's
  header comment.
- `e2e` requires `fabtraq-pdf-parser` running — `playwright.config` boots it.
- A single-spec run needs the dev servers stopped. A full `npm run e2e` **wipes
  the dev DB** — re-seed and warn the user afterwards.
- Commit locally. **Do NOT push.**
- Worktree: `/home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-e2e`, branch `feat/raw-yarn-sizing-e2e`, based on `master`.

---

## Verify commands

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-e2e
npx playwright test tests/flows/beam-receipt.spec.ts    # single spec — stop dev servers first
npm run e2e                                              # full suite — wipes dev DB
```

---

## Task 1: Live spec — raw lot straight to sizing, then beam receipt

**Files:**
- Modify: `tests/flows/beam-receipt.spec.ts`

**Step 1: Write the header comment**

Above the new `test(...)`, state plainly what the case proves and what it
depends on:

- Spec ref: `docs/superpowers/specs/2026-08-24-raw-yarn-sizing-design.md` §3, §5.
- That `isValidInputState`'s `sizing` case no longer requires `warping`
  (`fabtraq-shared/src/primitives/job-work.ts`), so the chain has **no warping
  leg at all** — this is not an unrecorded warping step (spec D2).
- That it requires the unpublished shared build (spec §4 / D3); against
  published `1.21.0` the JW-Out step returns 422 `INVALID_SOURCE_STATE`.
- That it owns its own job worker and lot, per the fixture-ownership rule.

**Step 2: Build the chain**

1. **Own fixtures.** Query a job worker this spec does not share with the
   mixed-challan case above it (that one takes `ORDER BY code LIMIT 1` and
   `OFFSET 1` — take a distinct one, and assert it is distinct rather than
   assuming the ordering holds). Mint a fresh unique lot number.
2. **Raw lot on a floor.** Create the raw stock the same way this file's
   existing cases create their starting stock, with `processedTypes = []` —
   no warping OUT, no warping IN. Assert via `db` that the lot's latest ledger
   row carries an empty `processedTypes`; this is the assertion that makes the
   test non-vacuous.
3. **Sizing JW-Challan-Out.** Drive the UI: New JW Challan Out → tick
   **Sizing** only → open the source-lot picker → **assert the raw lot is
   visible in the picker** (the FE half of the change) → select it, place the
   full quantity, save. Assert a 201-equivalent (the detail page renders, an
   entry-no heading is visible).
4. **Beam receipt, `sizing_jw` origin.** New Beam Receipt → sizing-JW origin →
   per-row `EligibleOutItemPicker` → assert the sizing OUT item from step 3
   appears → select it, fill the beam fields, save.

**Step 3: Assert the outcome — against the ledger, not the summary view**

- A `beams` row exists for the receipt item, `status = 'received'`.
- A `stock_ledger` row with `transaction_type = 'beam_receipt'` drains the
  at-JW position keyed on that sizing OUT item's own lot number and job worker
  (`floor_id`/`location_id` null), matching the pattern the mixed-challan case
  already asserts.
- Fresh navigation to `/beam-receipts/:id` renders the entry-no heading —
  server state, not client-side post-save state.

**Step 4: Run it live**

```bash
# stop dev servers first
npx playwright test tests/flows/beam-receipt.spec.ts
```

Both cases in the file green — the new one and the existing warping-first one.
Then the full suite:

```bash
npm run e2e     # wipes dev DB
```

Re-seed `fabtraq_dev` afterwards and warn the user. Record the pass count.

**Step 5: Commit**

```bash
git add tests/flows/beam-receipt.spec.ts
git commit -m "test(e2e): raw lot straight to sizing, no warping leg, through to beam receipt (spec 2026-08-24 §5)"
```

---

## Task 2: Mirror docs

Copy the spec, the four plans and the amended
`docs/brainstorms/2026-05-19-jw-domain-redesign.md` byte-for-byte from the
repo-root `docs/` tree into `e2e/docs/`.

```bash
git add docs
git commit -m "docs: raw-yarn-sizing design spec + plans, amend L18 sizing predicate row"
```

---

## Self-review against spec

- [ ] The new case builds **no** warping OUT and **no** warping IN.
- [ ] It asserts the source lot's `processedTypes` is empty before the sizing OUT — otherwise the test could pass on a warped lot and prove nothing.
- [ ] It asserts the raw lot is *visible in the picker*, not just that the POST succeeded.
- [ ] Its job worker and lot are its own; distinctness asserted, not assumed.
- [ ] The existing mixed-challan case is byte-unchanged.
- [ ] Inventory impact asserted against `stock_ledger`, not `/inventory`.
- [ ] Full suite re-run live; dev DB re-seeded and the user warned.
