# Party-lot carry-forward, JW-In status, and the cancelled-parent placement guard

**Date:** 2026-08-20
**Status:** Approved for implementation
**Origin:** user report on JWI-2026-27-016 ("no option to place the stock"), which
surfaced three defects of the same family.

---

## 0. Summary

Three related workstreams, sequenced. All three descend from one root pattern:
**cancellation and provenance were inferred rather than recorded.**

| § | Workstream | Kind |
|---|------------|------|
| 2 | JW-In gets a real `status` column | schema + contract |
| 3 | Cancelled-parent guard on placement, all three source types | correctness |
| 4 | Repair of existing damaged stock (both directions) | one-off data remediation |
| 5 | Party-lot carry-forward through job work | domain modelling |

Locked decisions from the 2026-08-20 brainstorm are recorded in §1.

---

## 1. Locked decisions

| # | Decision | Ruling |
|---|----------|--------|
| L1 | Mixed party lots on a multi-source receipt | **Concatenate distinct values** |
| L2 | Party lot editable? | **Strictly derived, read-only.** No override, no manual entry on JW-In |
| L3 | Backfill party lot on 16 historical JW-In lots | **No.** Historical lots stay blank |
| L4 | JW-In cancellation representation | **Real `status` column**, not a computed flag |
| L5 | Concatenation format | **Dedup + sort, ` / `-separated, no cap** |
| L6 | `JwChallanInStatus` values | **`active` \| `cancelled`** only |
| L7 | Party-lot visibility | JW-In detail, Stock Balance / lot listings, Beam detail composition. **Not** JW-Out challan or print |
| L8 | Cancel + existing placements | **Ledger reversed, placement rows kept as history.** Item leaves the queue via the cancelled filter, not by deletion |
| L9 | Status backfill | **Mandatory.** Unlike L3, existing cancelled challans MUST be marked, or they silently read as active |
| L10 | Carry-forward mechanism | **Approach A — denormalized per generation.** Single-hop resolution at any chain depth |
| L11 | Party lot stops at | **The beam.** Beam identity (`beamNumber`) takes over; composition rows still snapshot their sources' party lots |

---

## 2. JW-In status column

### 2.1 Problem

`jw_challans_in` has no status column. `jw_challans_out` has `ChallanOutStatus`
and `yarn_purchases` has `RecordStatus`; JW-In was the only transaction whose
cancelled state existed nowhere except as reversal rows in `stock_ledger`,
re-derived on demand by `hasReversalRows()`.

User-visible consequence: a cancelled receipt is byte-for-byte identical to a
live one in the list and on the detail page, and the "Cancel receipt" button
stays enabled forever. The only way to discover the state is to press Cancel and
read the `CHALLAN_ALREADY_CANCELLED` error.

### 2.2 Schema

```prisma
enum JwChallanInStatus {
  active
  cancelled
}

model JwChallanIn {
  // ...
  status JwChallanInStatus @default(active)
  @@index([status])
}
```

### 2.3 Backfill (L9)

In the same migration, after the column is added:

```sql
UPDATE jw_challans_in SET status = 'cancelled'
WHERE id IN (
  SELECT DISTINCT transaction_id FROM stock_ledger
  WHERE transaction_type = 'challan_in' AND notes = 'cancellation'
);
```

This is the one place we read the cancellation marker to establish state. After
this migration the column is authoritative and no code re-derives it.

### 2.4 Service

- `cancel()` sets `status: 'cancelled'` inside the existing transaction,
  alongside the ledger reversals. Reversal behaviour is unchanged — that is the
  stock mechanism; this is the state record.
- The already-cancelled guard reads `row.status === 'cancelled'` instead of
  calling `hasReversalRows()`.
- `hasReversalRows()` remains on the repository (other callers may exist) but is
  no longer the source of truth for challan state.

### 2.5 Contract

`jwChallanInResponseSchema` gains `status: jwChallanInStatusSchema`. Both the
list (`pageOfSchema(jwChallanInResponseSchema)`) and detail endpoints share this
schema, so one addition covers `GET /jw-challans-in`, `GET /jw-challans-in/:id`,
`POST /jw-challans-in`, and `POST /jw-challans-in/:id/cancel`.

Registry consequence (B-004): `registry/transaction/jw-challans-in.registry.ts`
references the schema by identity, so the OpenAPI document regenerates and the
CI drift gate will fail until it is committed. Regenerating is part of the task,
not a follow-up.

### 2.6 FE

- List: a status column rendering a badge, following the JW-Out pattern in
  `features/jw-challans-out/columns.tsx` (`STATUS_LABEL` / `STATUS_VARIANT`).
- Detail: a status badge in the `PageHeader`; the "Cancel receipt" button is
  hidden when `status === 'cancelled'`.
- MSW handlers must return the new field, and per the contract-drift rule every
  mocked response is schema-validated — a handler missing `status` fails its own
  test rather than drifting silently.

---

## 3. Cancelled-parent placement guard

### 3.1 Problem

`PlaceStockService.listQueue` filters on nothing but
`placementStatus IN ('pending','partially_placed')`. No source type checks
whether its parent transaction is still alive. `addPlacements` has no such check
either. So a cancelled purchase, JW-Out, or JW-In keeps offering its items in the
Place Stock queue, and placing one writes live ledger rows against a dead
document.

The damage is direction-dependent (see §4.0 for why the two shapes differ):

- **Inbound** (purchase / JW-In) — a bucket→floor move-pair appears, inflating
  stock on a real floor. Confirmed empirically in `fabtraq_dev`: 125 KG (§4.1).
- **Outbound** (JW-Out) — a floor→JW-position move-pair appears, *draining* real
  yarn off a real floor into a ghost job-worker position under a cancelled
  challan. The floor-balance guard makes this succeed precisely when the floor
  genuinely holds the stock, so it silently reduces true inventory. Not yet
  triggered in `fabtraq_dev`, but fully reachable.

One guard closes both, because all three source types converge on
`addPlacements`.

### 3.2 The uniform rule

All three parents already record cancellation once §2 lands:

| Source type | Parent | Alive when |
|-------------|--------|------------|
| `yarn_purchase_item` | `yarn_purchases` | `status = 'active'` |
| `jw_challan_out_item` | `jw_challans_out` | `status <> 'cancelled'` |
| `jw_challan_in_yarn_item` | `jw_challans_in` | `status = 'active'` (new) |

### 3.3 Two layers, deliberately

1. **`listQueue`** adds the parent-status filter to each of the three
   `findMany`/`count` pairs. This is presentation: it stops the row appearing.
2. **`resolveSourceItemMeta`** — the private resolver that `addPlacements`,
   `editPlacement`, and `getPlaceStockItem` all already call — gains
   `parentActive: boolean`, projected from the parent relation in the same
   `findUnique` it already issues. `addPlacements` and `editPlacement` then
   reject on `meta.parentActive === false` with
   `BusinessRuleError(..., { details: { code: 'PARENT_CANCELLED' } })`.

Layer 2 is the actual guard. Putting it on the shared resolver rather than in a
separate `assertParentActive` helper costs **zero extra queries** — the parent
status rides along on the `findUnique` each path already performs — and means
every current and future caller of the resolver inherits it. Filtering the list
alone would leave a stale browser tab, a replayed request, or any future caller
able to write against a dead document.

`getPlaceStockItem` surfaces `parentActive` in its response so the placement
editor renders read-only for a cancelled parent instead of a working form.

Placing the check where all callers converge — rather than in each cancel path —
is what makes it a root-cause fix: a cancel path added tomorrow cannot forget it.

### 3.4 Out of scope, deliberately

`getEligibleSourceLots` is already protected: a cancelled parent's ledger nets to
zero, so the positive-balance check excludes it. No change there.

---

## 4. Repair of existing damaged stock

### 4.0 The tagging asymmetry (load-bearing)

`applyPlacementLedger` writes **two different shapes** depending on source type.
This is correct and deliberate, but it is the single most misleading thing in
this area of the codebase and any repair must account for it:

| Source type | Move-pair written | `transaction_type` |
|-------------|-------------------|--------------------|
| `yarn_purchase_item` | bucket debit → floor credit | `placement` |
| `jw_challan_in_yarn_item` | bucket debit → floor credit | `placement` |
| `jw_challan_out_item` | floor debit → JW-position credit | **`challan_out`** |

`applyPlacementAdjustment` follows the same split.

Consequence: `JwChallanOutService.cancelIn` reverses only `challan_out` and
**this is correct** — JW-Out never writes `placement`-tagged rows, so the second
`reverseLedger({ transactionType: 'placement' })` call that Purchase and JW-In
make would find nothing. An earlier draft of this design wrongly recorded that
omission as a defect and proposed extracting a shared reversal function. That
proposal is **withdrawn**: there is no missing step, and the three cancel paths
are each correct for their own tagging.

### 4.1 Two damage populations

Placing stock under an already-cancelled parent produces opposite corruption
depending on direction:

**Population A — inbound (purchase / JW-In): stock inflated.**
Observed in `fabtraq_dev` 2026-08-20:

```
LOT-260820-0003  purchase   +100 bucket
                 purchase   -100 bucket   (cancellation)
                 placement  -100 bucket   <- written after cancel
                 placement  +100 floor    <- phantom stock
LOT-260820-0004  same shape, 25 KG
LOT-260820-0005  cancelled, never re-placed — clean
```

Each lot nets to zero, so no aggregate alarm fires; per position it is bucket
−q and floor +q. `GET /inventory/lots` returns `LOT-260820-0003` = 100 KG on
First Floor and `LOT-260820-0004` = 25 KG on Ground Floor. **125 KG of phantom
yarn on real floors.**

**Population B — outbound (JW-Out): stock deflated.**
Rows tagged `challan_out` written *after* that challan's cancellation rows:
floor debit −q (real stock drained off a real floor, and the balance guard
means it only succeeds when the floor genuinely holds it) plus JW credit +q
(a ghost at-job-worker position under a cancelled challan).

**Zero rows in `fabtraq_dev` today** — `JWO-2026-27-023` is correctly balanced
at four rows. The repair still covers it so the script is correct whenever it
runs, not merely correct against today's snapshot.

### 4.2 Repair

Population A: reverse via the existing
`reverseLedger({ transactionType: 'placement', transactionId })` — the same call
`cancel()` already makes. It missed these rows only because they did not exist
at cancel time.

Population B: cannot use a whole-transaction reversal, because the *legitimate*
pre-cancellation `challan_out` rows for that challan are already correctly
reversed. Only the post-cancellation rows may be touched. Select them by
timestamp against the challan's own cancellation rows and write matched
counter-entries.

### 4.3 Constraints

- **B-013 rule applies.** Never identify live ledger rows by absence of a
  cancellation marker. Select orphans explicitly — Population A by
  `(transaction_type='placement', transaction_id IN <cancelled parents>)`,
  Population B by `(transaction_type='challan_out', transaction_id IN
  <cancelled out-challans>, created_at > that challan's cancellation timestamp)`
  — and check for an existing reversal before writing one.
- Capture `stock_ledger` for affected lots before and after. Assert every
  affected floor position returns to its correct value, no bucket goes negative,
  and no JW position is left non-zero for a cancelled challan.
- Placement rows are retained (L8). Only the ledger is corrected.
- Runs once, as a reviewed script under `scripts/`, not as a migration: the
  damage shape depends on when each site cancelled, and it must be re-runnable
  safely (a second run finds no unreversed orphans).
- Runs **after** §3, so the hole is closed before the repair executes.

## 5. Party-lot carry-forward

### 5.1 Problem

`party_lot_no` exists only on `yarn_purchase_items`. Every JW-In receipt mints a
fresh `LOT-…` via `mintLotNumber`, and `jw_challan_in_yarn_item` has no
party-lot column — so `inventory.mapper.ts` resolves `partyLotNo` from the
purchase origin alone and returns `null` for every JW-In-origin lot. The
vendor's lot number is lost the first time yarn goes out for processing.

Requirement: the party lot travels with the yarn through every job-work hop, and
stops when the yarn becomes a beam (L11).

### 5.2 Approach A — denormalized per generation

Each generation stores its own resolved value. Because a JW-In item's parents
already carry *their* combined party lot, resolving a new receipt is always a
**single hop** — never a recursive walk, at any chain depth.

```
YP-…-001  party "PL-441"          purchase item
   |  JW-Out (twisting)
   v
JWI-…-014  party "PL-441"         resolved from source lot, 1 hop
   |  JW-Out (dyeing)
   v
JWI-…-021  party "PL-441"         resolved from JWI-…-014, 1 hop
   |  beam receipt
   v
BEAM-…-007  composition row snapshots "PL-441"; the beam itself has none
```

Merging is where it grows:

```
JWI-…-030 sourced from lots carrying "PL-441" and "PL-509"
   -> party "PL-441 / PL-509"
```

**Rejected alternatives.** *Read-time recursive resolution* — no columns, walk
the graph per read: forbidden from doing it in SQL by the compute-in-app rule,
and doing it in Node means loading an ancestry graph per row of a hundred-row
inventory table. It also retroactively rewrites history when a purchase is
edited. *A `lot_ancestry` table* — a genealogy subsystem for a requirement a
string satisfies; revisit if "show everything descended from this purchase" is
ever asked for.

**Accepted trade-off:** editing a purchase's party lot after the fact does not
propagate to descendants. This is correct — provenance is a snapshot of what was
true at receipt, exactly as `beam_composition_sources` already snapshots
location and quantity.

### 5.3 Schema

```prisma
model JwChallanInYarnItem {
  partyLotNo String? @map("party_lot_no")
}

model BeamCompositionSource {
  partyLotNo String? @map("party_lot_no")
}
```

No backfill (L3). Historical rows stay `NULL` and render as `—`.

### 5.4 The combining function

Ships in `@fabtraq/shared` so BE and FE word it identically:

```ts
/** Dedup + sort + " / "-join. Null when nothing survives. */
export function combinePartyLots(values: readonly (string | null | undefined)[]): string | null
```

Rules (L5): drop `null`/`undefined`/empty/whitespace-only; trim; dedup exact
matches; sort lexicographically so the same set always renders identically; join
with `' / '`; return `null` for an empty result. No cap.

Sorting rather than preserving entry order is deliberate — the string is an
identity, and the same set of ancestors must not render two ways on two lots.

### 5.5 Resolution

New bounded-context method, mirroring the existing two-query bulk fetch at
`prisma-inventory.service.ts:523`:

```ts
findPartyLotsByLotNumbers(p: { lotNumbers: readonly string[]; tx? }): Promise<Map<string, string | null>>
```

Looks up `yarn_purchase_items.lot_number` and `jw_challan_in_yarn_item.lot_no`
(both `@unique`), purchase taking precedence — the same precedence the eligible
-source-lot filter already uses.

Write sites:

- **JW-In create** — for each yarn item, collect its sources' out-items'
  `lotNumber`s, resolve, `combinePartyLots`, store on the item.
- **Beam receipt create** — for each composition source, resolve its pulled
  `lotNumber` and store on the composition row.

Read site:

- `inventory.mapper.ts` — `purchase?.partyLotNo ?? challanIn?.partyLotNo ?? null`.
  `inventory.service.ts:343` gets the matching change.

### 5.6 Contract

- `jwChallanInYarnItemResponseSchema.partyLotNo: z.string().nullable()`
- `beamCompositionSourceResponseSchema.partyLotNo: z.string().nullable()`
- `inventoryLotRowSchema` / `aggregatedInventoryLotRowSchema` already declare
  `partyLotNo` — no change, the field simply stops being null for JW-In lots.

### 5.7 FE

Mostly free. `formatLotIdentity()` in `features/inventory/lib/lot-labels.ts`
already renders `"LOT — partyLot"`, and every lot-shaped dropdown in the app
routes through it — JW-Out source lots, beam-receipt pulls, stock-transfer
positions, JW-In eligible sources all inherit the carried party lot with no
change. `features/inventory/columns.tsx:236` already renders a Party Lot No
column.

New work, per L7:

- JW-In detail: Party Lot on each received-item card, beside the lot number.
- Beam detail: a Party Lot column on the composition table.

The lot-label invariant holds — the lot number stays the leading token; party lot
is appended, never reordered.

---

## 6. Testing

TDD throughout; tests precede implementation in each repo.

**Unit**
- `combinePartyLots`: single, duplicate, multiple, all-empty, whitespace-only,
  sort stability across input orders.
- `assertParentActive`: active and cancelled for each of the three source types.
- JW-In service: multi-source resolution produces the combined string; a
  single-source receipt carries the parent's value unchanged.
- JW-In `cancel()`: sets `status`, and rejects a second cancel by reading the
  column.

**Integration**
- Cancel a JW-In, then `POST` a placement for its item → `PARENT_CANCELLED`, and
  `stock_ledger` is unchanged.
- Same for a cancelled purchase and a cancelled JW-Out.
- Queue excludes items under all three cancelled parent types.
- Note: `test:integration` truncates `fabtraq_dev`. Re-seed afterwards and warn
  before running.

**E2E (lockstep rule)**
- Two-hop chain: purchase with a party lot → JW-Out twisting → receive → JW-Out
  dyeing → receive; assert the party lot appears on both receipts, in the lot
  listing, and in the source picker at each hop.
- Multi-source merge: two source lots with different party lots into one
  received lot; assert the combined `A / B` string.
- Cancel-then-queue: cancel a receipt, assert the item is absent from
  `/place-stock` and the floor balance never moves.
- The zero-placement queue spec written earlier today
  (`jw-in-yarn.spec.ts`, `receiveLot(..., place=false)`) runs in this pass —
  it has not yet been executed live.

**Visual**
Live Playwright screenshots of the JW-In detail badge, the list status column,
and the beam composition table, per the verify-UI-visually rule.

---

## 7. Sequencing

1. §2 — JW-In status (schema, backfill, service, contract, FE)
2. §3 — guard (depends on §2 for the JW-In arm)
3. §4 — phantom-stock repair (depends on §3, so the hole is closed before the
   repair runs)
4. §5 — party lot (independent of 1–3; may run in parallel)

One `@fabtraq/shared` minor bump (**1.18.0** — 1.17.0 is already published) covering the §2 and §5 contract
additions, published once before BE/FE consume it. Per the vite dep-cache rule,
clear `fabtraq-fe/node_modules/.vite` after installing.

Docs mirrored to `docs/sprints/` across all repos on completion.

---

## 8. Risks

| Risk | Mitigation |
|------|-----------|
| Status backfill mislabels a live challan | Marker query is exact (`transaction_type='challan_in' AND notes='cancellation'`); verify counts before/after against `hasReversalRows()` for every row |
| Repair double-reverses | Idempotent by construction; explicit orphan selection per B-013, never marker-absence |
| Repair touches legitimate pre-cancel `challan_out` rows (Population B) | Timestamp-scoped selection against the challan's own cancellation rows; those rows are already correctly reversed and must not be touched |
| Concatenated string grows unbounded | Accepted (L5). Growth needs distinct party lots merging; a single-origin chain stays one value at any depth |
| Denormalized party lot drifts from an edited purchase | Accepted and documented — provenance is a receipt-time snapshot |
| OpenAPI drift gate fails CI | Regenerate and commit as part of §2, not as a follow-up |
