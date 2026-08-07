# Weaving Dispatch — Design Spec

**Date:** 2026-07-30 · **Status:** Final, awaiting Pashwa's review · **Brainstorm:** `docs/brainstorms/2026-07-30-weaving-dispatch.md` (WD-L1…WD-L12)
**Repos touched:** fabtraq-shared, fabtraq-be, fabtraq-fe, e2e.

## 1. Summary

A new **Weaving Dispatch** feature: one page dispatches finished beams + weft yarn to a weaver (job worker) in a single transaction, producing two printable challans with independent number series:

- **Job Work Beam Issue** — new `JWB-` FY series, owned by the new `weaving_dispatches` aggregate.
- **Job Work Delivery Weft Purpose** — a real `JwChallanOut` (`jobWorkTypes=['weaving']`, normal `JWO-` number), linked by FK.

Either half may be empty (WD-L1). Both halves share one header: job worker, date, transporter?, vehicle? (WD-L2). Return leg (fabric receipt) is out of scope (WD-L7).

## 2. Schema (fabtraq-be/prisma)

```prisma
model WeavingDispatch {
  id               String   @id @default(uuid())
  date             DateTime @db.Date
  jobWorkerId      String                    // FK job_workers
  transporterId    String?                   // FK transporters
  vehicleNumber    String?
  status           WeavingDispatchStatus @default(sent)  // sent | cancelled
  beamChallanNo    String?  @unique          // JWB-… minted iff beam rows exist
  beamValueOfGoods Decimal? @db.Decimal(14, 2)
  beamNotes        String?
  weftChallanOutId String?  @unique          // FK jw_challans_out; null iff no weft rows
  createdAt / updatedAt / createdBy
  beams            WeavingDispatchBeam[]
}

model WeavingDispatchBeam {
  id               String   @id @default(uuid())
  dispatchId       String                    // FK weaving_dispatches
  beamId           String                    // FK beams
  grossWeight      Decimal? @db.Decimal(12, 3)   // WD-L5, optional
  pipeWeight       Decimal? @db.Decimal(12, 3)   // WD-L5, optional
  previousWeaverId String?                   // beam.weaverId before issue (for cancel restore)
  sortOrder        Int
  @@unique([dispatchId, beamId])
}
```

- **No snapshots**: printed columns (beam no, D.no = `design.code`, ends, reed, cut, nett wt) read by join `Beam → BeamReceiptItem → Design`. Designs are immutable (BR spec); beams effectively so post-receipt.
- **No ledger rows for beams** (existing precedent: beams live outside `stock_ledger`). No new `StockTransactionType`, no new `PlacementSourceType`.
- Constraint: at least one of (≥1 beam row, weft challan) per dispatch — service-level rule.

## 3. Backend behavior

### 3.1 Create (`POST /weaving-dispatches`, one `$transaction`)
1. Validate refs (job worker active, transporter, beams exist).
2. **Beam half** (if rows): guard against double-issue with the house pattern — `updateMany({ where: { id: { in: beamIds }, status: 'received' }, data: { status: 'issued_to_weaver', issuedDate, issuedChallanNo, weaverId: <dispatch job worker> } })`; if `count !== beamIds.length` → `BusinessRuleError` (some beam already issued/cancelled). `previousWeaverId` written unconditionally per row (WD-L6/WD-L8). Mint `JWB-` via a new `entry-no.ts` triplet + `nextEntrySequence` (prefix `JWB`).
3. **Weft half** (if rows): call extracted `JwChallanOutService.createIn(tx, …, { jobWorkTypes: ['weaving'] })` — reuses `assertLotInputStates`/`assertLotBalances`/`mintPlacements`/`applyChallanOutLedger` untouched. Yarn shows at-JW under the weaver in Stock Balance (B-015 custody) for free.
4. Audit row.

### 3.2 JW-Out boundary guards (new)
- Public `create` rejects `jobWorkTypes.includes('weaving')` → "Weaving challans are created via Weaving Dispatch." (Closes the live footgun: `JobWorkTypeMultiSelect` rendered Weaving, inert only because the old predicate rejected every lot.)
- Public `cancel`/`updateHeader` reject challans referenced by a `WeavingDispatch` → operate on the dispatch instead.
- Refactor: extract `createIn`/`cancelIn`/`updateHeaderIn` (tx-taking internals; Prisma interactive transactions don't nest). **Behaviour-neutral: the existing JW-Out service test suite must pass unmodified.** FE: remove `weaving` from `JobWorkTypeMultiSelect` options.

### 3.3 L18 predicate correction (fabtraq-shared)
`isValidInputState` case `weaving`: was `P.has('sizing') && !P.has('weaving')` (dead path — sizing output becomes a beam entity, never a sized yarn lot). Becomes `!P.intersects(['warping','sizing','weaving'])` → any non-beam-track lot is valid weft (WD-L3). `warping`/`sizing` cases untouched (blanket change would break the shipped sizing-JW beam-receipt flow). JW-In eligibility is already safe: `findEligibleOutItems` excludes beam-track challans, so weft outs never appear claimable in the yarn JW-In picker.

### 3.4 Cancel (`POST /weaving-dispatches/:id/cancel`, one `$transaction`)
- Weft: `cancelIn` (full ledger reversal, existing pattern).
- Beams: revert `status → 'received'`, clear `issuedDate`/`issuedChallanNo`, restore `weaverId = previousWeaverId` unconditionally.
- Dispatch `status → cancelled`. Future: blocked once fabric receipt exists.

### 3.5 Edit while sent (`PATCH /weaving-dispatches/:id/print-fields`)
Editable (WD-L11): per-beam `grossWeight`/`pipeWeight`, `beamValueOfGoods`, weft `valueOfGoods`, notes — one endpoint spanning both halves. Everything else frozen (cancel + recreate; a re-minted JWB- must not silently diverge from paper in transit).

### 3.6 API (registry-first, B-004)
`registerEndpoint` for: list (paged, filter by job worker/status/date), getById (joined beam rows + weft challan), create, cancel, update-print-fields. Roles: owner/storekeeper (same as JW-Out). Shared package: `weavingDispatchSchema` family + `jwbNoSchema`/`formatJwbNo`/`isValidJwbNo`; version bump + publish.

## 4. Frontend (fabtraq-fe)

New feature `src/features/weaving-dispatches/`:
- **Routes:** `/weaving-dispatches` (list), `/new` (form), `/:id` (detail). Nav under Job Work.
- **Form:** header (job worker, date, transporter?, vehicle?) + two optional sections:
  - *Beams:* picker of `status='received'` beams (default-filtered to chosen weaver, toggleable to all — WD-L6), rows show beamNo/design/ends/reed/cut/netWt with editable gross/pipe wt inputs; running totals (count, cut, net wt); `beamValueOfGoods`.
  - *Weft:* lot table reusing `SourceLotPicker` + placements pull (as JW-Out form), columns quality/lot/cones/bags/gross/net; `valueOfGoods`.
  - Submit disabled unless ≥1 row in some section.
- **Detail:** two print blocks matching the paper layouts (beam issue: SR/BEAM NO/D.NO/ENDS/REED/CUT/GROSS/PIPE/NETT + totals; weft: Quality/Lot/Cone/Gr.Wt/Net Wt + bags + total), one Print button each (WD-L12), `window.print()` + print CSS per existing pattern. Cancel + edit-print-fields actions role-gated.
- **JW-Out register:** weaving challans remain listed (WD-L10); rows link back to their dispatch; direct cancel/edit disabled with a "managed by dispatch" hint.
- Role-gated UI ships with both-branch tests (standing rule). Lot pickers use canonical lot-label vocabulary (`lot-labels.ts`).

## 5. Tests

- **BE unit+integration:** create both-halves / beam-only / weft-only / empty-rejected; double-issue race; cancel restores weaver + reverses ledger (assert against `stock_ledger`, not `/inventory`); boundary guards (public weaving create rejected, dispatch-owned cancel rejected); JWB numbering; predicate change (raw lot valid weft, beam-track lot invalid).
- **JW-Out regression:** existing service tests pass unmodified after the `createIn` extraction.
- **FE integration:** form both sections, MSW schema-validated handlers, role both-branch tests, print blocks render.
- **e2e (same commits):** dispatch beams + weft → verify beam status flips + weft at-JW in Stock Balance → cancel → verify full reversal. Live-verify FE api paths against the real BE (contract-validation rule).

## 6. Risks (from the agent debate)

1. `createIn`/`cancelIn` extraction touches the most load-bearing module; any needed edit to its existing tests = the refactor changed behaviour — stop and re-check.
2. Weft sits in `pendingAtJW` indefinitely until fabric receipt exists — correct custody; `write_off` is the escape hatch.
3. `countActiveReceipts` rides along in `cancelIn`, provably inert for weaving outs today; not designed around.
4. Header duplication between dispatch and weft challan is guarded only by the ownership rules on `updateHeader` — both-branch tests mandatory there.

## 7. Out of scope

Fabric receipt (return leg, `job-work-weaving-in.jpeg` — needs a fabric/piece domain); beam ledger representation; computed value-of-goods; weft-consumption reconciliation at the weaver.
