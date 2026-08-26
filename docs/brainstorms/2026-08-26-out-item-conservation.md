# Out-item conservation — single source of truth (B-035)

**Date:** 2026-08-26
**Severity:** P0 — silent data corruption, present on `main`, deployed to prod since 2026-08-21.
**Originating report:** session `session_014BRwciSV7mYuWHFDT959Y4` — "how many beams are created from JWO-2026-27-024".

---

## 1. The observed defect

`JWO-2026-27-024` (Rueen Fab, sizing, 2026-08-25) dispatched **10.000 KG** of 20s CP,
lot `LOT-260825-0018`. Three separate beam receipts were then booked against that one
out-item:

| Receipt | Beams | Net wt each | Subtotal |
| --- | --- | --- | --- |
| BRC-2026-27-005 | 1, 2, 3, 4 | 1.000 | 4.000 |
| BRC-2026-27-006 | 10, 11, 12 | 3.000 | 9.000 |
| BRC-2026-27-007 | 14, 15, 16 | 3.000 | 9.000 |
| | | **Total** | **22.000** |

**22 KG of beam produced from 10 KG of yarn.** `stock_ledger` confirms it: five
`beam_receipt` debit rows totalling 22.000 against an at-JW position opened with 10.000.
No wastage recorded on any of the ten items.

## 2. Root cause

`jw_challan_out_items` is drawn down by **more than one** downstream consumer, but every
reader that computes "how much of this out-item is already gone" knows about only **one**
of them.

**Consumers of an out-item:**

| # | Consumer | FK | Consumption quantity |
| --- | --- | --- | --- |
| C1 | `jw_challan_in_yarn_item_source` | `jw_challan_out_item_id` | `consumedQty` (wastage-inclusive, see §3) |
| C2 | `beam_receipt_items` (sizing) | `out_item_id` | `netWeight + wastage` |
| C3 | `weaving_in_weft_sources` | `out_item_id` | `consumedQty` — **confirmed a true consumer**, see §6 |
| C4 | *(no source table)* | `stock_ledger.transaction_item_id` | `write_off` ledger rows — the ledger **is** the source of truth for this one. **Currently always zero:** it is a pre-wired seam for BE-9 `closeOutAsLoss`, which is not implemented (`prisma-inventory.service.ts:972-975`), and dev holds 0 such rows. Include it anyway — the cost is eight lines now versus a silent regression the day BE-9 lands. |

**Readers, and what each one misses:**

| # | Reader | file:line | Counts | Misses |
| --- | --- | --- | --- | --- |
| R1 | `getCumulativeConsumedByOutItems` | `prisma-jw-challan-in.repository.ts:491` | C1 | **C2**, C3 |
| R2 | beam-receipt conservation guard | `beam-receipt.service.ts:510-545` | C1 (via R1) | **C2**, C3 |
| R3 | JW-In conservation guard (`existingConsumed`) | `jw-challan-in.service.ts:970-1010` | C1 | **C2**, C3 |
| R4 | `getOutItemRollup` (`pendingAtJW`, `fullyReceived`) | `prisma-inventory.service.ts:898-1094` | **C1+C2+C3+C4 — CORRECT** | nothing |
| R5 | eligible-out-items picker (`remainingQty`) | `prisma-beam-receipt.repository.ts:199-223` | C1 (via R1) | **C2**, C3, C4 |
| R6 | weft-allocation ceiling (`stillAtJwQty`) | `weaving-in.service.ts:436` ← `getWeavingWeftPositions` `:1275` | all (via R4) | nothing |
| R7 | `deriveStatusFromReceipts` (challan-out status) | `jw-challan-in.service.ts:883-919` | C1 | **C2**, C3, C4 — but **DEAD CODE, zero call sites** (see S4). Deleted as cleanup. |

### The correction that reshapes this fix

**R4 already computes the full union, correctly.** It folds beam consumption (`:993-1031`,
cancellation-aware via `stock_ledger notes:'cancellation'` keyed on `beamReceipt.id`), weaving-in
weft (`:1035-1046`, excluded via `weavingIn.status != 'cancelled'`), and write-offs (`:975-988`).
R6 derives from it and is therefore also correct.

An earlier draft of this document claimed R4 missed C2/C3. That was wrong, and the error mattered:
it would have had us build a second union from scratch beside a correct one. **The defect is not
that nobody knows how to count — it is that R1/R2/R3/R5/R7 each hand-roll a C1-only total instead of
calling the one place that already had the right answer.**

That makes the fix smaller and safer: **extract**, don't rebuild.

This is **one root cause with five symptoms**, not one bug:

- **S1 (the report)** — R2 sees `prior = 0` on every beam receipt, so it only ever validates
  the batch in front of it: `4 ≤ 10 ✓`, `9 ≤ 10 ✓`, `9 ≤ 10 ✓`. Nothing sums them.
- **S2 (the mirror image)** — R3 is blind the other way. Yarn already turned into beams can be
  consumed *again* by a JW-In receipt. Same defect, opposite direction. A fix that hardens only
  the beam path ships half the defect.
- **S3** — R5 reports `remainingQty = 10` forever, which is what made the over-issue easy to do
  in the UI. The guard failing and the picker lying are the same missing term.
- **S4 — WITHDRAWN, never a live bug.** R7 (`deriveStatusFromReceipts`) does compute status from C1
  alone, but it is **dead code**: `git grep` on `main` finds exactly one occurrence — its own
  definition at `jw-challan-in.service.ts:883` — and zero call sites. All three live status paths
  (`recomputeOutChallanStatus` in beam-receipt, `recomputeAllParentStatuses` and
  `recomputeParentStatusesAfterCancel` in JW-In) already route through `getOutItemRollup`, which was
  correct all along. The method is deleted as cleanup, not as a fix.

  **Both the consumption-mapper and I called this a defect.** Neither of us checked reachability
  before doing so — we read a function that counted wrong and assumed it mattered. Presence is not
  reachability. Worth remembering, since over-calling a finding costs the same review time as
  missing one.
- **S5 (independent, found en route)** — R5 computes `netWeight − consumed − wastage`, but §3
  establishes `wastage` is already **inside** `consumedQty`. R5 double-subtracts wastage and
  under-reports remaining. Wrong direction from S3, same line of code.

## 3. Wastage semantics — locked

From `docs/brainstorms/2026-05-19-jw-domain-redesign.md:111`:

> **Invariant (per source row):** `consumedQty = returnedSliceFromThisSource + wastage + stillAtJW`

**`wastage` is inclusive in `consumedQty`, never additive.** Therefore:

- C1 contributes **`consumedQty`** alone. R3 is correct today; R5 is wrong (S5).
- C2 has no equivalent single column — a beam receipt item records the beam produced and the
  wastage separately — so its contribution is **`netWeight + wastage`**. This is the additive
  form that *equals* C1's `consumedQty`, not an inconsistency. Both express "yarn drawn down".

Getting this backwards silently changes every balance in the system. It is stated here so the
implementer does not have to re-derive it, and asserted in a unit test so nobody re-derives it wrong.

## 4. The fix

### 4.1 One owned function — by extraction, not construction

The correct union already lives inside `getOutItemRollup`. **Extract** its consumption computation
into a named function on the same service and have the rollup call it, so there is exactly one
implementation and the rollup's behaviour is provably unchanged:

```
IInventoryService.getOutItemConsumption({ outItemIds, tx })
  → Map<outItemId, { consumed: number; byConsumer: Record<ConsumerKey, number> }>
```

`consumed` = Σ over **all four** consumers, each excluding its own cancelled/reversed rows.
`byConsumer` is kept for error messages and diagnostics — when a guard rejects, the operator must
be told *what* already ate the yarn, not just that the number is too big.

**Characterization tests first.** Pin `getOutItemRollup`'s current outputs *before* extracting, so
the refactor proves it changed nothing. This is the one step that makes touching a correct function
safe.

Two cancellation idioms are currently in play — ledger `notes:'cancellation'` for C1/C2, app-status
for C3. Normalize them behind one documented helper. Keep the *behaviour* identical; this is a
refactor, not a semantics change.

Ownership rationale: `getCumulativeConsumedByOutItems` living in the **JW-In repository** is what
produced this bug. A JW-In-owned function has no business knowing about beam receipts, so it never
learned to — while inventory, which owns cross-module stock truth, had the right answer the whole
time and nobody asked it.

### 4.2 Repoint every reader

R1 is **deleted**; R2, R3, R5 and R7 all call `getOutItemConsumption`. No reader computes its own
consumption total ever again. That is the whole point — readers with private answers is the defect.

- R2, R3 — compare `existing + addNow` against `outItem.netWeight` using the shared tolerance.
- R5 — `remainingQty = netWeight − consumed`. Drops the double-subtraction (S5).
- R7 — derive status from the union instead of its own C1-only walk (S4).
- R4, R6 — **no behaviour change**; R4 becomes a caller of the function extracted from it, and R6
  keeps deriving from R4. Do not "fix" them; they were already right.

### 4.3 Second bug, confirmed — cancelled JW-In receipts are counted (B-036)

Verified, not assumed:

- `JwChallanIn` **has** a status column — `status JwChallanInStatus @default(active)`
  (`schema.prisma:445`), maintained by `setStatus` (`prisma-jw-challan-in.repository.ts:302-308`).
- `findOutWithReceipts`'s `receipts` select (`:332-347`) has **no `where` filter and does not even
  select `status`**. R3 and R7 therefore cannot exclude cancelled receipts — they never receive the
  data.

**Effect:** cancelling a JW-In receipt does not release its consumption. The yarn stays permanently
spoken for, the guard rejects legitimate re-receipt, and status derivation stays wrong. This is the
*opposite* direction from the beam defect — too strict rather than too loose — but the same family:
a reader with a private, partial view.

**Live impact today: none.** Dev has 16 JW-In receipts, all `active`; zero cancelled. The bug is
**latent** and fires the first time anyone cancels a receipt. So it needs no data repair — only the
fix, plus a test so it cannot come back.

`cancel()` (`jw-challan-in.service.ts:458-531`) does not delete anything — it reverses the ledger
and flips `status` (`:493`). The `JwChallanInYarnItemSource` rows persist forever with their
original `consumedQty`, which is exactly what R3 and R7 keep counting.

**The fix is not to add a status filter to that select.** Repoint R3 and R7 **off
`parentMap.receipts` entirely** and onto `getOutItemConsumption`. Patching the loop would preserve
the hand-rolled walk that is the actual defect — and would leave the next reader free to make the
same mistake again.

Note the team already solved this once, in R4. The comment at `jw-challan-in.service.ts:502-506`
says so outright: *"getOutItemRollup is now cancel-aware (it excludes source rows from cancelled
challan-in IDs by joining through the stock_ledger cancellation marker)."* R3/R7 never got the same
treatment purely because they read the raw relation instead of asking the rollup. That is this whole
document in one sentence.

Regression test: cancel a JW-In receipt, then confirm its consumption is released and re-receipt is
permitted.

### 4.3 The part that prevents recurrence

Everything above fixes *this* instance. The next developer adds a sixth consumer and it is
silently uncounted again — that is the actual complaint being answered here.

**Deliverable: a schema-driven completeness test.** It enumerates every Prisma relation pointing at
`JwChallanOutItem` and asserts each one is either

1. registered in the `getOutItemConsumption` union, or
2. present in an explicit `NON_CONSUMING_RELATIONS` allow-list with a one-line reason.

Adding an FK to `JwChallanOutItem` without wiring it up **fails the test suite**. This is the only
part of the plan that prevents recurrence rather than repairing an instance, and it is a named
deliverable, not a footnote.

## 5. Data repair — WITHDRAWN by owner decision (2026-08-26)

**Decision: fix forward only. Corrupted historical rows are left as-is.** No repair migration ships.
Rationale: the history is treated as immutable business record; the guard stops new corruption from
today.

### Consequence that must be understood before deploying

An out-item whose recorded consumption already exceeds its dispatched weight is now **permanently
frozen**: every future beam receipt, JW-In receipt, and weft allocation against it will be rejected
by the new guard, because `existing + addNow > capacity` is already true at `addNow = 0`.

- On **dev** this is harmless — `JWO-2026-27-024` is test data (1 KG and 3 KG beams; real beams are
  far heavier).
- On **prod** this could freeze a live challan that operators still need to work against. That is
  why the prod audit (§7) must be run **before** deployment, not after: the audit output is the list
  of challans that will stop accepting receipts the moment this ships.

If the audit turns up a frozen row that the business still needs open, that specific row needs a
decision at that time — which is exactly the per-row judgement the blanket-repair option would have
pre-empted. The fix-forward decision does not need revisiting; only individual rows might.

### Historical detail (retained for context)

The remainder of this section describes the repair that was considered and rejected.


Dev audit (see §7 for the query) finds exactly **one** genuinely over-consumed out-item:
`JWO-2026-27-024 / LOT-260825-0018`, over by 12.000 KG. Four other rows surface only if wastage is
wrongly treated as additive — they are §3 false positives and must **not** be repaired.

Prod is a separate question. The RDS instance is reachable only from the EC2 host, so the audit
cannot be run from a workstation. **The plan carries the audit as an explicit read-only pre-deploy
step run over SSH on the EC2 box** — its result determines whether prod repair is a one-off
correction or a reconciliation with a report. Do not guess the number.

Repair is a **separate, reviewed migration** from the code fix, run after the guard is deployed, so
corrected rows cannot immediately be re-corrupted. It must be idempotent, log every row it touches
to `audit_log`, and be dry-runnable.

## 6. C3 (weft sources) — resolved: it IS a consumer

Settled by inspection, not assumption:

- `WeavingInWeftSource` carries its own `consumedQty` decimal keyed on `outItemId`
  (`schema.prisma:1012-1024`).
- `weaving-in.service.ts:436` enforces a ceiling against `position.stillAtJwQty`, i.e. it already
  believes it is drawing the out-item down.
- `weaving-in.service.ts:489` writes real ledger debits via `applyWeavingInWeftLedger`.

**C3 joins the union.** Its own ceiling (R6) is derived from R4, so it inherits the fix — but the
union must include C3's `consumedQty` or S6 stays open.

`jw_in_completion_association.source_out_item_id` is **non-consuming** — resolved by inspection at
`schema.prisma:783-797`: the model carries `jobWorkType` and a `completed` boolean and **no quantity
column at all**. It records *that* a process finished against a source, never *how much*. It goes on
`NON_CONSUMING_RELATIONS` with exactly that reason.

That accounts for every relation pointing at `JwChallanOutItem` at time of writing. The point of
§4.3 is that this list must not be maintained by hand again.

## 7. Audit query — validated, cancellation-aware, all four terms

Run read-only. On dev this returns **exactly one row** — the reported defect — and correctly
excludes all four §3 false positives that the naive version produced. Use this one against prod;
the naive version below it is kept only to show what not to trust.

```sql
with jwin as (
  select s.jw_challan_out_item_id oid, sum(s.consumed_qty) qty
  from jw_challan_in_yarn_item_source s
  join jw_challan_in_yarn_item yi on yi.id = s.yarn_item_id
  join jw_challans_in ci on ci.id = yi.challan_in_id
  where ci.status <> 'cancelled'
    and not exists (select 1 from stock_ledger l
                    where l.transaction_type='challan_in' and l.transaction_id=ci.id
                      and l.notes='cancellation')
  group by 1),
beam as (
  select bri.out_item_id oid, sum(bri.net_weight + coalesce(bri.wastage,0)) qty
  from beam_receipt_items bri
  where bri.out_item_id is not null
    and not exists (select 1 from stock_ledger l
                    where l.transaction_type='beam_receipt' and l.transaction_id=bri.beam_receipt_id
                      and l.notes='cancellation')
  group by 1),
weft as (
  select w.out_item_id oid, sum(w.consumed_qty) qty
  from weaving_in_weft_sources w
  join weaving_ins wi on wi.id = w.weaving_in_id
  where wi.status <> 'cancelled'
  group by 1),
woff as (
  select l.transaction_item_id oid, sum(l.out_quantity) qty
  from stock_ledger l where l.transaction_type='write_off' group by 1)
select c.challan_no, i.id, i.lot_number, i.net_weight,
       coalesce(jwin.qty,0) jwin, coalesce(beam.qty,0) beam,
       coalesce(weft.qty,0) weft, coalesce(woff.qty,0) woff,
       coalesce(jwin.qty,0)+coalesce(beam.qty,0)+coalesce(weft.qty,0)+coalesce(woff.qty,0)
         - i.net_weight as over_by
from jw_challan_out_items i
join jw_challans_out c on c.id = i.challan_out_id and c.status <> 'cancelled'
left join jwin on jwin.oid = i.id
left join beam on beam.oid = i.id
left join weft on weft.oid = i.id
left join woff on woff.oid = i.id
where coalesce(jwin.qty,0)+coalesce(beam.qty,0)+coalesce(weft.qty,0)+coalesce(woff.qty,0)
      > i.net_weight + 0.001
order by over_by desc;
```

C1 cancellation is checked **both** ways — status column and ledger marker — deliberately. R3/R7
use neither and R4 uses only the ledger; belt-and-braces is right for a one-off audit even though
the runtime code should settle on one idiom (§4.1).

The per-consumer breakdown columns are not decoration: they tell the operator which subsystem
caused each overage, which is what makes the repair reviewable.

### Superseded — the naive version (do not use)

```sql
select c.challan_no, i.id, i.lot_number, i.net_weight,
       coalesce(b.beam,0) as beam_consumed,
       coalesce(s.jwin,0) as jwin_consumed,
       coalesce(b.beam,0) + coalesce(s.jwin,0) - i.net_weight as over_by
from jw_challan_out_items i
join jw_challans_out c on c.id = i.challan_out_id
left join (select out_item_id, sum(net_weight + coalesce(wastage,0)) beam
           from beam_receipt_items where out_item_id is not null group by 1) b on b.out_item_id = i.id
left join (select jw_challan_out_item_id, sum(consumed_qty) jwin
           from jw_challan_in_yarn_item_source group by 1) s on s.jw_challan_out_item_id = i.id
where coalesce(b.beam,0) + coalesce(s.jwin,0) > i.net_weight + 0.001
order by over_by desc;
```

Kept as a cautionary record. It omits C3 and C4 entirely and excludes no cancellations, and on dev
it reported **five** over-consumed out-items where only **one** is real. Do not act on its output.

## 8. Scope

| Repo | Changes | Branch base |
| --- | --- | --- |
| `fabtraq-be` | The whole fix: union function, five readers, completeness test, repair migration | `main` |
| `e2e` | Regression specs S1 + S2 | `master` (this repo has no `main`) |
| `fabtraq-shared` | **None — confirmed by inspection.** `BUSINESS_RULE_VIOLATION` / `httpStatus 422` already exist and are unchanged; `details` gains `byConsumer` as untyped passthrough. No bump ⇒ no publish, no lockfile sync, no vite dep-cache clearing. | — |
| `fabtraq-fe` | **In scope — the "no FE change" assumption was checked and is wrong.** A 422 falls through to a bare toast with no field anchor (`beam-receipt-form.page.tsx:281-294`). Anchor the conservation error on both the beam-receipt and JW-In forms. | `main` |

Work happens in **worktrees off `main`** (`worktrees/out-item-conservation-{be,e2e}`).
`feat/inventory-rewoven` has uncommitted work in the primary trees — **do not touch them.**

## 9. Collision with `feat/inventory-rewoven`

That branch's in-flight wastage feature "aggregates three sources with per-process thresholds"
against these same out-items. Once beam receipts enter the consumption union, that aggregation may
double-count. **Named here as a rebase-and-recheck item for that branch. It is not solved inside
this fix** — but it must not be discovered by surprise later.

## 10. Regression tests that must fail before the fix

Both are cross-module and therefore belong in `tests/integration/`, not unit:

1. **S1** — three sequential beam receipts against one 10 KG out-item; the third is rejected with
   `CONSERVATION_VIOLATION`.
2. **S2** — a beam receipt, then a JW-In receipt against the same out-item that would exceed the
   dispatch; rejected.
3. **S5** — an out-item with recorded wastage reports `remainingQty = netWeight − consumedQty`,
   with wastage counted exactly once.
4. ~~**S4**~~ — withdrawn. Already covered by an existing passing test
   (`beam-receipt-sizing.routes.test.ts:394-400`), because the live paths were never broken. No red
   state exists to demonstrate against, so no new test was added — a green-from-birth test here
   would assert nothing.
5. **Characterization** — `getOutItemRollup` returns byte-identical results before and after the
   extraction, across all four consumer terms. Not a regression test (it passes before), but the
   thing that makes the refactor safe. Label it as such so nobody deletes it as redundant.

A test that passes before the fix is not a regression test. Each must be demonstrated red first.
