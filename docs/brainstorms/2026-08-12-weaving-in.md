# Weaving In (grey fabric receipt) — brainstorm locked decisions

**Date:** 2026-08-12 · **Session:** 4a58ca9b-3180-4cf8-afd1-18bbdcfc9746 · **Sample document:** `job-work-weaving-in.jpeg` (Vinayaka Textile challan #149, 25/3/26, 13 taka / 1787 m / 167.66 kg)
**Follows:** Weaving Dispatch (`docs/brainstorms/2026-07-30-weaving-dispatch.md`, spec §7 deferred this exact return leg).

Decisions locked with Pashwa, in order:

- **WI-L1 — Taka-level register + aggregate view.** Each taka (grey fabric roll) is an individually tracked entity — source of truth. Stock overview shows aggregated meters/weight/count per fabric design, computed in app (house rule: never aggregate in DB).
- **WI-L2 — "Cut" column = damage/mend notation** (e.g. `4/9`). Stored as free text per taka; no validation semantics.
- **WI-L3 — Full reconciliation at receipt.** Receiving fabric drains the issued beam(s) AND the weft yarn sitting at-JW under the weaver, per challan — not deferred to a settlement step.
- **WI-L4 — Taka↔Beam is M:N.** Multiple taka can come off one beam; one taka can span multiple beams. Attribution defaults at challan level (pick beam(s) once, pro-rata by meters) with per-row override.
- **WI-L5 — Fabric design ≠ beam design.** The challan's Design No (e.g. TATA) is a different vocabulary from the beam/warp `Design` master → new **FabricDesign** master, linked M:N to beam designs.
- **WI-L6 — Beam drain measured in meters, auto.** Taka meters deduct from the beam's total meters. Denominator: new `beamTotalMeters` captured on `WeavingDispatchBeam` at issue (prefilled from `setLength`), **required before the first receipt** against that beam — no existing beam field is a reliable denominator (all candidates nullable; advocate + critic converged).
- **WI-L7 — Weft auto-derived per challan.** `weft kg = challan total fabric weight − Σ warp share`; warp share = `beam.netWeight × metersAttributed / beamTotalMeters` (post-sizing weight is correct for grey fabric — size stays in the cloth; crimp makes it approximate). Prefilled, storekeeper-editable, hard `≥ 0` guard, derived-vs-entered persisted for audit. Drains the weaver's at-JW weft positions oldest-first, filtered to the FabricDesign's weft quality.
- **WI-L8 — FabricDesign master fields:** code, name, expected GLM (g/m), M:N beam-design links, weft quality (+ optional SKU) link, job rate ₹/m (stored only — no billing).
- **WI-L9 — Loom number is free text per taka.** No Loom master (add later only if loom-wise reports are wanted).
- **WI-L10 — Taka serials: system-minted per weaver per financial year, gapless** (minted inside the create transaction), with a separate `paperSerialNo` column transcribing the weaver's own series (390, 391, …).
- **WI-L11 — Job charges out of scope.** Rate lives on the master only; weaver billing is a future feature.
- **WI-L12 — Taka lives outside `stock_ledger`** (beam precedent) with nullable `locationId`/`floorId` so "where is this fabric" has an answer.
- **WI-L13 — Beam close is manual** → existing unused `BeamStatus.fabric_received`; auto-suggested when remaining ≈ 0; wastage = leftover meters at close. Receipt cancel blocked while a linked beam is closed (reopen first).
- **WI-L14 — Ship two guards on existing code with this feature:** (a) fix shipped P0 — `WeavingDispatchService.cancel` restores beams without a status check (bare update; must be conditional `updateMany` + count assertion); (b) add weaving-in as a third UNION branch to `countActiveReceipts` so dispatch/weft cancel is blocked once fabric is received (closes WD spec §3.4 TODO).
- **WI-L15 — Persist weft allocation:** one `WeavingInWeftSource` row per (receipt × weft out-item) with `consumedQty` — JW-In precedent. Ledger-only drain would freeze `pendingAtJW`, make the drain ceiling unreadable, and break cancel.
- **WI-L16 — Cancel is any-order safe** because it credits back exactly the persisted source rows (no re-derivation).

**Avg Wt column decoded** (research, arithmetically verified): GLM (grams per linear meter) × 100 — `167,660 g ÷ 1787 m = 93.82 → 9382` matches the footer exactly. Always computed, never typed.

**Out of scope (headroom left in model):** taka split, checking/grading adjustments, fabric sale / dispatch-to-processing, weaver billing, ITC-04 1-year return flag.
