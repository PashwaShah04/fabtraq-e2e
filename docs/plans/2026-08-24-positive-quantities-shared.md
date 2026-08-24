# Positive Quantities — fabtraq-shared Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add `positiveQuantitySchema`, adopt it on the seven fields where 0 is nonsense, make outbound `placements` non-empty, and add the `grossWeight ≥ netWeight` rule — per spec §3.

**Architecture:** One new primitive plus field-level adoption. No response shape changes, no new schemas, no registry changes. The fix lands on `createJwChallanOutItemSchema`, which `weaving-dispatch.ts:47` reuses — so the weft path is covered without touching weaving-dispatch (spec §1.2).

**Global Constraints:**
- **Do NOT bump `package.json` and do NOT add a CHANGELOG release section** (spec §4 / D4). `1.21.0` stays.
- **Do NOT touch `quantitySchema` itself** — spec §3.1 explains why inverting it breaks `remainingQty` and every response field.
- No `.js` extensions in relative imports. Node 22. Strict TS, no `any`.
- Commit locally after every task. **Do NOT push.**
- Worktree: `worktrees/raw-yarn-sizing-shared`, branch `feat/raw-yarn-sizing-shared` (stacked on the sizing work, per D3).

---

## Verify commands (every task)

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-shared
npx vitest run <test-file>     # fast loop
npm run verify                  # lint --max-warnings 0 && tsc --noEmit && vitest run && tsup
```

---

## Task 1: `positiveQuantitySchema` primitive

**Files:** Modify `src/primitives/money.ts`; test `tests/primitives/money.test.ts` (create if absent). Export from the package index alongside `quantitySchema`.

**Step 1 — failing tests:** 0 rejected; negative rejected; 0.0001 accepted; `QUANTITY_MAX` accepted; above max rejected; rounds to 3dp. Plus a regression case asserting `quantitySchema` still accepts 0 — this task must not change it.

**Step 2 — implement:** exactly the snippet in spec §3.1, `.gt(0)` with message `'Quantity must be greater than zero.'`, same `.brand<'Quantity'>()` so it stays assignable wherever `Quantity` is expected.

**Step 3 — verify:** `npm run verify`.

**Commit:** `feat(primitives): add positiveQuantitySchema for quantities that must move something (spec 2026-08-24 §3.1)`

---

## Task 2: Adopt on JW-Out + the outbound placements guard

**Files:** `src/schemas/transaction/jw-challan-out.ts`; tests `tests/schemas/transaction/jw-challan-out.test.ts`.

**Step 1 — failing tests:**
- `netWeight: 0` → rejected (path `['netWeight']`).
- `netWeight: -5` → rejected.
- `placements: []` with positive netWeight → rejected on path `['placements']`, **not** on `netWeight` — this is the distinct-rule assertion from spec §3.2.
- Positive control: valid item with `netWeight: 12` and one placement of 12 → accepted. Without this the suite could pass by rejecting everything.
- **The JWO-2026-27-015 shape exactly**: `netWeight: 0, grossWeight: 10, placements: []` → rejected. Name the test after the challan.

**Step 2 — implement:** line 69 `netWeight: positiveQuantitySchema`; line 80 `placements: placementInputSchema.array().min(1, 'At least one placement is required — outbound stock must be pulled from a floor.')`.

**Step 3 — verify.**

**Commit:** `fix(jw-challan-out): require positive netWeight and at least one placement (spec 2026-08-24 §3.1, §3.2)`

---

## Task 3: `grossWeight ≥ netWeight` refinement

**Files:** `src/schemas/transaction/jw-challan-out.ts` (add to the existing `superRefine`); tests as above.

**Step 1 — failing tests, one per boundary in spec §3.3:**
- gross absent → accepted.
- `grossWeight: 0` with `netWeight: 10` → accepted ("not weighed").
- `grossWeight === netWeight` → accepted.
- `grossWeight: 9, netWeight: 10` → rejected, path `['grossWeight']`.
- `grossWeight: 10.0005, netWeight: 10.001` → accepted (inside `CONSERVATION_TOLERANCE_KG`).

**Step 2 — implement:** extend the existing `superRefine` body (do not add a second one — one refine block, two independent checks, each with its own `addIssue`). Skip when `grossWeight` is `undefined` or `=== 0`. Use `CONSERVATION_TOLERANCE_KG`.

**Step 3 — verify.**

**Commit:** `fix(jw-challan-out): reject gross weight below net weight (spec 2026-08-24 §3.3)`

---

## Task 4: Adopt on JW-In

**Files:** `src/schemas/transaction/jw-challan-in.ts`; tests `tests/schemas/transaction/jw-challan-in.test.ts`.

**Step 1 — failing tests:**
- item `netWeight: 0` → rejected.
- source `consumedQty: 0` → rejected (D1).
- Positive control accepted.
- **Regression, critical:** a source with `wastage: 0` and `stillAtJwQty: 0` and positive `consumedQty` → still accepted. These two fields keep `quantitySchema` and must keep accepting 0 (spec §3.1).

**Step 2 — implement:** line 49 `consumedQty: positiveQuantitySchema`; line 119 `netWeight: positiveQuantitySchema`. Touch nothing else — the `allWastageExplicit` skip is out of scope (spec §6) and must be left exactly as-is.

**Step 3 — verify.**

**Commit:** `fix(jw-challan-in): require positive netWeight and consumedQty (spec 2026-08-24 §3.1, D1)`

---

## Task 5: Adopt on yarn-purchase and weaving-in/fabric-taka

**Files:** `src/schemas/transaction/yarn-purchase.ts` (line 53 `quantity`); `src/schemas/transaction/weaving-in.ts` (line 52 `meters`, line 53 `weightKg`, line 42 `metersAttributed`). Tests in the matching test files.

**Step 1 — failing tests:** 0 rejected + positive control, for each of the four fields. For fabric-taka include the JWO-015-shaped case: `meters: 0, weightKg: 10` → rejected.

**Step 2 — implement:** swap to `positiveQuantitySchema`. **Do not touch** `weaving-in.ts:126` `enteredWeftKg` or the `weftSources` array — 0 and empty are deliberate there (spec §1.2, §6).

**Step 3 — verify.**

**Commit:** `fix(yarn-purchase,weaving-in): require positive quantities (spec 2026-08-24 §3.1, D2)`

---

## Task 6: Full-surface regression sweep

**Files:** none modified — verification only.

Run `npm run verify` and read every failure. Any test that breaks is a real call site that was relying on zero: triage each rather than loosening the guard. Then grep for remaining bare `quantitySchema` uses in **create/update input** schemas and confirm each surviving one is on the spec §1.2 "0 is legitimate" list:

```bash
grep -rn "quantitySchema" src/schemas --include=*.ts | grep -v positiveQuantitySchema
```

Anything not on that list → stop and report; the spec's audit is then incomplete.

**Commit:** only if a finding requires a fix.

---

## Task 7: Mirror docs

Copy the spec and the four plans byte-for-byte from the repo-root `docs/` tree into `docs/`. Prettier ignores `*.md` on purpose — do not reformat.

**Commit:** `docs: positive-quantities design spec + plans`

---

## Self-review against spec

- [ ] `package.json` still `1.21.0`; no CHANGELOG section.
- [ ] `quantitySchema` byte-unchanged; `remainingQty` still parses 0.
- [ ] `wastage` / `stillAtJwQty` still accept 0, with tests proving it.
- [ ] Every new guard has a positive control alongside the rejection case.
- [ ] `enteredWeftKg`, `weftSources`, and the print-fields patch schema untouched.
- [ ] A test named for JWO-2026-27-015 reproduces its exact shape and rejects it.
