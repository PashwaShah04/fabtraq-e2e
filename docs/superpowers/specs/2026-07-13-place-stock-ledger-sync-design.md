# Place-Stock ↔ Ledger Sync — Design (the "correct fix", not a patch)

- **Date:** 2026-07-13
- **Status:** LOCKED — user directive "fix it correctly, not a patch fix" (session
  `session_01DfjZtMYygXUWEN4FeA6aMr`), autonomous execution authorized.
- **Origin:** user-reported 2026-07-13: (a) placing stock twice to the same floor
  creates two placement rows; (b) floor UUIDs shown instead of names; (c) placement
  component width regression; (d) Place Stock shows stale floors after a Stock
  Transfer ("not in sync").
- **Mirrors:** root `docs/`, `fabtraq-be/docs/`, `fabtraq-fe/docs/`, `e2e/docs/`.

## 1. Source-of-truth statement (canonical, cite this)

**`stock_ledger` is the single source of truth for where stock currently sits.**
The `placements` table is a put-away *event record* (per source item) that drives
the Place Stock queue (`placedQty` / `placementStatus`). It is never a balance
store. Any UI claiming "current location" MUST derive from the ledger.

## 2. Root causes

| # | Symptom | Root cause |
|---|---------|-----------|
| a | duplicate floor rows | FE editor never excluded existing placements' floors; BE `addPlacements` had no per-floor uniqueness guard |
| b | UUID displayed | `LockedPlacementRow` / `EditablePlacementRow` render raw `placement.floorId`; `PlacementResponse` carries no name (correct — names resolve client-side from the locations query) |
| c | width regression | f794a3e stacked LocationFloorSelect (`grid-cols-2 gap-4` → `grid-cols-1 gap-2`) + 140px min track, to fix narrow-viewport clickability |
| d | out of sync | Stock Transfer writes ledger rows only; placement rows keep the original floor forever. Editor presents placement rows as current state. Additionally `editPlacement` rewrites the old floor's ledger legs with **no on-hand check** → editing a moved placement can drive the old floor negative (same phantom-negative family as stock-transfer bug #2). |

Already fixed elsewhere (verified in working tree, 2026-07-08 position-picker
workstream): stock-transfer SKU drop, free-text lot, missing on-hand validation
(`INSUFFICIENT_BALANCE_AT_FLOOR` guard in `StockTransferService.create`).

## 3. The fix

### Phase 1 (agents dispatched 2026-07-13, same session)

1. **FE:** `PlacementFieldArray` gains `excludeFloorIds` prop; Place Stock editor
   passes all existing placements' floorIds; `LocationFloorSelect` hides locations
   with zero visible floors; backstop inline error on collision.
2. **BE:** `addPlacements` rejects duplicate floors (within batch AND vs existing
   rows) with `BusinessRuleError` `DUPLICATE_FLOOR_PLACEMENT`; `editPlacement`
   rejects floor changes onto an occupied floor. Quantity-only edits of
   pre-existing duplicate data stay editable.
3. **FE:** floor/location NAMES resolved client-side (locations query) in
   locked/editable placement rows; side-by-side selects restored with
   `minmax(300px,1fr)` first track (outer container scrolls at narrow viewports).

### Phase 2 — ledger-derived current state (the sync fix proper)

4. **FE — "Currently on floors" panel** in the Place Stock editor, fed by
   **existing endpoint `GET /inventory/lots/aggregated?lotNumber=…&qualityId=…`**
   (returns per-floor `{floorId, floorName, locationId, locationName, balance}`
   derived from the ledger; names included; positive-filtered).
   **No shared-contract change, no republish** (same reasoning as position-picker
   design §5).
5. **FE — stale-placement flag:** an existing placement row whose floor's
   ledger balance (from #4) is `< placement.quantity − 0.001` renders a
   "Stock moved — no longer (fully) on this floor" badge and its inline edit form
   is disabled, replaced by a link to Stock Transfer. Both-branch tests required.
6. **BE — edit guard:** `editPlacement` must not drive any (lot, floor) ledger
   balance negative. Before rewriting legs, assert in-tx via
   `findLotLocationBalance`: balance at the OLD floor must cover the reversed
   leg, i.e. `balance ≥ oldQty − (floorUnchanged ? newQty : 0)` (±0.001);
   violation → 422 `INSUFFICIENT_BALANCE_AT_FLOOR` with message pointing at
   Stock Transfer. (The Σ ≤ itemQty guard already covers the bucket side on
   increases.)
7. **E2E — chained tripwire spec** (e2e repo): place → transfer → reopen
   Place Stock: assert current-floor panel shows the destination floor, stale
   badge on the source-floor placement row, edit of moved placement rejected
   (422), duplicate placement to a used floor blocked, and `stock_ledger`
   balances assert the physical truth (per e2e rule: assert against
   stock_ledger, not /inventory).

### Explicitly rejected alternatives

- **Transfers rewriting placement rows** — transfers are per (lot, floor),
  placements per source item; mapping is ambiguous when items share a floor.
  Rewriting history also destroys the put-away audit trail.
- **Warning-banner-only** — leaves two screens disagreeing; patch fix.
- **New BE endpoint / shared field for floor balances** — redundant with
  `/inventory/lots/aggregated`; every new contract is new drift surface.

## 4. Known accepted quirk

Floor exclusion for NEW placements keys off placement rows (one row per floor per
item), not ledger state. If stock is transferred off floor A, floor A remains
excluded for that item's remaining unplaced qty — acceptable: the placement row
still documents the put-away; physical restocking of A happens via Stock Transfer.

## 5. Why this wasn't caught earlier (process record)

Place Stock (reads `placements`) and Stock Transfer (writes `stock_ledger`) were
built in separate workstreams; no chained cross-feature test existed; FE tests run
on MSW fixtures which cannot drift; the E2E suite asserted transfer ledger effects
but never re-opened Place Stock afterwards. Durable prevention = item #7 above.

## 6. Test battery (run after all phases, per 9-gate bar)

BE: lint, typecheck, unit + integration (WIPES fabtraq_dev — re-seed after),
build, coverage. FE: lint, typecheck, unit + integration (MSW schema-validated),
build, coverage. E2E: full Playwright suite against live BE+FE. Re-verify the
original symptoms, not synthetic paths.
