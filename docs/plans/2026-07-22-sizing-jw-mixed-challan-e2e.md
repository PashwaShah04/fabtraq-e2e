# Sizing-JW Mixed-Challan — E2E Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Net-new live test: one sizing_jw beam receipt mixing beams from two different OUT challans — create, provenance display, per-challan status rollup, ledger drain, cancel.

**Architecture:** Per spec §5 (`fabtraq-fe/docs/specs/2026-07-22-sizing-jw-mixed-challan-design.md` — READ FIRST). NO existing sizing_jw create-flow test exists — this is fresh authorship in `tests/flows/beam-receipt.spec.ts`, following that file's in_house test and `jw-in-yarn.spec.ts` / `stock-transfer.spec.ts` patterns (fixtures `../../fixtures/test` with `db`; helpers in `../../support/{nav,forms,assert}`).

**Tech Stack:** Playwright. Branch: `master` (current checkout). Prereq: fabtraq-be + fabtraq-fe changes from their plans are implemented and dev-DB is seeded.

## Global Constraints

- Full `npm run e2e` WIPES fabtraq_dev — run ONLY the single spec, with dev servers STOPPED first (the e2e webServer config manages them); re-seed + warn after any full run.
- Creds: owner@fabtraq.local / Fabtraq#2026 (committed test fixtures).
- Assert inventory impact against `stock_ledger`, never `/inventory` (house rule).
- Commit locally; NEVER push.

---

### Task 1: Mixed-challan sizing_jw flow test

**Files:**
- Modify: `tests/flows/beam-receipt.spec.ts` (append a second `test(...)`)

**Test skeleton (adapt selectors from the live FE — verify with a headed run or the FE integration tests' selector contract):**

- [ ] **Step 1: Author the test:**

```ts
test('sizing_jw beam receipt mixes beams from two OUT challans', async ({ page, db }) => {
  // 1. Create TWO sizing OUT challans via the UI (pattern: existing jw-challan-out
  //    creation flow in this suite), each with one item from a seeded floor lot,
  //    capturing challanNo A and B via captureDocNo.
  // 2. /beam-receipts/new → origin "Sizing JW".
  //    ASSERT: no "Challan Out ID" input exists anywhere on the page:
  //    await expect(page.getByLabel('Challan Out ID')).toHaveCount(0);
  // 3. Beam row 1: beam number, net weight; per-row "Pick eligible out item"
  //    → choose the item from challan A. Add row 2 → choose the item from challan B.
  // 4. Save; captureDocNo BRC number; expectToast success.
  // 5. Detail page: both challan numbers visible on the beam item cards
  //    (label "OUT Challan"; values = challanNo A and challanNo B).
  // 6. DB assertions:
  //    - stock_ledger: one row per beam with transaction_type='beam_receipt'
  //      draining the at-JW position of the matching out item.
  //    - jw_challans_out status for A and B both updated (fully/partially
  //      received per the entered weights).
  // 7. Cancel the receipt (detail page action). Assert ledger reversal rows
  //    exist and both challans are back to 'sent'.
});
```

- [ ] **Step 2: Stop dev servers** (kill npm-run-dev parents AND tsx-watch/vite children on :4000/:5173).
- [ ] **Step 3: Run single spec live:** `npx playwright test tests/flows/beam-receipt.spec.ts` → both tests (in_house + new sizing) PASS.
- [ ] **Step 4: Commit:** `git add -A && git commit -m "test(beam-receipt): sizing_jw mixed-challan flow — create, provenance, rollup, cancel"`
- [ ] **Step 5: Restart dev servers; re-seed fabtraq_dev if the run wiped it** (webServer resets DB — check and `npx prisma db seed` in fabtraq-be if needed).
