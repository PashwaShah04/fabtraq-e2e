# Plan — beam cancellation gaps (fabtraq-be)

**Spec:** `docs/brainstorms/2026-08-26-beam-cancel-gaps.md`
**Branch:** `fix/beam-cancel-gaps-be`, stacked on `fix/out-item-conservation-be` (`9d4e3dd`).
**Depends on:** shared `1.22.0` (plan S1/S2) for the `cancelled` field.

Read the spec first. §B-038b (purchase-origin receipts write **no** ledger rows, so the existing
`hasReversalRows` guard is structurally dead for them) is the load-bearing fact.

---

## Ground rules

- One task per sub-agent. Each ends with `lint` + `typecheck` + `test` + `build` + coverage green
  before the next is dispatched.
- TDD: every task writes its test first and **demonstrates it red**. A regression test that was
  never red is not a regression test.
- Integration tests truncate the DB — run them against `fabtraq_test` via a `DATABASE_URL`
  override, never inherit the dev `.env`, then `db:reset`.
- Commit per task locally. Push at the end, on the user's go. **Never merge to main — raise a PR.**

---

## B1 — Migration: drop the two beam-number unique constraints

`prisma/schema.prisma`:

- `BeamReceiptItem.beamNumber`: drop `@unique`, add `@@index([beamNumber])`.
- `Beam.beamNumber`: drop `@unique`, add `@@index([beamNumber])`.
- Comment on both explaining *why* (a cancelled receipt releases its numbers; enforcement moved
  to `BeamReceiptService`) — without it the next reader re-adds the constraint.

Generated migration must contain exactly two `DROP INDEX` + two `CREATE INDEX`. No data change.

**Gate before this counts as done** — the dropped `beam_receipt_items` unique was covering for
orphaned items. Run:

```sql
SELECT count(*) FROM beam_receipt_items i
LEFT JOIN beams b ON b.beam_receipt_item_id = i.id WHERE b.id IS NULL;
```

`fabtraq_dev` returns **3** (seeded Part-C `BEAM-C-001/002/003`). Two follow-ons:

- **B1a — fix the seed.** `prisma/seed.ts` Part-C must create a `Beam` row per item, like S4 at
  `:1206` already does. Without this every seeded dev/test DB violates the invariant that B4's
  cancellation predicate rests on.
- **B1b — audit prod before deploy.** Non-zero there needs a repair migration, idempotent and
  dry-run-by-default, same shape as B-035's. RDS is EC2-only reachable, so this is a read-only
  pre-deploy step over SSH.

**Done:** `prisma migrate dev` applies cleanly; `prisma generate` regenerates; seed produces zero
orphans; the B-004 drift gate is green (this is why we are not using a partial unique index —
see spec).

## B2 — The uniqueness authority: `assertBeamNumbersFree`

One private helper on `BeamReceiptService`, called from **all three** create paths immediately
after `validateColourways` (`createPurchase`, `createInHouse`, `createSizingJw`). A guard in only
the path you tested leaves the other two broken.

It replaces all three jobs the dropped constraint was doing:

1. intra-payload duplicates → `ConflictError('Beam number X appears more than once in this receipt.')`
2. clash with a **live** beam → `tx.beam.findMany({ where: { beamNumber: { in: … }, status: { not: 'cancelled' } } })`
   **plus** a second query for orphaned items →
   `tx.beamReceiptItem.findMany({ where: { beamNumber: { in: … }, beam: { is: null } } })`.
   One query is not enough: the Beam register only indexes every used number while the
   every-item-has-a-beam invariant holds. B1a makes that true for any freshly seeded dev/test DB
   (verified: zero orphans after `db:reset` + `db:seed`), but **prod is unaudited until B1b runs**,
   and the guard must not depend on an invariant we cannot yet assert there. Do not fold these
   into one query — they are different tables answering different halves.
3. (job 3 is B3 below)

Safe as read-then-insert: every create path is inside `runSerializable`.

**Tests (unit):**
- rejects a payload repeating a beam number
- rejects a number held by a live beam
- rejects a number held by a receipt item with **no** Beam row
- accepts a number whose only holder is cancelled, asserting the query carries
  `status: { not: 'cancelled' }`

**These are shape tests, not the ticket's regression test.** `prisma.beam.findMany` is mocked to
return `[]`, so the last one reflects the implementation's own where-clause back at itself and
cannot fail if the DB-level exclusion is wrong. The real proof is B6's integration cases; do not
let their absence be papered over by a green unit suite.

**Done:** four tests green, all three create paths call the helper.

## B3 — Lineage lookup off `findUnique`

`prisma-lineage.repository.ts:74` is the only `findUnique({ where: { beamNumber } })` and stops
compiling once the `@unique` is gone. `findFirst`, **and** filter `status: { not: 'cancelled' }`
— resolving a lineage reference to a cancelled beam was wrong before this change too.

**Done:** typecheck clean; existing lineage tests green.

## B4 — One cancellation predicate, exported from the mapper

`beam-receipt.mapper.ts`:

```ts
export const isBeamReceiptCancelled = (row: BeamReceiptRow): boolean =>
  row.items.length > 0 && row.items.every((item) => item.beam?.status === 'cancelled');
```

Supporting changes:
- `BEAM_INCLUDE` beam select gains `status: true` (`prisma-beam-receipt.repository.ts:24`).
- `BeamItemRef` gains `status: BeamStatus`.
- `mapBeamReceiptRow` gains `cancelled: isBeamReceiptCancelled(row)`.

**Tests (unit, mapper):** true only when *every* linked beam is cancelled; false on mixed; false
on create-path rows that carry no `beam` link.

**Done:** mapper tests green; DTO satisfies shared `1.22.0`.

## B5 — Repoint the cancel guard, delete the dead ledger check

`cancel()` swaps `repo.hasReversalRows(id, tx)` for `isBeamReceiptCancelled(receipt)` — same
predicate the DTO exposes, so guard and UI cannot disagree. `hasReversalRows` then has zero
callers on the beam-receipt repo: delete it from the interface **and** the Prisma implementation.
(The identically-named method on the JW-challan-in repo is unrelated and stays.)

**Test:** the existing "throws ConflictError when already cancelled" case is rewritten to drive
the beam status rather than mock the ledger; add a **purchase-origin** double-cancel case — that
is the one the old guard let through.

**Done:** unit suite green; `grep hasReversalRows src/modules/beam-receipt` returns nothing.

## B6 — Integration coverage

In `tests/integration/`:
- cancel a purchase receipt, then re-POST a receipt reusing the same beam number → **201**
- cancel it twice → second call **409**
- create with a live beam number → **409**

`prisma.beam.findUnique({ where: { beamNumber } })` in four existing integration specs becomes
`findFirst` (compile-time break from B1).

These three are **non-trimmable** — they are the only evidence the reported symptom is actually
fixed. Everything above them runs on mocked Prisma.

**Done:** integration green against `fabtraq_test`; `db:reset` afterwards.

## B7 — Re-emit the OpenAPI document

`.github/workflows/ci.yml:108-113` runs `npm run openapi:emit` and fails on any diff against the
committed `fabtraq-be/docs/openapi.json`. Adding required `cancelled` to
`beamReceiptResponseSchema` changes that output, so **CI goes red without this.**

Run `npm run openapi:emit` and commit `docs/openapi.json` in the same commit as the shared
`1.22.0` install.

**Done:** `npm run openapi:emit` produces no diff on a clean tree.
