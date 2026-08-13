# Fabric Taka Register + per-taka placement — Design Spec

**Date:** 2026-08-14 · **Brainstorm:** `docs/brainstorms/2026-08-14-fabric-taka-register.md` (FTR-L1…L14)
**Follows:** Weaving In (`docs/superpowers/specs/2026-08-12-weaving-in-design.md`) — closes the
unbuilt half of WI-L1.
**Revision:** v2, amended after a three-agent design debate (critic / domain / simplification
advocate). §2's original premise was factually wrong and §4's core interaction did not exist; both
are corrected below. Amendments are marked **[v2]**.

## 1. Summary

Ship the **taka register**: browse, search and filter individual grey-fabric rolls, and record
where each one is. Closes the gap where fabric stock was visible only in aggregate with no way to
find a specific roll.

**[v2] Location is captured at receipt, not only in the register.** The weaving-in form gains a
header location/floor that defaults every taka row on save; the register is the *correction and
move* surface. Without this the register ships permanently reading "Unplaced" — nobody re-enters a
location on a second screen for rolls they have already put on a rack.

Surfaces: a paginated register, a taka detail page, a bulk place/move action, and one new field on
the existing receipt form. **No Prisma migration.**

## 2. Schema (fabtraq-be/prisma)

**No migration.** Every column already exists:

| Model | Field | Status today | Used how |
|-------|-------|--------------|----------|
| `FabricTaka` | `locationId`, `floorId` | exist, nullable, **accepted and persisted by `POST /weaving-ins` but never validated, and never populated by any client** | placement target |
| `FabricTaka` | `takaNo`, `paperSerialNo` | written at receipt | search keys |
| `FabricTaka` | `meters`, `weightKg`, `loomNo`, `cutNotation` | written at receipt | register columns |
| `WeavingIn` | `date` | written at receipt | days-in-stock (**not** `FabricTaka.createdAt`, which is data-entry time; ageing starts when the fabric arrived) |
| `WeavingInTakaBeam` | `beamId`, `metersAttributed` | written at receipt | beam provenance |
| `AuditLog` | — | shared table | placement history |

**[v2] Correction — the create path is live and unguarded.** The original spec claimed these
columns were "never written". They are: `createFabricTakaSchema` accepts `locationId` and `floorId`
as *independent* optionals (`fabtraq-shared/src/schemas/transaction/weaving-in.ts:54-55`), the
service passes them through (`weaving-in.service.ts:338-339`) and the repository persists them
(`prisma-weaving-in.repository.ts:123-124`). No superRefine relates them and `createTx` performs no
location validation at all — contrast its weaver-active (`:176-182`) and design-active (`:184-197`)
checks. So `POST /weaving-ins` today accepts an inactive location, a floor belonging to a different
location, or a floor with a null location. Latent only because no client sends them
(zero hits across `fabtraq-fe/src/features/weaving-ins/`). §3.0 closes this.

An orphan floor (floor set, location null) would render as **Unplaced while carrying a floor**,
since §3.1 keys `placement` off `locationId` and `findActiveTakasForFabricStock` reads `locationId`
only (`prisma-weaving-in.repository.ts:174`).

**No index is added.** `fabric_takas` carries only `@@index([weavingInId])` and
`@@unique([weavingInId, paperSerialNo])`; ordering by `weavingIn.date` and filtering on
`takaNo`/`locationId` are unindexed. Correct without a migration, but the access paths are
unsupported — revisit if the register slows.

`serial` and `glm` remain computed, never stored.

## 3. Backend behavior

**[v2] One new service, no new repository.** `FabricTakaService` is new (the 500-line rule
genuinely applies: `weaving-in.service.ts` is 402 lines). The three data methods go on the
**existing** `IWeavingInRepository` / `PrismaWeavingInRepository` (143 / 190 lines), which already
queries `prisma.fabricTaka` in `findActiveTakasForFabricStock` and already defines `FabricTakaRow`
and `FabricTakaBeamLinkRow`. No module in this codebase splits one aggregate across two
repositories, and a second repository writing `fabricTaka` is the exact cross-context drift the
original rationale wanted to avoid.

Routes live in a new `fabric-taka.routes.ts` — required, not optional, because
`weaving-in.routes.ts:19` hard-codes `MOUNT_PREFIX = '/weaving-ins'` and one router serves one
prefix.

No `stock_ledger` access anywhere. T-CI-1's allowlist already contains `src/modules/weaving-in/`.

### 3.0 [v2] Capture and validate location at receipt

**Shared:** cross-refine `createFabricTakaSchema` so `locationId` and `floorId` are **both-or-
neither**. A floor without a location is rejected at the wire boundary.

**BE (`createTx`):** when any taka carries a location, validate once per distinct pair — the
`LocationFloor` exists, its `locationId` matches, and both `Location.status` and
`LocationFloor.status` are `active`. Reject the whole receipt otherwise (422). This is the same
check §3.4 applies, so it lives in one shared private helper used by both paths — the standing
B-016 rule: guards belong on the create path *and* the edit path.

**FE:** the weaving-in form header gains a `LocationFloorSelect`. It is **optional** — a receipt
can still be entered without knowing the rack — and whatever is chosen is applied to every taka row
in the submitted payload. Per-row override is explicitly *not* added; the register handles the rare
case of one roll going elsewhere.

### 3.1 List (`GET /fabric-takas`)

Paginated. Filters, optional, **AND**-combined (the `search` OR-group nests inside the AND — the
likeliest implementation bug is hoisting it to the top level and OR-ing the filters away):

| Filter | Behaviour |
|--------|-----------|
| `search` | §3.2 |
| `fabricDesignId` | Exact |
| `jobWorkerId` | Parent receipt's weaver. **[v2] Load-bearing** — see §3.2 |
| `weavingInId` | **[v2]** Exact. Lets the receipt page link "these 13 taka" |
| `placement` | `placed` → `locationId NOT NULL`; `unplaced` → IS NULL |
| `status` | `received` \| `cancelled` \| **[v2]** `all`. Omitted ⇒ `received` |

**[v2] Ordering:** `weavingIn.date` desc, `takaNo` desc, **`id` asc**. The final tiebreak is
required for correctness, not neatness: `takaNo` is per-weaver-per-FY, and `weavingIn.date` is a
`date` not a timestamp, so ties are common — without a unique final key, LIMIT/OFFSET pages
duplicate and skip rows between requests.

**[v2] Row shape:** `fabricTakaRegisterRowSchema` = `fabricTakaResponseSchema.omit({beamLinks:true})
.extend({weavingInId, challanNo, paperChallanNo, date, jobWorkerId, jobWorkerName})`. `beamLinks` is
a to-many join and is only rendered on detail; omitting it avoids hydrating it for up to 200 rows.

### 3.2 Search

**[v2] Reframed.** The original called serial-parsing "the one non-obvious piece", implying it
approximates an exact match. There is no exact match to approximate: `takaNo` is unique only per
(FY, weaver), so `TK-2026-27/390` identifies up to one taka *per weaver*. Extracting the integer is
exactly as precise as the serial itself. The parse **is** the design.

```ts
const n = Number(/(\d+)\s*$/.exec(search)?.[1]);
where.AND.push({ OR: [
  { fabricDesign: { code:  { contains: search, mode: 'insensitive' } } },
  { fabricDesign: { name:  { contains: search, mode: 'insensitive' } } },
  { paperSerialNo:         { contains: search, mode: 'insensitive' } },
  { weavingIn: { challanNo:      { contains: search, mode: 'insensitive' } } },
  { weavingIn: { paperChallanNo: { contains: search, mode: 'insensitive' } } },
  ...(Number.isInteger(n) && n <= 2147483647 ? [{ takaNo: { equals: n } }] : []),
]});
```

**[v2] Both challan numbers are search keys.** The mill's daily handle is the lot, and the lot is
the challan — *"Vinayaka ka 149 ka maal"*. A register that cannot answer "show me everything on 149"
does not match how the goods are stacked.

The `2147483647` bound is **not** optional: `takaNo` is Postgres `int4`, and an overflowing number
typed into a search box would otherwise surface as a 500. Validation at a trust boundary.

Empty/whitespace `search` is absent, not "match nothing". All joins are to-one, so the OR cannot
fan out duplicate rows.

### 3.3 Get by id (`GET /fabric-takas/:id`)

Returns `fabricTakaRegisterRowSchema.extend({beamLinks})` — same shape as a list row plus the beam
provenance. 404 when absent. Cancelled receipts' taka **are** retrievable by id; only the default
list filter hides them.

### 3.4 Place / move (`POST /fabric-takas/place`, one `$transaction`)

Body `{ takaIds, locationId, floorId }` — **[v2] both location and floor required** (never a
partial pair, closing the orphan-floor state §2 describes).

1. `takaIds` non-empty, deduped, **[v2] ≤ 50**. Reduced from 200: step 5 writes one audit row per
   taka inside one interactive transaction, whose Prisma default timeout is 5 s. A real challan is
   13 taka, so 50 costs nothing and removes a speculative `P2028`. **[v2] Do not add `logMany` to
   `IAuditRepository`** — a bulk method on a shared interface for one speculative caller is added
   surface, not saved work.
2. Every id resolves → else 404.
3. `floorId` belongs to `locationId`, both `active` → else 422. Same helper as §3.0.
4. **[v2]** `updateMany({ where: { id: { in: takaIds }, weavingIn: { status: { not: 'cancelled' } } }, … })`,
   asserting the updated count equals `takaIds.length`. Folding the cancelled check **into the
   write** closes a TOCTOU window: read-committed lets a concurrent `cancel` commit between a
   separate check and the update. A prior read is still worth doing, but only to name the offending
   taka in the error message.
5. **[v2]** One `AuditService.record('update', 'FabricTaka', id, old, new, {...ctx, tx})` per taka —
   **not** `IAuditRepository.log()` directly. `AuditService` threads `userId` and `ipAddress` off
   request context; calling the repository directly makes the new service hand-assemble those and
   is the easy way to silently drop the IP. Every weaving-in write already uses it
   (`weaving-in.service.ts:108, 382`).

Re-placing an already-placed taka is the same call (FTR-L6); `oldValues` distinguishes a move from
a first placement.

### 3.5 [v2] Cancel clears placement

`WeavingInService.cancel` additionally nulls `locationId`/`floorId` for that receipt's taka, inside
its existing `$transaction`, writing the same per-taka audit rows as §3.4.

Without this, FTR-L8's rule holds in only one temporal order: placing under a cancelled receipt is
refused, yet cancelling a placed receipt produces exactly that row. It also leaves §3.3's detail
page rendering a location beside a Move action that §3.4 would refuse — a deliberate dead end — and
leaves the audit log's last word on the roll a location the system elsewhere denies.

This does **not** corrupt any total: `findActiveTakasForFabricStock` already filters
`weavingIn.status != 'cancelled'`, so the Fabric tab was always right. It is a state-consistency
fix, not an arithmetic one. It means touching `weaving-in.service.ts`, which §3's framing otherwise
avoids — stated explicitly so it is not a surprise in review.

### 3.6 API (registry-first, B-004)

Three `EndpointDef`s: list and getById readable by all roles; `place` is `owner|storekeeper` (matches
`role.ts`'s own docstring — accountant has "no master CRUD, placements, transfers"), CSRF-protected.
`/place` **must** register before `/:id`.

## 4. Frontend (fabtraq-fe)

**[v2] Feature folder:** everything lives in the existing `features/weaving-ins/`, extending its
`api.ts` / `hooks.ts` / `query-keys.ts`. Fabric-domain hooks already live there and are already
consumed cross-feature (`useFabricStockAggregate` ← `inventory-balance.page.tsx:21`), mirroring the
BE's aggregate-ownership decision. Routes remain `/fabric-takas`; URL and folder need not match.

**[v2] Templates — not `beam-list.page.tsx`.** That page holds filters in `useState` with no URL
state, so FTR-L3's `?fabricDesignId=` deep link would be silently ignored. Use
`features/placements/place-stock-queue.page.tsx:16-107` (URL `search` + `useDebounce` + pagination +
`DataTable` + `RoleGuard`) and `features/inventory/inventory-lots.page.tsx:36-160` for the
multi-filter `PARAM`/`buildQuery`/`setParams` machinery — including its documented `:98-105` bug
about two sequential `setSearchParams` calls clobbering each other.

**`/fabric-takas` — register.** Columns: Roll (§4 identifier), Paper No, Design, L.No, Cut, Meters,
Weight, GLM, **Days in stock** (from `date`, the receipt date — NOT `createdAt`: the column measures physical ageing on the rack, which starts when the fabric arrived, not when the row was typed in. Grey yellows, and FIFO is physical), Location,
Receipt, Weaver, Date.

- **[v2] Search box already exists** — `DataTable`'s own `search`/`onSearchChange` props
  (`DataTable.tsx:34-35, 81-92`, accessible name "Search records"). Zero new markup.
- **[v2] Selection state lives in the page, not `DataTable`.** `DataTable` reads
  `row.getIsSelected()` (`:160`) but exposes no selection props and nothing ever sets it — the
  interaction did not exist. Hold a `Set<FabricTakaId>` in the page and render a native
  `<input type="checkbox">` in a column cell (precedent: `job-worker-form.page.tsx:279-289`; there
  is no shadcn Checkbox in this repo). `DataTable` sits behind ~15 pages and is not worth the
  regression surface. The cell must `stopPropagation` so it does not trigger `onRowClick`.
- **[v2] Running totals on the current selection** — `n taka · X m · Y kg`. "Make up 500 m of TATA"
  is the daily job and the arithmetic happens on a phone today.
- "Place selected (n)" opens `PlaceTakaDialog`.

**[v2] Identifier display.** Show `FRC-2026-27-005 / 396` — our challan plus the weaver's serial —
not the colliding `TK-<FY>/<n>`. `challanNo` is `@unique` and `@@unique([weavingInId,
paperSerialNo])` holds within a receipt, so the pair is globally unique, and it is what the mill
says out loud. **`paperSerialNo` is nullable** (deliberate, WI-L2 — not every weaver numbers every
roll; all four taka in the current database are null), so fall back to `FRC-… / #<takaNo>`. The
`TK-` serial stays available on detail as a secondary line.

**[v2] `PlaceTakaDialog`** uses `shared/components/LocationFloorSelect.tsx` verbatim — it
self-fetches active locations and already clears the floor when the location changes; pass only the
four props. **Not `AvailableFloorSelect`**, whose `AvailableFloor.available: number` is yarn
position data; feeding it a fabricated number would drag fabric into the ledger-backed inventory
context WI-L12 exists to keep it out of. Model the dialog on
`features/jw-challans-out/components/CloseAsLossDialog.tsx`.

**`/fabric-takas/:id` — detail.** Reuse the local `Field`/`Section` helpers from
`beam-detail.page.tsx:49-66` by copying (~18 lines; `weaving-in-detail.page.tsx:243-250` already has
its own copy — three small copies beat one component with three prop shapes). Beam provenance is
`taka.beamLinks.map(...)`, already on the response — **do not** reuse `ProvenanceSection`
(`:88-120`), which re-fetches a parent receipt.

**Stock Balance Fabric tab.** Rows link to `/fabric-takas?fabricDesignId=<id>`. **[v2]** Relabel the
count column "Received", not "In stock" — nothing yet records fabric leaving, and the honest label
pre-empts a storekeeper inventing a "Sent to Processor" location and overloading `locationId`.

**Nav.** `Inventory → Fabric Takas`, after `Lots`.

**Role gate.** `canEdit = owner | storekeeper` gates placement affordances only. Both-branch tests
mandatory for the bulk button and the detail Move action.

## 5. Tests

**[v2] Reuse the house sweeps rather than writing bespoke equivalents:** add `/fabric-takas` to
`e2e/tests/smoke/routes.spec.ts`'s ROUTES array (one line) and to
`e2e/tests/guards/role-guards.spec.ts` (one entry); add the `place` row to
`fabtraq-be/tests/integration/permissions-matrix.routes.test.ts` rather than a bespoke 403 test.
Start the e2e chain from the existing multi-taka fixture in `tests/flows/weaving-in.spec.ts`.

- **shared** — only the new/extended fields and the `takaIds` non-empty/dedupe/≤50 rules; the
  inherited shape is already covered. Plus the both-or-neither location/floor refinement (§3.0).
- **BE unit** — search-parse table (bare number, `TK-…/n`, non-numeric, empty, int4 overflow);
  placement validation branches; the shared location/floor helper.
- **BE integration** — **[v2]** filters AND search *combined* (catches the hoisted-OR bug);
  **[v2]** page 1 ∪ page 2 contains no duplicate ids over a tie-heavy fixture (catches the ordering
  bug); **[v2]** two weavers both holding taka #390; default cancelled-exclusion; placement happy
  path and each rejection; re-placement writing a second audit row; **[v2]** the step-4 count
  assertion; **[v2]** `createTx` rejecting an inactive/mismatched location.
- **FE integration** — MSW-backed, `jsonValidated`: list renders/paginates, search narrows,
  selection + place round-trip, running totals, role both-branch, Fabric-tab link carries the
  filter, receipt-form location applies to every row.
- **e2e (live)** — receive with a header location → register lists the taka as placed → find one by
  the weaver's paper serial → move two to another floor → Fabric tab placed/unplaced split moves →
  detail shows beam provenance → cancel the receipt → **[v2] assert `locationId` is null** and the
  taka leave the default view.

## 6. Risks

1. **[v2] Search returns up to one row per weaver.** `takaNo` is unique only per (FY, weaver), so a
   numeric search legitimately returns several rows, and two of them can render an identical
   `TK-2026-27/1`. Mitigated by the `FRC-… / serial` identifier (§4) and by the **Weaver filter,
   which is therefore load-bearing, not optional** — place it adjacent to the search box. The
   original spec understated this as a `takaNo`↔`paperSerialNo` collision and wrongly claimed the
   two serial columns disambiguate; against a cross-weaver collision they do not.
2. **Bulk placement is all-or-nothing.** 50 taka with one cancelled rejects all 50. A
   partially-applied bulk write is harder to reason about; the error names the offending taka.
3. **No ledger means no reconciliation.** Fabric placement cannot be cross-checked against
   `stock_ledger`. Accepted consequence of WI-L12; the audit log is the only history.
4. **Pre-existing unbounded aggregate** → backlog **B-022**.
5. **[v2] Nothing records fabric leaving the godown.** Pre-existing, not created here —
   `findActiveTakasForFabricStock` already treats every non-cancelled taka as on hand. Mitigated
   only by honest labelling (§4) → backlog **B-023**.

## 7. Out of scope (headroom left)

Taka split; grading; fabric sale / dispatch-to-processing; weaver billing; ITC-04 flag; barcode
labels; a movement report over the audit rows; `/place-stock` queue integration (deliberately
separate). **[v2]** Also deferred, logged as **B-024** from the debate: a declared taka count and
declared lot meters/weight on the receipt header, validated against the grid sum — the paper challan
carries both (a hand-written "13 Taka" and a separately-weighed `(13) 168.100` beside the derived
`1787 / 167.66`), and mills reconcile declared against derived precisely because they disagree.
Filtering/sorting on `cutNotation` (the mill's own quality shorthand, ~80% of grading for free) is
**B-025**.
