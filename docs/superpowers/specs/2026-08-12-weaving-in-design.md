# Weaving In (Grey Fabric Receipt) — Design Spec

**Date:** 2026-08-12 · **Status:** Final, awaiting Pashwa's review · **Brainstorm:** `docs/brainstorms/2026-08-12-weaving-in.md` (WI-L1…WI-L16)
**Repos touched:** fabtraq-shared, fabtraq-be, fabtraq-fe, e2e. **Predecessor:** `2026-07-30-weaving-dispatch-design.md` (§7 deferred this return leg).

## 1. Summary

Receive woven grey fabric ("taka" rolls) back from a weaver against beams issued via Weaving Dispatch, with **full reconciliation at receipt**: beams drain by meters, weft yarn at-JW drains by derived weight, wastage emerges at beam close. Two new pieces:

- **FabricDesign master** — the fabric-side design vocabulary (challan "Design No", e.g. TATA), distinct from the beam/warp `Design` master (WI-L5).
- **Weaving In transaction** — `FRC-` FY-series challan header + per-taka rows; taka is a first-class entity outside `stock_ledger` (beam precedent, WI-L12).

Also ships two guards on existing code (WI-L14): the shipped `WeavingDispatchService.cancel` beam-status bug, and the `countActiveReceipts` UNION branch closing the WD spec §3.4 "blocked once fabric receipt exists" TODO.

## 2. Schema (fabtraq-be/prisma)

```prisma
model FabricDesign {
  id               String  @id @default(uuid())
  code             String  @unique          // "TATA"
  name             String
  expectedGlm      Decimal? @db.Decimal(8, 2)   // grams per linear meter
  jobRatePerMeter  Decimal? @db.Decimal(10, 2)  // stored only, no billing (WI-L11)
  weftQualityId    String                        // FK yarn_qualities
  weftSkuId        String?                       // FK yarn_skus (optional narrowing)
  isActive         Boolean @default(true)
  beamDesigns      FabricDesignBeamDesign[]      // M:N → Design
  createdAt / updatedAt
}

model FabricDesignBeamDesign {                    // M:N join (WI-L5/WI-L8)
  fabricDesignId String
  designId       String                           // FK designs (beam/warp design)
  @@id([fabricDesignId, designId])
}

model WeavingIn {
  id             String   @id @default(uuid())
  challanNo      String   @unique                 // FRC-… minted in-transaction
  date           DateTime @db.Date
  jobWorkerId    String                           // the weaver
  paperChallanNo String?                          // weaver's challan no (e.g. "149")
  notes          String?
  status         WeavingInStatus @default(received)   // received | cancelled
  // challan total weight = Σ taka.weightKg — computed in app, not stored
  derivedWeftKg  Decimal  @db.Decimal(12, 3)      // computed at save (WI-L7 audit)
  enteredWeftKg  Decimal  @db.Decimal(12, 3)      // what was actually drained
  createdAt / updatedAt / createdBy
  takas          FabricTaka[]
  weftSources    WeavingInWeftSource[]
}

model FabricTaka {
  id             String  @id @default(uuid())
  weavingInId    String
  takaNo         Int                              // per-weaver per-FY gapless (WI-L10)
  // display serial "TK-<FY>/<n>" computed in app from takaNo + header FY — not stored
  paperSerialNo  String?                          // weaver's own serial (390…)
  fabricDesignId String
  loomNo         String?                          // free text (WI-L9)
  cutNotation    String?                          // damage/mends, free text (WI-L2)
  meters         Decimal @db.Decimal(10, 2)
  weightKg       Decimal @db.Decimal(12, 3)
  // GLM = weightKg*1000/meters — ALWAYS computed in app, never stored (research: Avg Wt = GLM×100)
  locationId     String?                          // WI-L12: custody answerable; nullable
  floorId        String?
  beamLinks      WeavingInTakaBeam[]
  @@unique([weavingInId, paperSerialNo])
}

model WeavingInTakaBeam {                          // M:N with attribution (WI-L4)
  takaId          String
  beamId          String
  metersAttributed Decimal @db.Decimal(10, 2)
  @@id([takaId, beamId])
}

model WeavingInWeftSource {                        // WI-L15 — JW-In precedent
  id              String  @id @default(uuid())
  weavingInId     String
  outItemId       String                           // FK jw_challan_out_items (weft)
  consumedQty     Decimal @db.Decimal(12, 3)
  @@unique([weavingInId, outItemId])
}
```

Plus: `WeavingDispatchBeam.beamTotalMeters Decimal?` (WI-L6 — prefilled from `setLength` at issue; backfillable via `updatePrintFields`; **required before first receipt** against that beam).

- **Taka serials:** `ChallanNumberSequence` reused with `prefix='TAKA'`, key string `"<FY>:<weaverId>"` (column is unconstrained; LOT/TXF precedent). Minted inside the create `$transaction` → gapless; cancelled receipts keep their serials (audit).
- **No `StockTransactionType` addition.** Fabric never enters `stock_ledger`; only the weft **drain** writes ledger rows (JW-debit-only, `applyChallanInBeamLedger` row convention).

## 3. Backend behavior

### 3.1 FabricDesign master (`/fabric-designs`)
Standard master module (job-worker anatomy): CRUD, `isActive` toggle, registry-first endpoints in `fabtraq-shared/src/registry/master/fabric-designs.registry.ts`. Roles: owner (write) / all (read) — same as other masters.

### 3.2 Weaving In create (`POST /weaving-ins`, one `$transaction`)
1. Validate: weaver active; every taka's `fabricDesignId` active; every linked beam `status='issued_to_weaver'` AND `weaverId = header weaver` AND `beamTotalMeters` set; `Σ metersAttributed per taka = taka.meters`; per-beam cumulative drain (existing links + this challan) `≤ beamTotalMeters` (small tolerance, +2%).
2. Mint `FRC-` challan no + per-taka serials (gapless, in-transaction).
3. Insert `WeavingIn` + `FabricTaka` + `WeavingInTakaBeam` rows.
4. **Weft drain (WI-L7/WI-L15):** compute `derivedWeftKg = Σ taka.weightKg − Σ(beam.netWeight × metersAttributed / beamTotalMeters)`; guard `enteredWeftKg ≥ 0` (400 if derived < 0 and not corrected); allocate `enteredWeftKg` oldest-first across the weaver's open weaving weft out-items filtered to the fabric designs' weft qualities (per-source rows editable in the form); assert each allocation `≤ stillAtJw` for that out-item; persist `WeavingInWeftSource` rows; write JW-debit ledger rows via new `IInventoryService.applyWeavingInWeftLedger` (sibling #3 of `applyChallanInBeamLedger`).
5. Audit row.

New **reader**: `IInventoryService.getWeavingWeftPositions(jobWorkerId, qualityIds)` → open weaving out-items with `stillAtJwQty` (rollup algebra reuses `getOutItemRollup`, extended to count weaving-in sources) — nothing today reads an at-JW position keyed by job worker with null location.

### 3.3 Cancel (`POST /weaving-ins/:id/cancel`, one `$transaction`)
- Blocked if any linked beam `status='fabric_received'` (reopen beam first, WI-L13).
- Credits back **exactly** the persisted `WeavingInWeftSource` rows (reversal ledger rows; no re-derivation → any-order safe, WI-L16). Deletes nothing; taka rows remain under the cancelled header (serials retained).
- Beam drain reversal is implicit: remaining-meters is computed from links of non-cancelled receipts only.

### 3.4 Beam close / reopen (`POST /beams/:id/close`, `/reopen`)
- Close: `issued_to_weaver → fabric_received` (conditional `updateMany` + count assertion — house pattern); wastage = `beamTotalMeters − Σ metersAttributed` reported, not ledgered. FE auto-suggests close at ≥98% drained.
- Reopen: reverse transition, owner-only.
- `BeamStatus.weaving` stays unused (critic-confirmed harmless).

### 3.5 Guards on existing code (WI-L14)
1. **Shipped P0 fix:** `WeavingDispatchService.cancel` beam restore becomes conditional `updateMany({where:{status:'issued_to_weaver'}}) `+ count assertion (today a `fabric_received`/drained beam silently reverts to `received` and is re-issuable).
2. `countActiveReceipts` (prisma-jw-challan-out.repository.ts) gains a third UNION branch over `weaving_ins`/`weaving_in_weft_sources` — dispatch cancel + weft challan cancel then refuse once a non-cancelled receipt exists (closes WD §3.4 TODO). Additionally `WeavingDispatch.cancel` rejects when any linked beam has taka links.

### 3.6 API (registry-first, B-004)
`registerEndpoint` for: fabric-designs CRUD (master registry); weaving-ins list (paged; filter weaver/design/date/status), getById (takas + beam links + weft sources hydrated), create, cancel (transaction registry). Roles: owner/storekeeper (same as dispatch). Shared: `fabricDesignSchema` + `weavingInSchema` families, `frcNoSchema`/`formatFrcNo`/`isValidFrcNo` triplet in `entry-no.ts`; version bump + publish.

## 4. Frontend (fabtraq-fe)

- **Masters nav → Fabric Designs:** standard master anatomy (list + form; beam-design multi-select, weft quality/SKU selects, expected GLM, job rate).
- **Job Work nav → Weaving In:** `src/features/weaving-ins/` — routes `/weaving-ins`, `/new`, `/:id`.
  - **Form (grid-entry, beam-receipt precedent):** header (weaver, date, paper challan no); challan-level beam picker (weaver's `issued_to_weaver` beams, shows remaining meters; prompts for `beamTotalMeters` if missing); taka grid rows: paper serial, fabric design, loom no, cut, meters, weight, computed GLM cell (flagged red when off `expectedGlm` by >5%); per-row beam-override popover (WI-L4); weft panel: derived kg, editable entered kg + per-source allocation rows with `stillAtJw` ceilings; totals footer (count / meters / weight / aggregate GLM — matches paper footer).
  - **Detail:** print block mirroring the paper challan layout (S.No, L.No, Design, Cut, Meter, Weight, Avg Wt + totals), `window.print()` per house pattern; cancel action role-gated.
- **Beam register/detail:** remaining-meters column (batched app-side computation), close/reopen actions, wastage display.
- **Stock overview:** Fabric tab — computed aggregates per fabric design (taka count, meters, weight), custody split in-house vs by location.
- Role-gated UI ships with both-branch tests; lot/beam pickers use canonical label vocabulary (`lot-labels.ts`).

## 5. Tests

- **BE unit+integration:** create happy path / multi-beam taka / beam-not-issued / missing beamTotalMeters / over-drain beam / negative derived weft / weft allocation exceeding stillAtJw; serial gaplessness + per-weaver-per-FY key; cancel (any order, two receipts same position) asserted against `stock_ledger`; dispatch-cancel guard both branches; `countActiveReceipts` third branch; beam close/reopen races.
- **WD regression:** existing weaving-dispatch + JW-Out suites pass unmodified except the deliberate cancel-guard change (its test updates are part of the fix task, called out explicitly).
- **FE integration:** MSW schema-validated handlers; form both attribution modes; GLM flagging; role both-branch tests; print block renders.
- **e2e (same commits):** full chain — dispatch beams+weft → weaving-in with 2 taka on 1 beam + 1 taka on 2 beams → verify beam remaining + weft `stillAtJw` in Stock Balance → cancel receipt → verify full reversal → re-receive → close beam → verify dispatch cancel now blocked. Live-verified against real BE (contract-validation rule).

## 6. Risks (from the agent debate)

1. **Weft derivation is approximate** (crimp; size pickup is in grey fabric so post-sizing `netWeight` is the right warp basis, but not exact). Mitigation: editable prefill + `≥0` guard + persisted derived-vs-entered delta (WI-L7). Watch the drift report before trusting auto values.
2. **`beamTotalMeters` backfill friction** for already-dispatched beams — the form prompts inline; `updatePrintFields` extended to accept it.
3. **`getOutItemRollup` extension** touches the JW-In pending math — its existing tests must pass unmodified (any edit = behaviour change, stop and re-check).
4. **Two design vocabularies** (Design vs FabricDesign) can drift — the M:N link is the reconciliation; beam pickers on the weaving-in form filter to beams whose design is linked to the row's fabric design, warning (not blocking) on mismatch.

## 7. Out of scope (headroom left)

Taka split / re-grading (child-piece relationship later); checking/grading workflow; fabric sale + dispatch-to-processing (another JW leg reusing this pattern); weaver billing from `jobRatePerMeter`; ITC-04 1-year return flag (backlog); placement/`place-stock` integration for taka (nullable location columns exist; full placement flow later).
