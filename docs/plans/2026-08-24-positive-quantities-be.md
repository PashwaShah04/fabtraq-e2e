# Positive Quantities — fabtraq-be Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Prove at the route level that zero-quantity transactions are rejected and write no ledger rows — for JW-Out and JW-In.

**Architecture:** **No production code change** (spec §3.4). BE parses every request body through the shared schemas before the service sees it, so tightening the schema tightens BE. Deliberately no second hand-rolled floor in the service: duplicated validation drifts, which is the failure mode this spec exists to remove.

**Global Constraints:**
- **Shared resolution:** spec §4 / D4 defers the bump, so install the locally-built tarball from `worktrees/raw-yarn-sizing-shared` first.
- **`npm run test:integration` TRUNCATES `fabtraq_dev`.** Dev servers may be running against it — STOP them and TELL THE USER before running; re-seed afterwards.
- `tsx` does not auto-load `.env` in these worktrees: use `set -a && . ./.env && set +a` before `npm run dev`.
- Commit locally. **Do NOT push.**
- Worktree: `worktrees/raw-yarn-sizing-be`, branch `feat/raw-yarn-sizing-be`.

---

## Verify commands

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-be
npx vitest run --config vitest.integration.config.ts tests/integration/jw-challan-out.routes.test.ts
npm run lint && npx tsc --noEmit && npm run build
npm run test:integration        # wipes fabtraq_dev — stop servers, warn user, re-seed after
```

---

## Task 0: Install the unpublished shared build

```bash
cd ../raw-yarn-sizing-shared && npm run build && npm pack
cd ../raw-yarn-sizing-be && npm install --no-save ../raw-yarn-sizing-shared/pashwashah04-fabtraq-shared-1.21.0.tgz
node -e "const s=require('@pashwashah04/fabtraq-shared');console.log(s.createJwChallanOutItemSchema.safeParse({netWeight:0}).success)"
```

Expect `false`. Confirm `git status` is clean of `package.json`/lockfile changes from `--no-save`.

---

## Task 1: JW-Out route rejects zero, writes nothing

**Files:** `tests/integration/jw-challan-out.routes.test.ts`. No `src/` change.

Append to the `POST /jw-challans-out` describe. Each case owns its lot number and transaction id.

1. **`rejects a zero-netWeight item and writes no ledger rows (JWO-2026-27-015 shape)`** — seed a raw lot; POST with `netWeight: 0`, `grossWeight: 10`, `placements: []`. Expect **422**. Assert zero `stock_ledger` rows for that lot AND zero `jw_challans_out` rows created — a rejection that still persisted a header is the bug in a different costume.
2. **`rejects an item with no placements`** — positive `netWeight`, `placements: []` → 422.
3. **`rejects gross weight below net weight`** — `netWeight: 10, grossWeight: 9` → 422.
4. **Positive control: `accepts a normal positive item`** — `netWeight: 12` with one matching placement → 201, ledger row written with `out_quantity = 12`. Without this the suite could pass by rejecting everything.

**Step 2 — run before Task 0's tarball is applied** to confirm cases 1-3 return 201 against published shared, proving they exercise the new guards rather than passing vacuously. Then apply Task 0 and re-run.

**Commit:** `test(jw-out): zero-quantity and gross<net challans are rejected and write nothing (spec 2026-08-24 §5)`

---

## Task 2: JW-In route rejects zero

**Files:** `tests/integration/jw-challan-in*.routes.test.ts` (pick the file matching the existing create-path tests). No `src/` change.

1. `netWeight: 0` on a yarn item → 422, zero ledger rows, zero challan rows.
2. A source with `consumedQty: 0` → 422 (D1).
3. **Regression:** a source with `wastage: 0` and `stillAtJwQty: 0` but positive `consumedQty` → **201**. These fields keep accepting zero; this is the case that catches over-tightening.

**Commit:** `test(jw-in): zero netWeight and zero consumedQty rejected; zero wastage still accepted (spec 2026-08-24 §5, D1)`

---

## Task 3: Full gates

Stop dev servers, warn the user, then:

```bash
npm run lint && npx tsc --noEmit && npm run build && npm run test:integration
```

Expect green except the pre-existing `design-parse` failure, which hard-codes `../../../beam-designs/gr=17545-b.pdf` and breaks in any worktree — unrelated, do not fix. Re-seed `fabtraq_dev` afterwards and tell the user.

---

## Task 4: Mirror docs

Copy spec + four plans byte-for-byte from the repo-root `docs/`. Two prettier passes needed in this repo if run at all; `*.md` is ignored on purpose.

**Commit:** `docs: positive-quantities design spec + plans`

---

## Self-review against spec

- [ ] `git diff main --stat -- src` is empty.
- [ ] Every rejection case asserts BOTH 422 and zero rows persisted.
- [ ] Every group has a positive control.
- [ ] Non-vacuity shown by running against published shared first.
- [ ] `fabtraq_dev` re-seeded, user warned.
