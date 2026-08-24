# Positive Quantities — e2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** One live negative spec proving the JWO-2026-27-015 shape is refused end-to-end and leaves no row behind.

**Architecture:** New case in `tests/flows/jw-out.spec.ts` alongside the existing JW-Out state-machine cases. Negative specs are cheap to write and easy to write vacuously — this one asserts the SPECIFIC visible error and a zero row count, never just "save didn't navigate".

**Global Constraints:**
- **Specs own their fixtures** — own lot, own job worker, distinctness asserted not assumed.
- **Shared resolution:** BE/FE must run the local tarball build (BE plan Task 0), else the form accepts 0 and this spec fails for the wrong reason. State this in the spec header comment.
- `E2E_BE_DIR` / `E2E_FE_DIR` / `E2E_PARSER_DIR` must point at the worktrees; BE needs `set -a && . ./.env && set +a`; FE worktree needs its own `.env`.
- A full `npm run e2e` wipes the dev DB — re-seed and warn the user.
- Commit locally. **Do NOT push.**
- Worktree: `worktrees/raw-yarn-sizing-e2e`, branch `feat/raw-yarn-sizing-e2e`.

---

## Task 1: Live negative spec

**Files:** `tests/flows/jw-out.spec.ts`.

**Header comment** must state: spec ref (§3, §5), that it reproduces JWO-2026-27-015's exact shape, and that it requires the unpublished shared build.

**Body:**

1. Own fixtures: a raw lot with balance, a job worker not shared with other cases in the file.
2. Record the `jw_challans_out` row count BEFORE.
3. Drive `/jw-challans-out/new`: pick job worker, a job-work type, quality, SKU, source lot. Enter **net weight 0** and **gross weight 10**. Add no placement. Click Save.
4. Assert a **visible** validation message appears (the FE-plan Task 3 slot), and the URL stays on `/new` — no navigation to a detail page.
5. Assert the `jw_challans_out` count is **unchanged**, and no `stock_ledger` row exists for that lot with `transaction_type = 'challan_out'`. This is the assertion that makes the case non-vacuous: a spec that only checks the toast would pass even if the row were written.
6. **Positive control in the same spec:** correct the form to net weight 10 with one placement of 10, Save, assert it now succeeds and the count increments by exactly 1. This proves the form is usable and the guard is not blocking everything.

**Run live:**

```bash
# stop dev servers first
set -a && . ../raw-yarn-sizing-be/.env && set +a
E2E_BE_DIR=../raw-yarn-sizing-be E2E_FE_DIR=../raw-yarn-sizing-fe \
E2E_PARSER_DIR=../../fabtraq-pdf-parser \
npx playwright test tests/flows/jw-out.spec.ts --reporter=line
```

Then the full suite, re-seed, warn the user, record the pass count.

**Commit:** `test(e2e): zero-quantity JW-Out is refused and leaves no row (spec 2026-08-24 §5)`

---

## Task 2: Mirror docs

Copy spec + four plans byte-for-byte from the repo-root `docs/` into `docs/`. This repo does NOT carry the 2026-05-19 brainstorm — do not add files it does not already mirror.

**Commit:** `docs: positive-quantities design spec + plans`

---

## Self-review against spec

- [ ] Asserts a visible error, not just absence of navigation.
- [ ] Asserts row count unchanged AND no ledger row.
- [ ] Has a positive control that succeeds in the same spec.
- [ ] Owns its fixtures; distinctness asserted.
- [ ] Full suite re-run live; DB re-seeded; user warned.
