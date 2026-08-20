# JW-Out Placement Conservation — Design

**Date:** 2026-08-20
**Origin session:** `session_01XDj53MdB2b3LTTfy5yjxfs` (chat: "while testing I have created JWO-2026-27-026 … which has source lot as LOT-260819-0028 but this only has 50kg, then how am I able to save this challan?")
**Status:** Approved by user (design conversation 2026-08-20); implementation authorized end-to-end.
**Amends:** L14 (`Σ placements ≤ item.qty`, placement-pending allowed) in `docs/brainstorms/2026-05-19-jw-domain-redesign.md` — narrowed to inbound items only. Recorded there as L23.
**Related:** `2026-07-10-unplaced-stock-visibility-design.md` (the inbound bucket this spec deliberately does *not* extend to outbound).

## 1. Problem

`JWO-2026-27-026` was saved dispatching **100 kg** of `LOT-260819-0028` when only **50 kg** stood on the floor. It wrote **zero** `stock_ledger` rows.

Root cause — both the balance guard and the ledger writer are placement-driven loops, and the item had zero placements:

| Location | Code | Behaviour with `placements: []` |
|---|---|---|
| `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts:553` | `assertLotBalances` iterates `input.items[].placements` | zero iterations — nothing validated |
| `fabtraq-be/src/modules/inventory/prisma-inventory.service.ts:245` | `applyChallanOutLedger` iterates `placement.findMany(...)` | zero rows written |

`netWeight` is never compared against anything. The shared schema permits the empty array explicitly (`fabtraq-shared/src/schemas/transaction/jw-challan-out.ts:67`).

### 1.1 Why the design allowed it

L14 (2026-05-19) locks the inventory invariant as `Σ placements ≤ item.qty`, *"strict equality is NOT required"*, to enable the L11 accountant/storekeeper role-split: accountant saves the paperwork, storekeeper allocates floors later.

That is safe for **inbound** items because `2026-07-10-unplaced-stock-visibility-design.md` §3.1 ledgers the unplaced remainder into the awaiting-placement bucket — the books still balance. The same §3.1 says *"Challan-out create: unchanged"*. **There is no outbound bucket.** An unallocated outbound quantity is recorded nowhere. That asymmetry is the defect.

### 1.2 Blast radius

- **Over-issue.** `findLotLocationBalance` reads only `stock_ledger`; with no rows written the lot still reports its full pre-challan balance. A second JW-Out off the same lot passes every guard.
- **Unreceivable.** The JW-In source picker filters `placementStatus: 'fully_placed'` (`prisma-inventory.service.ts:1126`), so the 100 kg can never be received back.
- **Unrepairable in place.** `editPlacement` 409s on `jw_challan_out_item`; topping up through the Place Stock queue stops at 50 kg (`INSUFFICIENT_BALANCE_AT_FLOOR`) and so never reaches `fully_placed`. Cancel-and-recreate is the only exit.

### 1.3 Existing bad data

One row, confirmed by full scan of non-cancelled out-items:

```
challan_no       | lot_number      | net_weight | placement_status | placed
JWO-2026-27-026  | LOT-260819-0028 |    100.000 | pending          |      0
```

## 2. User decisions (2026-08-20)

| Question | Decision |
|---|---|
| Cap the weight by the lot balance? | **Yes** — but by the lot's *on-floor* balance, excluding qty already at a job worker |
| Require floors to add up to the weight? | **Yes** (initially rejected, then accepted once the residual `weight ≤ balance, no floors picked` hole was shown) |
| Keep the save-before-placing flow for JW-Out? | **No** — Option A. Outbound placements are mandatory at save time |
| Inbound (purchase / JW-In) | **Unchanged** — keeps `Σ ≤ qty` + bucket |
| Existing bad data | **Cancel and re-enter** `JWO-2026-27-026` manually. No migration, no backfill (L8) |

## 3. The three checks

Worked example — `LOT-260819-0028` with 30 kg on Floor A, 20 kg on Floor B, and 50 kg already at Rueen Fab:

| # | Invariant | Fails on | Where enforced |
|---|---|---|---|
| 1 | `netWeight ≤ Σ floor balances of the lot` | weight 100 | **FE only** (new) |
| 2 | `Σ placements.quantity === netWeight` (±0.001) | weight 50, only Floor A 30 allocated | **shared schema + BE service** (new) |
| 3 | each `(lot, location, floor)` draw ≤ that floor's balance | weight 50, all 50 off Floor A | BE service (**exists**) |

### 3.1 Check 1 is FE-only, deliberately

On the backend, check 1 is **mathematically implied** by 2 + 3:

```
netWeight  =  Σ placements        (check 2)
           ≤  Σ floor balances    (check 3, per (lot,location,floor) group)
           =  lot on-floor balance
```

Adding a BE lot-level query would be a redundant round-trip guarding nothing. Check 1 earns its place purely as **fast feedback**: it complains the moment the user types 100, before they touch the floor picker. The FE already holds every floor balance for the picked lot (`SourceLotPicker` → `lot.placements[].balance` → `availableFloors[].available`), so it costs no new request.

### 3.2 Check 2 lives in two places, deliberately

- **`fabtraq-shared` schema `.superRefine`** — one edit covers the JW-Out HTTP route, the weaving-dispatch weft route (`createWeavingDispatchWeftSchema` composes `createJwChallanOutItemSchema` directly), and both FE forms via `zodResolver`.
- **`assertLotBalances` service guard** — `JwChallanOutService.createIn` is called internally by `WeavingDispatchService.create`, and unit tests construct inputs without parsing. The guard belongs in the function that silently no-opped, so every caller routes through it.

**Issue path is `['netWeight']`, not `['placements']`.** Both `ChallanOutLineItemRow.tsx:190` and `WeftLineItemRow.tsx:177` already render `<FieldError message={itemErrors?.netWeight?.message} />`, so this needs zero FE plumbing and puts check 1 and check 2 errors on the same field. Matches the JW-In precedent (`conservationRefinement` also targets `netWeight`).

### 3.3 Consequences accepted

- **JW-Out items are always `fully_placed` at create.** The `jw_challan_out_item` branch of the Place Stock queue becomes dead for new data. **Left in place** — it still serves pre-existing rows and removing it is a separate, riskier decision. Flagged in the backlog, not done here.
- **`ZodEffects` has no `.extend()`.** Safe here: `createJwChallanOutItemSchema`'s only two consumers (`weaving-dispatch.ts:43`, `jw-challan-out.ts:85`) both wrap it in `z.array(...)`. No plain-object twin needs extracting, unlike the JW-In case.
- **L14 is narrowed, not revoked.** Inbound keeps `Σ ≤ qty`. Only outbound requires equality.

## 4. Contract & versioning

- `fabtraq-shared` **1.16.0 → 1.17.0**, published to GitHub Packages; `fabtraq-be` and `fabtraq-fe` install from the registry.
- No Prisma migration. No new DB column, index, or enum value.
- No new API endpoint, and no change to any response shape — request validation only.

## 5. Verification

- Shared: unit tests on the refine (balanced / under / over / empty / multi-placement / ±0.001 boundary).
- BE: service unit tests for the new guard on both `create` and the `createIn` weaving path; integration test asserting HTTP 400 on an unconserved payload.
- FE: integration tests asserting the weight field shows the over-balance error (check 1) and the unconserved error (check 2), and that submit is blocked.
- E2E: extend `e2e/tests/flows/jw-out.spec.ts` — attempt an over-balance save, assert refusal and that no ledger row appeared.
- Manual: re-run the original symptom — try to recreate JWO-026's exact payload (100 kg off a 50 kg lot) and confirm rejection.

## 6. Out of scope

- Removing the dead `jw_challan_out_item` place-stock branch (backlog).
- Any outbound "awaiting placement" bucket (that is Option B, explicitly rejected).
- Backfilling or auto-cancelling `JWO-2026-27-026` — the user does that by hand.
