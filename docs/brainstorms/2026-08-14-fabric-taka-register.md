# Fabric Taka Register + per-taka placement — brainstorm locked decisions

**Date:** 2026-08-14 · **Session:** `session_01XDj53MdB2b3LTTfy5yjxfs`
**Follows:** Weaving In (`docs/brainstorms/2026-08-12-weaving-in.md`).
**Origin:** user question during manual testing — *"where is the page of fabric taka where I can see all the stock? Is this not mentioned in any plan?"*

## Why this exists

WI-L1 locked **"Taka-level register + aggregate view."** Weaving In shipped the data model
(`fabric_takas`, individually numbered, source of truth) and the aggregate view (Stock Balance →
Fabric tab, one row per fabric design). It never shipped the *register* half: there is no way to
browse or search individual taka, and no BE endpoint that queries `fabric_takas` directly. A taka
is visible only inside its own receipt detail page; even the beam detail page does not list the
taka produced from that beam.

This was not a deliberate deferral. Spec §7 of the weaving-in design enumerates what was
consciously left out — taka split, grading, fabric sale, weaver billing, ITC-04, taka placement
flow — and a taka register is not among them. It fell through the gap between "receipt entry" and
"stock overview".

The `locationId` / `floorId` columns on `FabricTaka` are the corroborating tell: the schema
anticipates per-taka placement, but nothing reads or writes them, so every taka in the system
currently reports as unplaced.

## Decisions locked with Pashwa, in order

- **FTR-L1 — Placement is IN scope, not read-only.** The register ships together with the ability
  to assign a taka to a location/floor. A register that permanently reports every roll as
  "Unplaced" answers "which rolls do I have" but not "where is it", and the columns already exist.
  This deliberately overrides weaving-in spec §7, which deferred "placement/`place-stock`
  integration for taka".
- **FTR-L2 — One search box, three keys.** A single input matches the **system serial**
  (`TK-2026-27/12`), the **weaver's paper serial** (390, 391 — what is physically written on the
  roll and on the paper challan), and the **fabric design code/name**. The storekeeper types
  whatever number is on the roll in front of them; the system works out which key it is.
- **FTR-L3 — Own page + drill-down.** New `/fabric-takas` route under the **Inventory** nav group.
  Clicking a row in the Stock Balance Fabric tab opens it pre-filtered to that design. The
  aggregate answers *how much*; the register answers *which rolls*. The Fabric tab stays.
- **FTR-L4 — Dedicated taka detail page** at `/fabric-takas/:id`: the taka's own fields, computed
  GLM, its beam provenance (which beams it was woven from and how many meters attributed to
  each), a link to the parent FRC receipt, and its current location with a Move action.
- **FTR-L5 — Bulk placement is the primary flow.** Checkboxes on the register; select any number
  of taka and assign one location/floor in a single action. Fabric arrives a whole lot at a time
  (the sample challan is 13 taka) and physically goes to one rack. Single-taka placing is the
  degenerate case of the same action.
- **FTR-L6 — Placement is freely re-assignable.** Fabric does get shifted between racks, and
  because taka live **outside `stock_ledger`** (WI-L12) placing is a plain column write — there
  are no ledger rows to reverse and no double-count risk. Re-assignment is the same operation as
  first placement, not a separate "move" transaction.
- **FTR-L7 — Placement history comes from the existing audit log,** not a new table. Each placed
  taka writes one `AuditLog` row through the shared `IAuditRepository.log()` with old→new
  location in `oldValues`/`newValues`. No new schema, and "who moved this roll and when" is
  answerable.
- **FTR-L8 — Cancelled receipts' taka are excluded by default,** matching
  `findActiveTakasForFabricStock` (which already filters `weavingIn.status != 'cancelled'`). A
  status filter can surface them explicitly. Placing a taka under a cancelled receipt is refused —
  a receipt that did not happen has no fabric to put on a rack.

## Decisions added after the design debate (2026-08-14)

Three agents reviewed the v1 spec — an adversarial critic verifying every claim against shipped
code, a domain reviewer judging it against real Bhiwandi godown practice, and a simplification
advocate hunting for reinvention. They produced these:

- **FTR-L9 — Location is captured on the weaving-in receipt header, not only in the register.**
  The receipt form gains an optional location/floor that defaults every taka row on save; the
  register becomes the *correction and move* surface. **Why:** the v1 workflow was "unload the
  tempo, type a 13-row challan, save, navigate to another page, find those same rows, tick 13
  boxes, re-enter a location you knew while the rolls were being put down." The storekeeper does
  that for a week and then stops, and the register reports Unplaced forever — rebuilding the exact
  problem it exists to solve. Per-row override is deliberately NOT added; the register handles the
  rare split.
- **FTR-L10 — The create path gets the same location guard as the placement endpoint.**
  `POST /weaving-ins` already accepts and persists `locationId`/`floorId` with zero validation, so
  an inactive location, a mismatched floor, or a floor with no location all store today. One shared
  helper serves both paths — the B-016 standing rule (guards belong on create AND edit).
- **FTR-L11 — The roll's identifier is `FRC-<challan> / <weaver serial>`, not `TK-<FY>/<n>`.** The
  minted serial collides: the sequence restarts per weaver per financial year and the display format
  carries no weaver, so two weavers both produce `TK-2026-27/1`. A colliding string in an identifier
  slot is worse than no label. The challan+serial pair is provably unique and is what the mill
  actually says on the phone — *"149 ka 396"*. Falls back to `FRC-… / #<takaNo>` where the weaver
  gave no serial (currently every taka in the database). Chosen over renumbering, which would
  reopen WI-L10 and break continuity with numbers already written down.
- **FTR-L12 — Cancelling a receipt clears its taka's placement.** FTR-L8 refuses placement under a
  cancelled receipt; without this, cancel-after-place produces exactly that state. A guard that
  holds in only one temporal order is not a guard.
- **FTR-L13 — Both challan numbers are search keys, and `weavingInId` is a filter.** The operator's
  daily handle is the lot, and the lot is the challan. A register that cannot answer "show me
  everything on 149" does not match how the goods are stacked.
- **FTR-L14 — The weaver filter is load-bearing, not optional.** Since `takaNo` is unique only per
  (FY, weaver), a numeric search returns up to one row per weaver. The weaver filter is the
  disambiguation mechanism and sits next to the search box.

**Rejected from the debate:** adding a weaver code to the minted serial (changes shipped display
for a bigger win than this feature needs); a global per-FY renumber (migration + breaks written-down
numbers); `logMany` on `IAuditRepository` (shared-interface surface for one speculative caller);
row selection inside `DataTable` (~15 pages of regression surface — selection state stays in the
register page).

## Consequences worth stating

**No Prisma migration.** `FabricTaka.locationId`/`floorId` and the `FabricDesign` master already
exist. This workstream is read paths plus one write to columns that are already there — unusual
for a feature this size, and the reason it is cheap.

**The system serial cannot be searched with a `contains`.** `serial` (`TK-<FY>/<n>`) is *computed*
BE-side from `takaNo` + the header's financial year and never stored (weaving-in spec §2). The
search therefore parses the input rather than pattern-matching a column — see design spec §3.2.
This is the single non-obvious piece of this feature.

**Placement is not `place-stock`.** The yarn placement queue (`/place-stock`, `Placement` table,
`StockTransactionType.placement`) is a ledger-backed bounded context. Fabric placement shares the
vocabulary and the location/floor picker, but none of the machinery — no queue, no ledger rows, no
`placementStatus`. Conflating them would drag fabric into `stock_ledger` and undo WI-L12.

## Out of scope (headroom left)

Taka split / re-grading; checking & grading workflow; fabric sale / dispatch-to-processing;
weaver billing from `jobRatePerMeter`; ITC-04 1-year return flag; per-taka barcode/label printing;
a fabric movement *report* (the audit rows exist, a report over them does not).

## Known debt, logged not fixed

`findActiveTakasForFabricStock` fetches **every** non-cancelled taka row unbounded to build the
Fabric tab aggregate. Correct today and consistent with the house "compute in app, never aggregate
in DB" rule, but it degrades as receipts accumulate. The register itself is paginated and does not
add to this. Logged as backlog (B-022), not addressed here.
