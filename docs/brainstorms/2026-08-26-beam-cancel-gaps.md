# Beam cancellation gaps — number reuse, cancel visibility, transporter picker (B-037/B-038/B-039)

**Date:** 2026-08-26
**Branch stack:** on top of `fix/out-item-conservation-{be,fe,e2e}` (BE `9d4e3dd`, FE `3d07637`, e2e `344a06c`).
**Originating report:** session `session_014BRwciSV7mYuWHFDT959Y4` — three defects found while
exercising the out-item-conservation branches on live data.

Three separate defects, one shared root: **cancelling a beam receipt is a half-implemented
state.** The write side cancels; the read side does not know it happened.

---

## 0. The live reproduction

Receipt `BRC-2026-27-008` (`ab1204cf-2915-4286-91e8-4c754cfb1a8a`, sizing_jw) was cancelled.
State in `fabtraq_dev` today:

| Fact | Value |
| --- | --- |
| Items | 4 |
| Beams, all `status = cancelled` | 4 — numbers `17`, `18`, `19`, `20` |
| `stock_ledger` rows tagged `beam_receipt` | 8 |
| …of which `notes = 'cancellation'` | 4 |

The four beam ids the reporter listed are exactly these four. So: the cancel *worked*, and yet

- beam numbers `17`–`20` cannot be re-entered (B-037),
- the UI shows no sign the receipt is cancelled and still offers "Cancel receipt" (B-038).

---

## B-037 — A cancelled beam holds its number forever

**Severity:** High. Blocks routine re-entry after a mistaken receipt. No data corruption.

`beam_number` carries a **hard `@unique`** in two places:

| Table | Column | Constraint |
| --- | --- | --- |
| `beams` | `beam_number` | `beams_beam_number_key` |
| `beam_receipt_items` | `beam_number` | `beam_receipt_items_beam_number_key` |

Cancelling sets `Beam.status = 'cancelled'` (`beam-receipt.service.ts:724-726`) but deletes
nothing. Both unique rows survive, so re-entering beam `17` fails with
`A beam with this beam number already exists.` — the P2002 catch at the tail of all three create
paths. Physically the beam number is a **tag on a physical beam**; a cancelled entry means that
tag was never really consumed and must be reusable.

### Why not a partial unique index

The natural fix — `CREATE UNIQUE INDEX … WHERE status <> 'cancelled'` — is not expressible in
Prisma's schema language, so it would live only in raw migration SQL. Every later `migrate dev`
diff would then want to drop it, and the B-004 CI drift gate would go red on every run. Rejected.

### Decision — enforce in the service

Drop both `@unique`s, replace with a plain `@@index([beamNumber])` on each, and enforce
uniqueness in `BeamReceiptService`. All three create paths already run inside `runSerializable`,
so a read-then-insert check is genuinely safe there: a racing transaction aborts `40001` and the
retry sees the row.

That `@unique` was quietly doing **three** jobs; all three need replacing:

1. **Cross-receipt uniqueness** → **two** queries: live `beams`
   (`status: { not: 'cancelled' }`) **plus** orphaned `beam_receipt_items`
   (`beam: { is: null }`). See the correction box in B-038 for why one is not enough.
2. **Intra-payload distinctness** — two identical beam numbers in *one* submission were stopped
   by the DB. Without the constraint both would insert. Must be checked explicitly.
3. **`findUnique({ where: { beamNumber } })` support** — one caller,
   `prisma-lineage.repository.ts:74`. Becomes `findFirst`, and should exclude cancelled beams
   anyway: resolving a lineage reference to a cancelled beam is wrong regardless of this change.

There is **no update path** for beam receipts (create + cancel only — see
`beam-receipt.controller.ts`), so unlike B-016 the guard has exactly one home.

---

## B-038 — Cancelled state is invisible, and the cancel guard does not fire

**Severity:** High. Two defects that share a fix.

### B-038a — no `cancelled` on the DTO

`beamReceiptResponseSchema` has no cancellation field at all. Detail and list pages therefore
cannot show a badge, and the "Cancel receipt" button has nothing to hide behind. Query
invalidation was checked and is **not** the problem: `useCancelBeamReceipt`
(`hooks.ts:43-53`) already invalidates the detail key, the list key and the beam list.

### B-038b — the already-cancelled guard is structurally dead for purchase receipts

`cancel()` guards on `repo.hasReversalRows(id, tx)` — "does a `stock_ledger` row tagged
`beam_receipt` / `notes='cancellation'` exist". But only **two of three** origins ever write
ledger rows:

| Origin | Writes ledger on create? | `hasReversalRows` after cancel |
| --- | --- | --- |
| `in_house` | yes (`beam-receipt.service.ts:408`) | true ✅ |
| `sizing_jw` | yes (`:610`) | true ✅ |
| `purchase` | **no** — no `this.inventory.*` call at all | **false, forever** ❌ |

So a purchase-origin receipt can be cancelled repeatedly. Today each extra run is near-idempotent
(beams already cancelled, `reverseLedger` no-ops) but it writes a duplicate audit row, and it
becomes a real double-reversal the day purchase gains ledger side effects. The reporter's
"still showing an option to cancel the cancelled receipt again" is partly this guard failing.

### Decision — one predicate, derived from the beam register

The ledger is **not** a usable signal, exactly because of the purchase hole above. The Beam
register is: every `BeamReceiptItem` gets a `Beam` row in all three create paths
(`beam-receipt.service.ts:244`, `:417`, `:622`), and `Beam.status = 'cancelled'` is written in
exactly one place — `cancel()` itself (`:724-726`).

> **Corrected 2026-08-26 after review.** An earlier draft called that invariant
> "unconditional". It is not. `prisma/seed.ts` Part-C creates three
> `BeamReceiptItem` rows (`BEAM-C-001/002/003`) with **no** `Beam` row —
> confirmed, 3 orphans in `fabtraq_dev`. The dropped `beam_number` uniques were
> silently covering for it. Two consequences, both handled:
>
> - **Uniqueness:** an orphaned item still occupies its number but is invisible
>   to a `beams`-only query. `assertBeamNumbersFree` therefore runs a **second**
>   query over `beamReceiptItem` where `beam: { is: null }`. The guard no longer
>   depends on the invariant at all.
> - **Cancellation — worse than it first looked.** For an orphaned item
>   `isBeamReceiptCancelled` is permanently `false`. That is not only the B-038b
>   defect class relocated (UI keeps offering "Cancel receipt"); because
>   `reverseLedger` is **not idempotent** — it re-reads every non-cancellation
>   forward row and writes a fresh reversal set — a second cancel on a
>   ledger-writing receipt silently **doubles the reversal**. That is the B-013
>   duplicate-ledger class. `cancel()` therefore keeps a **second** guard on the
>   existence of a `notes='cancellation'` ledger row, which catches exactly the
>   corrupting case the predicate cannot see. Neither guard is sufficient alone:
>   the ledger one is blind to purchase-origin, the predicate one is blind to
>   orphans. Fixed at source too — the seed now creates the three missing `Beam`
>   rows. **Pre-deploy gate:** run the orphan query against prod before
>   shipping; a non-zero count needs a repair migration, the same shape as
>   B-035's.
>
> ```sql
> SELECT count(*) FROM beam_receipt_items i
> LEFT JOIN beams b ON b.beam_receipt_item_id = i.id
> WHERE b.id IS NULL;
> ```

```
isBeamReceiptCancelled(row) =
  row.items.length > 0 && row.items.every(i => i.beam?.status === 'cancelled')
```

Lives in `beam-receipt.mapper.ts`, called by **both** `mapBeamReceiptRow` (→ `cancelled: boolean`
on the DTO) and `cancel()`'s guard, so display and guard can never disagree. The `beam?.` optional
chain matters: the create-path include omits `beam`, and those rows correctly report `false`.

`hasReversalRows` on the beam-receipt repo then has zero callers and is deleted.

---

## B-039 — Transporter is a free-text UUID box on the beam-receipt form

**Severity:** Low, but it makes the field unusable.

`beam-receipt-form.page.tsx:368-379` renders `transporterId` as a plain `<Input>` labelled
"Transporter ID". Typing a transporter's *name* into it produces
`valid uuid is required` from `transporterIdSchema`. Every other form in the app
(`weaving-dispatch-form.page.tsx:189-200`, JW-challan-out) uses the shared
`TransporterSelect` combobox.

### Decision

Swap `Input` → `TransporterSelect`, relabel to "Transporter", widen the `w-40` wrapper (a
combobox in 10rem reads as broken). Root-cause check, not assumption: confirm
`coerceOptStr('')` (`map-form-to-input.ts:171`) returns `undefined` so clearing the picker does
not put `''` on the wire and reproduce the same error.

**Scope flag, deliberately not acted on:** the field is gated to `beamOrigin === 'sizing_jw'`
even though `beam_receipts.transporter_id` is not origin-specific. Purchase-origin receipts
arrive on a vehicle too. Left as-is — raise separately if you want it on all origins.

---

## Cross-cutting consequences

| Area | Consequence |
| --- | --- |
| shared | `cancelled: z.boolean()` added → **minor bump to 1.22.0**, publish, sync both lockfiles, `rm -rf fabtraq-fe/node_modules/.vite` |
| MSW | every beam-receipt handler must return `cancelled`, or the schema-validation gate goes red |
| e2e | specs that type into "Transporter ID", plus the beam-receipt cancel-flow spec, change in the same commits |
| migration | drops two unique constraints — run integration against `fabtraq_test`, then `db:reset` |
| prod | no data repair needed; the constraint drop is forward-only and safe on existing rows |

## Landmine found while doing this: duplicate B-035

`main`'s backlog and the `fix/out-item-conservation-*` backlog **both define a
B-035, and they are different tickets**:

| Branch | B-035 |
| --- | --- |
| `main` | Auth token rotation (session JWT is never refreshed) |
| `fix/out-item-conservation-*` | Out-item consumption counted by five readers |

Nothing here depends on the resolution, and neither ticket is ours to renumber —
but a merge will silently produce a backlog with two `## B-035` sections, and
every cross-reference to "B-035" becomes ambiguous. Whoever merges the
conservation line should renumber one of them first. Our own B-037/B-038/B-039
were allocated against the conservation backlog and are unaffected.

## Prod pre-deploy gate (B1b) — not yet run

The orphan audit below has **not** been run against prod: SSH from this
environment is blocked. `scripts/audit-orphan-beam-items.sh` in `fabtraq-deploy`
runs it in one command. Dev returned 3 before the seed fix and 0 after.

```sql
SELECT count(*) FROM beam_receipt_items i
LEFT JOIN beams b ON b.beam_receipt_item_id = i.id
WHERE b.id IS NULL;
```

Non-zero means those receipts cannot be marked cancelled (`isBeamReceiptCancelled`
requires a Beam row per item) and need a backfill before this ships.

## Out of scope

- Beam-number reuse across *non-cancelled* history (still hard-blocked — correct).
- Making the transporter field available on non-sizing origins (flagged above).
- Any change to how cancellation reverses the ledger.
