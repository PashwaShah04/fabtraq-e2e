# Plan — out-item conservation (fabtraq-fe)

**Spec:** `docs/brainstorms/2026-08-26-out-item-conservation.md`
**Branch:** `fix/out-item-conservation-fe`, worktree `worktrees/out-item-conservation-fe`,
**based on `main`** (`6da7b2b`).

Small scope, but **not zero** — the spec's original assumption ("no FE change expected") was checked
and is wrong. Recorded here rather than silently dropped.

---

## Why FE is in scope

`BusinessRuleError` carries `httpStatus = 422` (`fabtraq-shared/src/errors/app-error.ts:114`).
The beam-receipt form's `onError` handles `400` (field mapping) and `409` (refetch + toast), then
falls through to a bare destructive toast for everything else
(`beam-receipt-form.page.tsx:281-294`).

So a `CONSERVATION_VIOLATION` today lands as a **transient toast with no field anchor**, on a long
grid form where the operator cannot see which row was at fault. Given the standing rule that a new
error path needs a verified visible slot — and this repo's own history of toasts colliding with the
save bar — that is not an acceptable landing spot for the guard this workstream exists to add.

`stock-transfer-form.page.tsx:164` already does the right thing for the analogous 422 balance guard.
Follow that pattern; do not invent a second one.

## T1 — Anchor the conservation error

- Handle `422` + `code === 'BUSINESS_RULE_VIOLATION'` + `details.code === 'CONSERVATION_VIOLATION'`
  in the beam-receipt form's `onError`.
- Map it to a co-located `<FieldError>` on the offending source row, using `details.outItemId` to
  find it. Keep the toast as well — the field error says *where*, the toast says *what*.
- The message must name what already consumed the yarn, using the `byConsumer` breakdown the BE
  guard now returns. "Conservation violation" alone tells an operator nothing; "6 KG of this
  dispatch is already in beams BRC-…-005" tells them what to do.
- Invalidate `beamReceiptKeys.eligibleOutItems()` on this error the way the `409` branch does, so
  the picker's `remainingQty` refreshes to the corrected value instead of continuing to show the
  stale one.

That last point matters: the BE fix makes `remainingQty` correct, but a cached query will keep
showing the old number until something invalidates it.

## T2 — Same treatment for the JW-In form

The BE fix makes the JW-In guard reject cross-consumer over-consumption (spec S2). That error will
land on the JW-In form, which has the same fall-through shape. Give it the same anchored slot.

**Do not skip this because the ticket started with beam receipts.** Shipping the guard on both paths
and the visible error on only one is how the second one gets reported as a new bug next month.

## Gate bar

`lint` (`--max-warnings 0`) · `typecheck` · `test` · `build` · coverage (80/75/80) ·
`format:check`.

Plus this repo's specific bars:
- `assertFieldErrorRegions` covers every new `<FieldError>`.
- Integration test per error path, driven through MSW with a realistic 422 envelope.
- **MSW handlers must match the live backend.** A mock that returns a shape the BE never sends is
  exactly how the last contract drift slipped past green tests. Validate the fixture against a real
  422 from the running BE branch.

## Visual verification — required, not optional

Live Playwright screenshot of both anchored errors as a first-time user would see them. Green tests
prove nothing about whether the operator can find the message. Confirm the toast does not collide
with the save bar on the beam-receipt grid.

## Shared

**No `@fabtraq/shared` change.** The error code and `httpStatus` already exist and are unchanged;
only `details` gains a `byConsumer` field, which is untyped passthrough. No bump means no publish,
no lockfile sync, and no vite dep-cache clearing. Confirmed by inspection, not assumed.
