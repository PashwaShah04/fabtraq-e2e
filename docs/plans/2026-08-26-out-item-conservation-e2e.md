# Plan — out-item conservation (e2e)

**Spec:** `docs/brainstorms/2026-08-26-out-item-conservation.md`
**Branch:** `fix/out-item-conservation-e2e`, worktree `worktrees/out-item-conservation-e2e`,
**based on `master`** (`42f3011`). This repo has **no `main`** — `master` is its default.

Ships **in lockstep** with the BE change, in the same push. A BE guard with no live spec exercising
it is how the last four of these slipped through.

---

## Scope

Two specs, both driving the real UI against the real backend. The BE integration tests in T3/T4/T6
already cover the API contract — these exist to prove the **operator cannot do it through the
screen**, and that the rejection is *visible* when they try.

### E1 — Sequential beam receipts cannot exceed the dispatch

Reproduces the original defect end to end:

1. Seed a sizing JW-Out of a known weight (mirror `JWO-2026-27-024`: 10 KG, one lot).
2. Book a beam receipt of 4 KG → accepted.
3. Book a second of 9 KG → **rejected**.
4. Assert the rejection is rendered in a visible slot with a message naming what already consumed
   the yarn — not swallowed, not a bare 400, not a toast that has already dismissed itself.
5. Assert the eligible-out-item picker now shows `remaining = 6`, not `10`.

Step 5 is the one that matters most: the picker lying is what made the over-issue easy.

### E2 — Cross-consumer conservation

A beam receipt, then a JW-In receipt against the same out-item that would exceed the dispatch →
rejected. This is the direction a beam-only fix would miss.

---

## Rules for this repo

- **Own your fixtures.** Do not reach for "the first active" weaver, lot, or out-item — a shared
  fixture is how specs start failing each other. Seed what each spec needs.
- `fabtraq-pdf-parser` must be running; `playwright.config` boots it. A down parser looks like an
  unrelated regression.
- A single-spec run needs the dev servers stopped. A full `npm run e2e` **wipes `fabtraq_dev`** —
  snapshot at `db-snapshots/fabtraq_dev-2026-08-26-pre-conservation-fix.dump` holds the live
  reproduction; restore and re-seed afterwards.
- If the BE change alters an error shape or a selector, update the spec in the **same commit** as
  the BE change, not afterwards.

## Gate bar

Full suite green live (not just the two new specs), on the same servers the BE branch is running.
Both new specs demonstrated **red** against `master`'s backend first — if E1 passes before the fix,
it is not testing the fix.

## Verification the plan is not finished without

Restore the snapshot, open the real UI, and attempt a fourth beam receipt against
`LOT-260825-0018`. It must be refused, with a message an operator can act on. Screenshot it.
Green tests prove nothing about what the operator actually sees.
