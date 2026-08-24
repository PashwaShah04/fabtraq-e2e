# Direct Raw-Yarn → Sizing — fabtraq-be Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Prove, with an integration test against the real route and the real ledger, that a sizing JW-Challan-Out raised off a raw lot is accepted end-to-end — and that the guards that must still bite (double-sizing, post-weaving) still do.

**Architecture:** **No production code change.** `assertLotInputStates`
(`src/modules/jw-challan-out/jw-challan-out.service.ts:501-534`) delegates the whole
rule to the shared `isValidInputState` primitive; relaxing the primitive relaxes BE.
This plan exists to pin that behaviour with tests, not to modify the service.

**Tech Stack:** TypeScript, Express, Prisma, Vitest, supertest.

**Global Constraints:**
- **Shared resolution:** spec §4 / D3 defers the shared version bump, so the
  published `1.21.0` still carries the OLD predicate. Before running the new
  test, install the locally-built shared tarball from the
  `raw-yarn-sizing-shared` worktree. Record in the commit message that the test
  requires the unpublished shared build.
- **`npm run test:integration` TRUNCATES the live `fabtraq_dev` database** that
  the dev server uses. Stop dev servers first; re-seed afterwards and tell the
  user.
- Commit locally after every task. **Do NOT push.**
- Worktree: `/home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-be`, branch `feat/raw-yarn-sizing-be`, based on `main`.

---

## Verify commands (every task)

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-be
npx vitest run tests/integration/jw-challan-out.routes.test.ts   # fast loop
npm run lint && npx tsc --noEmit && npm run build
npm run test:integration                                          # full gate — wipes fabtraq_dev
```

---

## Task 0: Install the unpublished shared build

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-shared
npm run build && npm pack          # produces pashwashah04-fabtraq-shared-1.21.0.tgz
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-be
npm install --no-save ../raw-yarn-sizing-shared/pashwashah04-fabtraq-shared-1.21.0.tgz
```

**Verify:** `grep -n "case 'sizing'" node_modules/@pashwashah04/fabtraq-shared/dist/*.js`
(or the `.d.ts` + bundled source) shows the relaxed predicate. Do NOT commit
`package.json`/lockfile changes from the `--no-save` install — confirm
`git status` is clean of them.

---

## Task 1: Integration test — sizing JW-Out off a raw lot is accepted

**Files:**
- Test: `tests/integration/jw-challan-out.routes.test.ts` (new cases appended alongside the existing `INVALID_SOURCE_STATE` case at line ~941)
- Modify: none

**Interfaces:**
- Consumes: the existing `POST /jw-challans-out` route, the existing masters/session helpers already used in this file, and the file's existing `prisma.stockLedger.create` fixture pattern (see the twisted-lot case at lines ~890-915).
- Produces: no new exports.

**Step 1: Write the failing tests**

Append three cases to the same `describe` that holds the existing
`INVALID_SOURCE_STATE` test. Each **owns its own lot number** — do not reuse
`twistedLotNumber` or any other test's fixture.

1. **`sizing JW-Out off a raw lot is accepted (spec 2026-08-24 §3)`**
   - Seed one `stockLedger` row with `processedTypes: []`, `inQuantity: 80`,
     `balanceAfter: 80`, a fresh unique `lotNumber`, on `masters.locationId` /
     `masters.floorId`.
   - `POST /jw-challans-out` with `jobWorkTypes: ['sizing']`, one item sourcing
     that lot for `netWeight: 50` with a matching single placement of 50.
   - Expect **201**.
   - Assert a `stockLedger` row exists for that `lotNumber` with
     `transactionType: 'challan_out'` and `outQuantity: 50` — i.e. the ledger
     leg was actually written, not just the header persisted.

2. **`sizing JW-Out off an already-sized lot is still rejected`**
   - Seed a lot with `processedTypes: ['sizing']`.
   - Same POST shape with `jobWorkTypes: ['sizing']`.
   - Expect **422**, `body.code === 'BUSINESS_RULE_VIOLATION'`,
     `body.details.code === 'INVALID_SOURCE_STATE'`.
   - Assert **zero** `challan_out` ledger rows for that lot.

3. **`sizing JW-Out off a woven lot is still rejected`**
   - Same as (2) but `processedTypes: ['weaving']`.

**Step 2: Run to see it fail**

Run the fast loop with Task 0 **not yet applied** (i.e. against published
shared) to confirm case (1) fails with 422 / `INVALID_SOURCE_STATE` — this
proves the test actually exercises the predicate rather than passing vacuously.
Then apply Task 0.

**Step 3: Implement**

No production change. If any case still fails after Task 0, the failure is real
— stop and diagnose; do not adjust the service.

**Step 4: Run to see it pass**

```bash
npx vitest run tests/integration/jw-challan-out.routes.test.ts
npm run lint && npx tsc --noEmit && npm run build
npm run test:integration       # stop dev servers first; re-seed after
```

All green, 0 failures. Re-seed `fabtraq_dev` and warn the user.

**Step 5: Commit**

```bash
git add tests/integration/jw-challan-out.routes.test.ts
git commit -m "test(jw-out): sizing challan off a raw lot is accepted; double-sizing and post-weaving still rejected (spec 2026-08-24 §5)

Requires the unpublished fabtraq-shared build carrying the relaxed sizing
predicate; the published 1.21.0 still rejects raw-lot sizing (spec §4 / D3)."
```

---

## Task 2: Confirm no other BE path assumes sized-implies-warped

**Files:** none modified — this is a verification task whose output is a note in the commit message if anything is found.

Run and read:

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-be
grep -rn "'warping'" --include=*.ts src | grep -v "\.test\."
```

Expected: only `src/modules/inventory/prisma-inventory.service.ts:1107,1128`
(`BEAM_TRACK_TYPES`), which routes on the OUT **challan's declared**
`jobWorkTypes`, not on source-lot `processedTypes` — a raw→sizing challan
declares `sizing`, so it is still correctly excluded from the yarn picker and
included in the beam picker. No change needed.

If the grep returns anything else, **stop** and report it rather than patching
— spec §1.2 asserts this set is complete, and a new hit means the spec is wrong.

**Commit:** nothing to commit unless a finding requires a fix.

---

## Task 3: Mirror docs

Copy the spec, the four plans and the amended
`docs/brainstorms/2026-05-19-jw-domain-redesign.md` byte-for-byte from the repo-root
`docs/` tree into `fabtraq-be/docs/`. Prettier ignores `*.md` here on purpose —
do not reformat. Note this repo needs two prettier passes if you run it at all.

```bash
git add docs
git commit -m "docs: raw-yarn-sizing design spec + plans, amend L18 sizing predicate row"
```

---

## Self-review against spec

- [ ] `src/` is untouched — `git diff main --stat -- src` is empty.
- [ ] The new accept-case asserts a ledger row, not just the 201.
- [ ] Both reject-cases assert zero `challan_out` ledger rows.
- [ ] Each new case owns its own lot number.
- [ ] `package.json` / lockfile unchanged by the `--no-save` tarball install.
- [ ] `fabtraq_dev` re-seeded and the user warned.
