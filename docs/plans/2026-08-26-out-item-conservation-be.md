# Plan — out-item conservation (fabtraq-be)

**Spec:** `docs/brainstorms/2026-08-26-out-item-conservation.md`
**Branch:** `fix/out-item-conservation-be`, worktree `worktrees/out-item-conservation-be`, **based on `main`** (`f6d9e1e`).
**Do not touch** the primary `fabtraq-be` tree — `feat/inventory-rewoven` has uncommitted work there.

Read the spec before starting. §3 (wastage is inclusive in `consumedQty`) is load-bearing; getting
it backwards silently changes every balance in the system.

---

## Ground rules

- One task per sub-agent. Each task ends with `lint` + `typecheck` + `test` + `build` green before
  the next is dispatched.
- TDD: every task writes its test first and **demonstrates it red** before the implementation. A
  regression test that was never red is not a regression test.
- Integration tests truncate `fabtraq_dev`. A snapshot exists at
  `db-snapshots/fabtraq_dev-2026-08-26-pre-conservation-fix.dump` (contains the live 22 KG
  reproduction). Restore + re-seed after any integration run, and stop dev servers first — a live
  pool blocks the restore.
- Commit per task locally. Push at the end, on the user's go. **Never merge to main — raise a PR.**

---

## T1 — Lock the wastage semantics in a test

Before any behaviour changes, pin §3 so the rest of the work cannot drift.

- Unit test asserting `consumedQty = returnedSlice + wastage + stillAtJW` for a JW-In source row,
  and that a beam receipt item's yarn draw is `netWeight + wastage`.
- Name it so its purpose is obvious at a failure site, e.g.
  `out-item-consumption.semantics.test.ts`.

**Done:** test green, and it fails if either formula is edited.

## T2 — Extract the consumption authority (do NOT rebuild it)

**`getOutItemRollup` (`prisma-inventory.service.ts:898-1094`) already computes the full, correct
union** — C1, C2 (cancellation-aware), C3, and write-offs. Read it before writing anything. The
defect is that four *other* readers hand-roll a C1-only total instead of calling it.

So this task is an **extraction**: pull the consumption computation out of `getOutItemRollup` into a
named function on the same service, and have the rollup call it.

```
IInventoryService.getOutItemConsumption({ outItemIds, tx })
  → Map<outItemId, { consumed: number; byConsumer: Record<ConsumerKey, number> }>
```

- **Four** terms, not three: **C1** `jw_challan_in_yarn_item_source.consumedQty` (`:1049-1063`),
  **C2** `beam_receipt_items.(netWeight + wastage)` (`:993-1031`), **C3**
  `weaving_in_weft_sources.consumedQty` (`:1035-1046`), **C4** `write_off` ledger rows
  (`:975-988`). Dropping C4 would regress the rollup — there is no source table for write-offs, so
  the ledger is its source of truth.
- **Characterization tests first.** Pin `getOutItemRollup`'s current outputs across all four terms
  *before* extracting, so the refactor proves it changed nothing. This is what makes touching a
  correct function safe. Label them as characterization tests so nobody later deletes them as
  redundant.
- Two cancellation idioms are in play — ledger `notes:'cancellation'` for C1/C2, app-status
  (`weavingIn.status != 'cancelled'`) for C3. Normalize them behind one documented helper. Keep
  behaviour **identical**; this is a refactor, not a semantics change.
- Batched reads only. Per the standing rule, **compute in the application layer** — fetch raw rows
  and sum in JS; no new SQL aggregation pushed onto the DB.
- `byConsumer` is retained for error messages: when a guard rejects, the operator must be told
  *what* already ate the yarn, not just that the number is too big.

**Done:** unit tests cover each consumer alone, all three combined, and cancellation exclusion for
each. Coverage thresholds met.

## T2b — Collapse the two implementations into one

T2 shipped `getOutItemConsumption` as a **parallel** implementation rather than an extraction, and
deferred the dedup. That is a reasonable sequencing choice but it cannot be the end state: there are
now **two** implementations of the union, which is the exact disease this workstream treats. Two
implementations drift; that is not a prediction, it is what B-035 is.

Do this **before** any reader repoints, so everything lands on one implementation rather than being
migrated twice.

1. **Add the missing fourth term.** T2 omitted C4 (write-offs). It is currently always zero — a
   pre-wired seam for BE-9 `closeOutAsLoss`, which is unimplemented — so nothing is broken today.
   But `getOutItemRollup` *does* deduct it, so folding the rollup onto `getOutItemConsumption`
   without C4 would be a silent regression, and it would also go wrong the day BE-9 ships. Copy the
   existing query at `prisma-inventory.service.ts:977-990`. Add a `writeOff` key to
   `OutItemConsumerKey`.
2. **Characterization tests first.** Pin `getOutItemRollup`'s current outputs across all four terms
   before touching it. Label them as characterization tests so nobody later deletes them as
   redundant with the T2 unit tests — they serve a different purpose.
3. **Make `getOutItemRollup` call `getOutItemConsumption`** and delete its inline duplicate. The
   characterization tests must stay green throughout; if one goes red, the extraction changed
   behaviour and is wrong.

**Watch the stillAtJW subtlety.** `getOutItemRollup` treats `stillAtJwQty` as *not yet drawn down*
(it stays in `pendingAtJW`), while the guards count full `consumedQty`. T2's function uses
`consumedQty`, matching the guards. When folding, preserve **both** behaviours exactly — the rollup
must keep excluding `stillAtJwQty` from what it considers gone. If a single number cannot serve both,
return both terms rather than picking one and quietly changing a balance. Flag it to the lead rather
than deciding alone.

**Done:** characterization tests green before and after; `getOutItemRollup` has no inline consumer
aggregation left; full gate bar.

## T3 — Repoint the guards (S1 + S2)

- `beam-receipt.service.ts:510` → `getOutItemConsumption`. Include `byConsumer` in the
  `CONSERVATION_VIOLATION` details.
- `jw-challan-in.service.ts:970-1010` → **delete** the hand-rolled `existingConsumed` walk and call
  `getOutItemConsumption` instead. Keep the existing error code and message shape.

  Do **not** merely add C2/C3 terms to that loop. It reads `parentMap.receipts`, which comes from
  `findOutWithReceipts` — a select with no status filter — so it counts **cancelled** JW-In receipts
  too (spec §4.3, B-036). Preserving the loop preserves that second defect. Cutting the loop fixes
  both at once, which is why this is the smaller change as well as the correct one.
- Both compare `existing + addNow > netWeight + tolerance` using the shared tolerance constant.

**Done:** integration tests, all demonstrated red first —
- **S1** three sequential beam receipts against a 10 KG out-item; third rejected.
- **S2** beam receipt then JW-In exceeding the dispatch; rejected.
- **B-036** cancel a JW-In receipt, then confirm its consumption is released and a replacement
  receipt is permitted. Latent on dev today (16 receipts, all `active`) — which is exactly why it
  needs a test rather than a repair.

## T4 — Fix the status derivation (S4)

`deriveStatusFromReceipts` (`jw-challan-in.service.ts:883-919`) recomputes `ChallanOutStatus` during
the cancel-reconstruction path by summing `consumedQty` from in-memory JW-In sources — C1 only. A
sizing challan-out fully consumed via beam receipts therefore still reports `sent` or
`partially_received`.

- Repoint it at `getOutItemConsumption`.
- **Do NOT touch `getOutItemRollup`'s `pendingAtJW` algebra or `getWeavingWeftPositions`.** Both
  were already correct. The doc comment at `:867-892` stays valid — only update it if the extraction
  moves the code it describes.

Same rule as T3: **delete** the C1-only walk rather than extending it. It shares
`findOutWithReceipts`'s unfiltered `receipts` select and so carries the same cancelled-receipt
defect (B-036).

**Done:** integration test **S4** — a sizing challan-out fully consumed via beam receipts reports
`fully_received`. Red first.

## T5 — Fix the picker (S3 + S5)

`prisma-beam-receipt.repository.ts:199-223`:

- Source from `getOutItemConsumption`.
- `remainingQty = netWeight − consumed`. This drops the current double-subtraction of wastage
  (`− consumed − wastage`), which §3 shows is wrong.
- Delete `getCumulativeConsumedByOutItems` and its interface declaration
  (`jw-challan-in.repository.ts:275`) once both callers are repointed. Leaving it is leaving the
  trap armed.

**Done:** integration test **S5** — an out-item with recorded wastage reports
`netWeight − consumedQty`, wastage counted exactly once. Red first.

## T6 — The recurrence guard (the actual deliverable)

T1–T5 fix this instance. T6 is what answers "no more errors of this class".

A **schema-driven completeness test** that:

1. enumerates every Prisma relation pointing at `JwChallanOutItem` (parse `prisma/schema.prisma`,
   or use the generated DMMF — DMMF is preferred, it cannot drift from the schema);
2. asserts each is either registered in the `getOutItemConsumption` union or listed in an explicit
   `NON_CONSUMING_RELATIONS` allow-list **with a one-line reason**;
3. fails the suite otherwise.

Classify `jw_in_completion_association.source_out_item_id` as part of this task — it reads as a
close-out linkage rather than a quantity draw, but it must be *decided* and written down.

**Done:** the test fails when a dummy FK to `JwChallanOutItem` is added and passes once that
relation is registered or allow-listed. Demonstrate both directions.

## T7 — WITHDRAWN. Replaced by: commit the audit query as a versioned file.

Owner decision 2026-08-26: **fix forward only, corrupted rows left as-is.** No repair migration.

What remains is trivial and needs no script: save the validated §7 audit SQL as
`scripts/audit-out-item-conservation.sql` so it is versioned, reviewable, and re-runnable over psql
on the EC2 host. A TypeScript runner would add a dependency, an entrypoint, and a test for something
a `.sql` file and `psql -f` already do.

**Run it against prod BEFORE deploying**, not after — see spec §5. Any row it returns is a challan
that will stop accepting receipts the moment the guard ships, and the business may still need some
of them open.

### Superseded — the repair migration that was planned

Runs **after** the guard is deployed, so corrected rows cannot immediately be re-corrupted.

- Idempotent script, **dry-run by default**, `--apply` to write.
- Uses the **validated** §7 audit query (cancellation-aware, all four terms). It has been run
  read-only against dev and returns exactly the one real defect. Do not use the superseded naive
  query kept below it in that section.
- Writes every touched row to `audit_log` with a reason referencing this spec.
- Dev has exactly one genuine over-consumption: `JWO-2026-27-024 / LOT-260825-0018`, over by
  12.000 KG. The four other rows the naive query surfaces are §3 false positives — **do not repair
  them.**
- Prod numbers are **unknown from here**: the RDS instance is EC2-only reachable. The audit is a
  read-only pre-deploy step run over SSH on the EC2 host. Do not guess the number, and do not run
  AWS mutations without the cost table first.

**Done:** dry-run output reviewed against the dev snapshot before `--apply` is offered.

---

## Gate bar before "done"

`npm run lint` (`--max-warnings 0`) · `typecheck` · `test` · `build` · coverage thresholds ·
`format:check` (prettier needs two passes in this repo) · every new endpoint path has a happy +
error integration test · no `any`, no TODOs without a tracked task.

Then: restore the dev DB from the snapshot, re-run the original reproduction, and confirm a fourth
beam receipt against `LOT-260825-0018` is now **rejected**. Verify the original symptom, not a
synthetic path.

## Out of scope — but flagged

`feat/inventory-rewoven`'s wastage feature aggregates three sources against these same out-items.
Once beam receipts enter the consumption union, that aggregation may double-count. It is a
rebase-and-recheck item **for that branch**, not this one. Do not solve it here; do not let it be
discovered by surprise later.
