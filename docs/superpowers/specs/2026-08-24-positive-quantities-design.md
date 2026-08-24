# Positive Quantities & Cross-Field Weight Guards — Design

> **Status:** locked 2026-08-24 (session `session-1787554454119`).
> **Branch:** stacked on `feat/raw-yarn-sizing-*` (same four worktrees), not a
> separate branch set. Both workstreams ship in one PR set.
> **Trigger:** `JWO-2026-27-015` — a JW-Challan-Out created on the dev DB with
> `net_weight = 0.000`, `gross_weight = 10.000`, zero placements, zero
> `stock_ledger` rows.

---

## 1. Problem

The system accepts transactions that move nothing.

`JWO-2026-27-015` dispatches 0 kg, writes no ledger rows, can never be received
against (`remainingQty = 0`), is permanently stuck at `status = 'sent'`, sits
forever in the awaiting-placement bucket (`placement_status = 'pending'`), and
consumed a real number in the `JWO-` sequence. It also records
`gross_weight = 10` against `net_weight = 0`, which is self-contradictory.

### 1.1 Why it slipped through — two rules that compose into a hole

Neither rule is wrong on its own; together they leave zero unguarded.

1. **`quantitySchema` is non-negative, not positive.**
   `fabtraq-shared/src/primitives/money.ts:37` — `.min(0, 'Quantity must be
   non-negative.')`. Correct as a general primitive: `wastage`, `stillAtJwQty`
   and `remainingQty` all legitimately hit 0.
2. **Conservation refinements pass vacuously at zero.**
   `jw-challan-out.ts:82-91` requires `Σplacements === netWeight`. At
   `netWeight = 0` with `placements: []` that is `0 === 0` — green. The guard
   that exists precisely to stop under-allocation cannot fire when the target
   is zero.

A third, independent gap made the contradictory weights possible:

3. **No `grossWeight` ≥ `netWeight` rule exists anywhere.** A repo-wide search
   of every schema found no refinement comparing the two on any transaction
   type.

And a fourth, specific to JW-Out:

4. **`placements` has no `.min(1)`** (`jw-challan-out.ts:80`) despite its own
   doc-comment three lines above declaring placements mandatory for outbound
   ("Outbound has no such bucket, so an unallocated quantity would leave the
   building without moving any stock"). The comment states an invariant the
   schema never enforces.

### 1.2 Blast radius — the whole class, not one field

An audit of every quantity field in every create/update schema found the same
defect on four transaction types. **`0` is nonsense but currently accepted:**

| File:line | Field | Schema |
|---|---|---|
| `jw-challan-out.ts:69` | `netWeight` | `createJwChallanOutItemSchema` |
| `jw-challan-in.ts:119` | `netWeight` | `jwChallanInYarnItemObjectSchema` |
| `jw-challan-in.ts:49` | `consumedQty` | `jwChallanInYarnSourceSchema` |
| `yarn-purchase.ts:53` | `quantity` | `yarnPurchaseItemBaseSchema` |
| `weaving-in.ts:52` | `meters` | `createFabricTakaSchema` |
| `weaving-in.ts:53` | `weightKg` | `createFabricTakaSchema` |
| `weaving-in.ts:42` | `metersAttributed` | `createWeavingInTakaBeamSchema` |

**Already correctly guarded — no change:** `beam-receipt` (every quantity has
`.refine(v => v > 0)`), `stock-transfer` (`stock-transfer.ts:38`), `place-stock`
(`placement.ts:28`, `z.number().positive()`). These are the precedent for the
pattern the buggy fields lack.

**`weaving-dispatch` inherits the JW-Out defect by composition.**
`weaving-dispatch.ts:47` reuses `createJwChallanOutItemSchema` for its weft
items. A fix at the schema covers it for free; a fix at the JW-Out *endpoint*
would have left this second call site broken. This is the single strongest
argument for fixing at the schema layer.

### 1.3 JW-In has a wider vacuous window than JW-Out

`conservationRefinement` (`jw-challan-in.ts:140-162`) is wrapped in
`if (allWastageExplicit)` — **if any source carries `wastage: null`, the entire
conservation check is skipped**, not just relaxed. So JW-In has two ways to pass
vacuously: all-zero vectors, and any-null-wastage. The all-zero case is closed
by this spec. The null-wastage skip is deliberate (it exists for the BE
auto-split path) and is **out of scope** — see §6.

### 1.4 BE adds no independent floor

`jw-challan-out.service.ts:537-561` re-implements the identical conservation
math, with the identical vacuous-at-zero shape.
`jw-challan-in.service.ts:923-990` likewise. Neither asserts positivity. The
service layer trusts the shared schema entirely for "does this transaction
actually move anything."

### 1.5 Existing data — clean, no repair needed

Verified against `fabtraq_dev` after a fresh seed:

| table | zero-quantity rows | total |
|---|---|---|
| `jw_challan_out_items` | **1** (JWO-2026-27-015 only) | 16 |
| `jw_challan_in_yarn_item` | 0 | 6 |
| `jw_challan_in_yarn_item_source` (`consumed_qty`) | 0 | 7 |
| `placements` | 0 | 31 |
| `beam_receipt_items` | 0 | 17 |

Also zero challans with no items on either side, and zero rows where
`gross_weight < net_weight`. The single bad row is a manual dev-DB artifact
created while testing today; a re-seed removes it. **No migration, no backfill,
no repair script.**

---

## 2. User decisions (2026-08-24)

| # | Question | Decision |
|---|---|---|
| D1 | Is a JW-In source row with `consumedQty = 0` ever meaningful? | **No — reject it.** A source that consumes nothing is noise; it links the receipt to an out-item without drawing from it. |
| D2 | How wide should the fix go? | **All affected types** — JW-Out, JW-In, yarn-purchase, fabric-taka/weaving-in. Fix the class at the shared layer. |
| D3 | Branching | **Stack on the existing `feat/raw-yarn-sizing-*` worktrees**, not a new branch set. |
| D4 | Shared version bump | **Deferred**, same as the sizing workstream. `1.21.0` stays; no CHANGELOG release section. |

---

## 3. The design

### 3.1 Add `positiveQuantitySchema`; do NOT invert `quantitySchema`

New sibling primitive in `fabtraq-shared/src/primitives/money.ts`:

```ts
export const positiveQuantitySchema = z
  .number()
  .finite()
  .gt(0, { message: 'Quantity must be greater than zero.' })
  .max(QUANTITY_MAX, { message: 'Quantity exceeds maximum allowed value.' })
  .transform((value) => round(value, 3))
  .brand<'Quantity'>();
```

**Why not invert `quantitySchema` to positive and let the zero-valid fields opt
out?** It looked like the better root-cause fix — safe by default for the next
field someone adds — and it is wrong. `quantitySchema` is used in **response**
schemas as well as inputs, and at least one of them is legitimately zero:
`remainingQty` (`jw-challan-out.ts:235`) is exactly 0 once an out-item is fully
received. Inverting would make the BE fail to serialise, and the FE fail to
parse, every fully-received out-item. The 80 call sites are a mix of input and
output; a blanket flip is not a root-cause fix, it is a new outage.

So: `quantitySchema` keeps meaning "a quantity, possibly zero" and stays correct
for `wastage`, `stillAtJwQty`, optional weigh-bridge fields, and every response
field. `positiveQuantitySchema` means "a quantity that must actually move
something," and the seven fields in §1.2 adopt it.

The branding is identical (`.brand<'Quantity'>()`) so a
`PositiveQuantity` is assignable everywhere a `Quantity` is, and no downstream
type changes.

### 3.2 Guard 2 — `placements` is non-empty on outbound items

`jw-challan-out.ts:80` gains `.min(1, …)`, making the schema say what its own
doc-comment already claims.

This is **not** redundant with §3.1. Once `netWeight > 0`, an empty placements
array does fail the conservation refinement — but with a confusing message
("Placements must add up to the net weight — 0 of 12 KG allocated") rather than
the direct one. More importantly, an invariant that holds only as an emergent
consequence of another rule is one refactor away from silently disappearing.
Outbound placements being mandatory is a first-class rule and gets its own line.

### 3.3 Guard 3 — `grossWeight` ≥ `netWeight`

A separate rule from positivity, with its own failure mode: JWO-015 had
`gross 10 / net 0`, which stays wrong even after §3.1 makes `net > 0` mandatory.

Applies wherever both fields exist on the same item. **Boundary cases, decided
here:**

- `grossWeight` absent/undefined → **no check.** It is an optional
  weigh-bridge field, frequently not captured at issue time.
- `grossWeight === 0` → **treated as "not weighed", no check.** Zero is the
  form's empty state for this field; rejecting it would block a legitimate
  "didn't weigh it" entry.
- `grossWeight === netWeight` → **valid.** No packaging, or packaging not
  counted. Equality must pass.
- `0 < grossWeight < netWeight` → **rejected.** Gross is net plus packaging; it
  can never be less.

Comparison uses the same `CONSERVATION_TOLERANCE_KG` (0.001) already used by the
conservation refinements, so float noise cannot trip it.

### 3.4 No BE re-assertion is added

The BE re-implements conservation because that check needs DB state. Positivity
and non-emptiness are pure shape checks the schema fully decides, and BE parses
every request body through these schemas before the service sees it. Adding a
second hand-rolled floor in the service would be duplicated logic that can drift
from the schema — the exact failure mode this spec exists to remove. The BE
integration tests in §5 assert the route rejects, which pins the behaviour
wherever it is enforced.

### 3.5 Create/update asymmetry — verified absent

The B-016 failure mode (guard on create, missing on update) does **not** recur:
`updateJwChallanOutSchema`, `updateYarnPurchaseSchema` and the weaving-dispatch
print-fields patch are all header-only and `.strict()`; none re-exposes
`netWeight`, `consumedQty`, `items` or `placements`. Items are immutable after
creation on these endpoints. Confirmed by reading each update schema, not
assumed.

`updateWeavingDispatchPrintFieldsSchema` (`weaving-dispatch.ts:94-109`) does
allow `grossWeight`/`pipeWeight` at 0 via `.nonnegative()`. That is the
deliberate WD-L5 "blank prints blank" behaviour and is **left alone**.

---

## 4. Contract & versioning

Additive: one new exported primitive, seven fields tightened, two refinements
added. No response shape changes, no endpoint changes, no registry changes, no
migration.

Per **D4 the shared version bump is deliberately NOT part of this workstream** —
same as the stacked sizing change. `1.21.0` stays and no CHANGELOG release
section is written. Consequence, stated plainly: BE and FE resolve the published
`1.21.0` and see none of this until the bump is decided and executed, so the BE
integration tests and e2e specs here pass only against a locally-linked build.

**This is a tightening of accepted input.** Any client currently sending 0 will
start getting a 422. Per §1.5 nothing in the data suggests a real caller does
this, and the FE never offers it as a deliberate action — but it is a breaking
change for an API consumer, and belongs in the release notes when the bump
happens.

---

## 5. Verification

| Gate | What proves it |
|---|---|
| shared unit | Per-field cases: 0 rejected, negative rejected, positive accepted, for all seven fields. Boundary cases for §3.3: gross absent / gross 0 / gross === net / gross < net. `.min(1)` on outbound placements. Regression cases proving `wastage`, `stillAtJwQty` and `remainingQty` still accept 0 |
| BE integration | `POST /jw-challans-out` with `netWeight: 0` → 422, **and zero `stock_ledger` rows written**. Same for `POST /jw-challans-in` with a zero item and with a zero-`consumedQty` source. A positive control alongside each, so the tests cannot pass by rejecting everything |
| FE | Existing suite green. The forms must surface the new 422s as field errors, not as an unhandled toast — verified live, since a validation change that produces a dead-end error screen is a regression even with green tests |
| e2e (live) | Negative case: fill a JW-Out with quantity 0, attempt save, assert the specific field error appears and **no challan row was created**. Asserted against the DB, not the toast |
| docs | This spec + plans mirrored across all four repos |

The negative tests are the easy ones to write vacuously. Each must assert the
**specific** error (`422` + the field path), not merely "it failed", and must
assert zero rows written — a rejection that still wrote a ledger row is the bug
in a different costume.

---

## 6. Out of scope

- **The shared version bump** (D4).
- **JW-In's `allWastageExplicit` skip** (§1.3). Real, wider than the zero hole,
  and deliberate — it exists for the BE auto-split path. Closing it needs its
  own domain decision about what conservation means when wastage is unknown.
  Tracked as a follow-up, not silently fixed here.
- **`weightKg` vs `meters` proportionality** on fabric takas. Both get positive
  guards; no rule relates them, because the sane ratio depends on fabric GSM and
  is not a validation concern. `computeGlm` already returns null for
  non-positive meters — a display-layer workaround that this change makes
  unreachable, but it is left in place as defence.
- **`updateWeavingDispatchPrintFieldsSchema`'s nonnegative weights** (§3.5) —
  deliberate WD-L5 behaviour.
- **Repairing `JWO-2026-27-015`.** It is a dev-DB artifact; a re-seed removes
  it. No production data carries this shape (§1.5).
- **Merging to `main`.** Ends at pushed branches + PR links.
