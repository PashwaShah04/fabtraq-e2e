# Fabric Taka Register + per-taka placement — Design Spec

**Date:** 2026-08-14 · **Brainstorm:** `docs/brainstorms/2026-08-14-fabric-taka-register.md` (FTR-L1…L8)
**Follows:** Weaving In (`docs/superpowers/specs/2026-08-12-weaving-in-design.md`) — closes the
unbuilt half of WI-L1.

## 1. Summary

Ship the **taka register**: browse, search and filter individual grey-fabric rolls, plus assign
them to a location/floor. Closes the gap where fabric stock was visible only in aggregate (one row
per fabric design) with no way to find a specific roll and no way to record where it is.

Three surfaces: a paginated register page, a taka detail page, and a bulk "place selected" action.
One new BE service, three new endpoints, **no Prisma migration**.

## 2. Schema (fabtraq-be/prisma)

**No migration.** Every column this feature needs already exists:

| Model | Field | Status today | Used how |
|-------|-------|--------------|----------|
| `FabricTaka` | `locationId`, `floorId` | exist, nullable, **never written** | placement target (FTR-L1) |
| `FabricTaka` | `takaNo`, `paperSerialNo` | written at receipt | search keys (FTR-L2) |
| `FabricTaka` | `meters`, `weightKg`, `loomNo`, `cutNotation` | written at receipt | register columns |
| `WeavingInTakaBeam` | `beamId`, `metersAttributed` | written at receipt | beam provenance on detail |
| `AuditLog` | — | shared table | placement history (FTR-L7) |

`serial` and `glm` remain **computed, never stored** — unchanged from weaving-in spec §2.

## 3. Backend behavior

New `FabricTakaService` + `IFabricTakaRepository` / `PrismaFabricTakaRepository`, living **inside
the existing `weaving-in` module** (`src/modules/weaving-in/`). Rationale: `FabricTaka` is owned by
the weaving-in aggregate, so a second module writing it would invite exactly the cross-context
drift T-CI-1 exists to prevent; and `weaving-in.service.ts` is already 402 lines, so extending it
would break the 500-line rule. New routes mount at `/fabric-takas` via a separate
`fabric-taka.routes.ts`.

No `stock_ledger` access anywhere in this feature — fabric lives outside the ledger (WI-L12).

### 3.1 List (`GET /fabric-takas`)

Paginated (`pageOfSchema`). Filters, all optional and AND-combined:

| Filter | Behaviour |
|--------|-----------|
| `search` | See §3.2 |
| `fabricDesignId` | Exact match |
| `jobWorkerId` | Matches the parent receipt's weaver |
| `placement` | `placed` → `locationId NOT NULL`; `unplaced` → `locationId IS NULL` |
| `status` | Parent receipt status. **Omitted ⇒ `received` only** (FTR-L8) |

Ordering: `takaNo` descending within `weavingIn.date` descending — newest fabric first, stable and
deterministic.

Each row is the existing `fabricTakaResponseSchema` **plus** receipt context: `weavingInId`,
`challanNo` (FRC-), `date`, `jobWorkerId`, `jobWorkerName`. Resolved with the parent `weavingIn`
included in the same query — no N+1.

### 3.2 Search parsing (the one non-obvious piece)

`serial` is computed (`TK-<FY>/<n>`), not a column, so it cannot be matched with a Prisma
`contains`. The service parses the raw input instead and builds an OR:

1. **Always** — `fabricDesign.code contains` OR `fabricDesign.name contains` (both
   `mode: 'insensitive'`, the house pattern from `prisma-yarn-purchase.repository.ts:185-187`).
2. **Always** — `paperSerialNo contains` (the weaver's own series is free text).
3. **If the input contains a parseable integer** — extract the trailing integer group
   (`/(\d+)\s*$/`, so both `390` and `TK-2026-27/390` yield `390`) and add `takaNo equals <n>`.

A bare `390` therefore finds both our taka #390 and a weaver's paper serial 390 — correct, since
the storekeeper does not know which series the number on the roll belongs to. Non-numeric input
searches design and paper serial only.

Empty/whitespace `search` is treated as absent, not as "match nothing".

### 3.3 Get by id (`GET /fabric-takas/:id`)

One taka with `beamLinks` (beam number + meters attributed), location/floor names, computed GLM,
and the same receipt context as the list row. 404 when absent. Cancelled receipts' taka **are**
retrievable by id (a direct link should not break); only the default list filter hides them.

### 3.4 Place (`POST /fabric-takas/place`, one `$transaction`)

Body: `{ takaIds: FabricTakaId[], locationId, floorId }`. Bulk by design (FTR-L5); a single taka is
the degenerate case.

Validation, in order — all failures reject the **whole batch** (no partial placement):

1. `takaIds` non-empty, deduped, ≤ 200 per call.
2. Every id resolves to a real taka → else 404.
3. No taka belongs to a cancelled receipt → else 422 (FTR-L8).
4. `floorId` belongs to `locationId`, and both `Location` and `LocationFloor` are `active` → else
   422. This is the guard that prevents a floor/location mismatch silently storing a nonsense pair.
5. `updateMany` sets `locationId`/`floorId`, asserting the updated count equals `takaIds.length`
   (house rule: status-conditional writes assert their count).
6. One `IAuditRepository.log()` row **per taka**, in the same transaction, `action: 'update'`,
   `entityType: 'FabricTaka'`, with `oldValues`/`newValues` carrying the previous and new
   location/floor ids (FTR-L7).

Re-placing an already-placed taka is the same call and is allowed (FTR-L6) — the audit row's
`oldValues` is what distinguishes a move from a first placement.

### 3.5 API (registry-first, B-004)

Three `EndpointDef`s in `fabtraq-shared/src/registry/transaction/`: list and getById are
`owner|storekeeper|accountant` read; place is `owner|storekeeper` write (CSRF-protected). Routes
are derived by `registerEndpoint` — no hand-rolled middleware chains.

Static-segment ordering: `/place` **must** register before `/:id`, or Express matches it as a uuid
param (same note as `weaving-in.routes.ts`).

## 4. Frontend (fabtraq-fe)

**`/fabric-takas` — register.** `DataTable` + `usePagination`, mirroring `beam-list.page.tsx`.
Columns: Serial, Paper No, Design, L.No, Cut, Meters, Weight, GLM, Location, Receipt (FRC), Weaver,
Date. Search box (debounced via the existing `useDebounce`) plus four filter selects. Row
checkboxes with a select-all-on-page control; a sticky "Place selected (n)" button opens a dialog
with the combined floor+location picker (`{location} · {floor}`, the label shape used by the
weaving-in form and `InventoryLotSelect`). Row click → detail.

**`/fabric-takas/:id` — detail.** Taka fields, computed GLM, a beam-provenance table (beam number →
meters attributed), link to the parent FRC receipt, current location, and a "Move" action reusing
the same placement dialog.

**Stock Balance Fabric tab.** Rows become links to `/fabric-takas?fabricDesignId=<id>`. The tab and
its aggregate are otherwise unchanged.

**Nav.** `Inventory → Fabric Takas`, positioned after `Lots`.

**Role gate.** `canEdit = owner | storekeeper` controls the placement affordances only; the
register and detail are readable by all three roles including accountant. Both-branch tests are
mandatory (standing rule), for the bulk button and the detail Move action.

## 5. Tests

- **shared** — schema unit tests for the new query/input/response schemas, including the
  `takaIds` dedupe/non-empty rules.
- **BE unit** — search-parsing table test (bare number, `TK-…/n`, non-numeric, empty/whitespace);
  placement validation branches 1-6; audit-row shape.
- **BE integration** — list filters and default cancelled-exclusion; placement happy path; the four
  rejection cases; re-placement updating both columns and writing a second audit row.
- **FE unit** — filter→query mapping, search debounce.
- **FE integration** — MSW-backed, every response `jsonValidated`: list renders and paginates,
  search narrows, bulk selection + place round-trip, role both-branch for owner/storekeeper/
  accountant, Fabric-tab row links carry the design filter.
- **e2e (live)** — one chain: receive a multi-taka weaving-in → register lists the taka → find one
  by the weaver's paper serial → bulk-place two → Fabric tab Placed/Unplaced split moves by exactly
  two → re-place one to a different floor → detail page shows beam provenance → cancel the receipt
  → those taka leave the default register view.

## 6. Risks

1. **Search ambiguity is deliberate** — a bare number can match both a system `takaNo` and a
   different taka's `paperSerialNo`, returning two rows. This is intended (FTR-L2); the register
   shows both serial columns so the operator disambiguates visually. Documented, not "fixed".
2. **Bulk placement is all-or-nothing.** Selecting 50 taka where one belongs to a cancelled receipt
   rejects all 50. Chosen over partial success because a partially-applied bulk write is far harder
   to reason about; the error names the offending taka.
3. **No ledger means no reconciliation.** Fabric placement cannot be cross-checked against
   `stock_ledger` the way yarn placement can. This is the accepted consequence of WI-L12; the audit
   log is the only history.
4. **Pre-existing unbounded aggregate.** `findActiveTakasForFabricStock` loads every non-cancelled
   taka. The register is paginated and does not worsen it, but the Fabric tab will degrade as
   receipts accumulate → backlog **B-022**.

## 7. Out of scope (headroom left)

Taka split / re-grading; checking & grading workflow; fabric sale / dispatch-to-processing; weaver
billing from `jobRatePerMeter`; ITC-04 1-year return flag; barcode/label printing; a fabric
movement report over the audit rows; integrating fabric into the `/place-stock` queue (deliberately
separate — see brainstorm "Placement is not place-stock").
