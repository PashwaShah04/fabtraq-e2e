# JW Challan Visibility & Seed Ledger Fidelity — Design

> **Status:** locked 2026-08-31 (session `session-1787856320843`).
> **Branch:** `feat/inventory-rewoven` in all four repos — no new branch set.
> Stacked on top of the Inventory Rewoven work already on that branch.
> **Trigger:** owner opened `JWI-2026-27-003` and its parent `JWO-2026-27-003`
> and asked "is this right or wrong?". The transaction is right; four things
> around it are not.

---

## 1. Problem

Seed challan pair `JWO-2026-27-003` → `JWI-2026-27-003` records a dyeing job:
180 kg out (100 kg RED `LOT-260324-0001` + 80 kg BLUE `LOT-260324-0002`),
165 kg back as `LOT-260510-0001`, 15 kg wastage.

**The arithmetic is correct.** Σ`consumedQty` = 180, Σ`wastage` = 15,
Σ`stillAtJwQty` = 0, `netWeight` = 165 = 180 − 15. The placement of 165 kg
matches `netWeight`. `getOutItemRollup` returns `pendingAtJW = 0` for both
source items, so `status = 'fully_received'` is right. Nothing about the
transaction is wrong.

Four things around it are.

### 1.1 F1 — the JW-Out detail read has no rollup, so the page cannot tell the truth

`jwChallanOutItemResponseSchema`
(`fabtraq-shared/src/schemas/transaction/jw-challan-out.ts:169-183`) carries
what was *sent* and nothing about what came *back*. `pendingAtJW` exists on
exactly one schema — `eligible-out-item.ts:50`, the JW-In picker — and is
absent from the detail response.

That single omission produces three distinct symptoms on one page:

| # | Symptom | Site |
|---|---|---|
| a | **"Close as loss" renders on every row, always.** Gated only on `canEdit`; no check on remaining quantity. On this fully-received challan both buttons are dead ends — the BE answers 422 `NOTHING_TO_WRITE_OFF` (`prisma-inventory.service.ts:1522`). | `jw-challan-out-detail.page.tsx:325-336` |
| b | **The "Status" column answers a different question.** It renders `placementStatus` — where the yarn was *pulled from in the godown* — under a header a reader takes to mean *receipt* state. The render site admits the substitution: `// pendingAtJW not in response; placementStatus is the best available indicator`. | `jw-challan-out-detail.page.tsx:317-323` |
| c | **A page headed "Fully Received" never says what was received.** No received qty, no wastage, no pending. The owner must open the child receipt to learn 165 kg came back and 15 kg was lost. | header block, same file |

`getOutItemRollup` already computes exactly the right shape —
`{ sentQty, returnedQty, wastageQty, stillAtJwQty, writtenOffQty, pendingAtJW,
fullyReceived }` (`i-inventory.service.ts:243-251`). It is simply never
surfaced on this read.

**This is one root cause with three symptoms, not three findings.**

### 1.2 F2 — a raw DB enum renders as UI text

`jw-challan-in-detail.page.tsx:287` renders
`<Badge variant="outline">{item.placementStatus}</Badge>` — the chip on the
receipt page literally reads `fully_placed`, lowercase with an underscore,
next to Title-Cased text everywhere else.

The JW-Out page has `PLACEMENT_STATUS_LABEL` / `PLACEMENT_STATUS_VARIANT` for
exactly this (`jw-challan-out-detail.page.tsx:58`), but they are module-local
constants in that file, so no other page can reach them.

**Grepping every render site before fixing the one the report named turned up
a larger defect: the same three states are called three different things.**

| Site | `pending` | `partially_placed` | `fully_placed` |
|---|---|---|---|
| `jw-challan-out-detail.page.tsx:58` | Pending | Partially placed | Fully placed |
| `placements/columns.tsx:9-20` | Pending | **Partial** | **Placed** |
| `jw-challan-in-detail.page.tsx:287` | `pending` | `partially_placed` | `fully_placed` |

So the report's "one page forgot the map" is really "there is no map" — three
independent vocabularies, one of them raw. A user reading the Place Stock
queue and then a JW-Out challan is shown two different names for one state.

This is the same defect the 2026-07-27 lot-label work fixed for lot pickers,
and it takes the same shape of fix: **one vocabulary module, one badge
component, every site imports it.** The explicit wording wins — *Pending /
Partially placed / Fully placed* — because a table saving four characters is
not worth a second name for the same thing.

### 1.3 F3 — the receipt shows its inputs but not its own arithmetic

The Sources table (`jw-challan-in-detail.page.tsx:348-405`) lists per-source
`consumedQty` and `wastage` and stops there:

- **No totals row.** To check the job worker the owner does 100+80=180,
  8+7=15, 180−15=165 mentally and compares it to the `Net Wt` stat above.
  The conservation identity the BE enforces is invisible on the page that
  exists to display it.
- **`stillAtJwQty` is fetched and never rendered.** It is on every source row
  of the response and appears in no column. It is 0 here, so this pair does
  not expose it — but it is precisely the number that matters on a *partial*
  receipt, and today the page cannot show one.
- **The received lot's SKU is never shown.** The card renders `Shade No`
  (`DYE-R01`) but not the SKU, while the Sources table shows each *input*
  SKU with a colour swatch. The BE **requires** `skuId` on any dyed lot —
  `SKU_REQUIRED_FOR_DYED_LOT`, `jw-challan-in.service.ts:675-680` — because it
  is the colour identity the lot is filed under in inventory. The one page
  dedicated to that lot will not tell you what it is.

### 1.4 F4 — four seed challans write a ledger no application code path produces

The application writes `challan_out` as a **two-leg double entry**
(`prisma-inventory.service.ts:246-300`, `applyChallanOutLedger`):

| Leg | `locationId` | `jobWorkerId` | Quantity |
|---|---|---|---|
| Floor debit — stock leaves the source floor | set | **`null`** | `outQuantity` |
| JW credit — stock arrives at the job worker | **`null`** | set | `inQuantity` |

`challan_in` mirrors it (`applyChallanInYarnLedger`, same file): a floor
credit for the received lot, plus **one JW-debit leg per source link**, keyed
on the *source* position's identity and quantity `consumedQty`.

The four hand-rolled seed challans write neither shape. Measured on a fresh
`db:reset && db:seed`:

```
 transaction_type | count | jw_legs | hybrid(located AND job_worker set)
------------------+-------+---------+-----------------------------------
 challan_out      |     5 |       0 |                                 5
 challan_in       |     3 |       0 |                                 0
```

Every seeded OUT row is a single hybrid: floor-located **and** carrying
`jobWorkerId`, which the real writer explicitly sets to `null` on that leg.
No JW-credit leg exists at all. No JW-debit leg exists on any receipt.

The split is exactly seed-authored vs app-authored. All five rows belong to
`JWO-2026-27-001…004`, hand-written in `prisma/seed.ts` and dating to
`7bd7fd5` (S5); every challan created *through the app* — `005` onward in a
dev DB with e2e leftovers — carries the correct pair.

**Blast radius today: nil.** Both legs are missing symmetrically, so the
at-JW balance nets to 0, which is the correct answer for a fully-received
challan. `getOutItemRollup` reads relational tables, not the ledger, so
`pendingAtJW` is unaffected. Nothing currently rendered is wrong because of
this.

**Where it would bite:**

1. `closeOutAsLoss` resolves `jobWorkerId` via
   `findFirst({ transactionType: 'challan_out', transactionItemId, locationId: null })`
   (`prisma-inventory.service.ts:1528-1538`). For `001–004` that finds
   nothing, and the write-off lands with a null `jobWorkerId`.
2. Cancelling one of these receipts reverses only rows that were written,
   leaving the relational rollup and the ledger disagreeing about custody.
3. The hybrid row survives only because located rows are normalized to
   floor positions on read (B-015 custody rule). It is one un-normalized
   read path away from polluting floor balances.

This is latent, not active. It is fixed because seed data is the shape every
future reader copies, not because anything is currently broken.

---

## 2. Owner decisions (2026-08-31)

| # | Question | Decision |
|---|---|---|
| D1 | Show the received lot's SKU on the JW-In item card? | **Yes** — SKU + colour swatch on the card, rendered the same way as the Sources table. Card only; list columns unchanged. |
| D2 | Seed files the dyed output under `SKU-001 RED / R001` while its shade is `DYE-R01` — a dyeing job consuming RED + BLUE that produces a lot recorded as RED. | **Fix.** Add a real dyed SKU to the seed and file the S3 output lot under it. |
| D3 | F1 needs a `fabtraq-shared` schema change. | **Publish.** shared → `1.27.0` on GitHub Packages; BE + FE bump to match. |

---

## 3. Design

### 3.1 F1 — surface the rollup on the out-item response

**shared** (`schemas/transaction/jw-challan-out.ts`)

```ts
/**
 * L3 rollup for one out-item, surfaced on the detail read.
 * Mirrors `OutItemRollup` (BE `i-inventory.service.ts`) field-for-field —
 * the BE maps the existing `getOutItemRollup` result straight onto this, so
 * there is exactly one definition of "what came back".
 */
export const outItemRollupSchema = z.object({
  sentQty: quantitySchema,
  returnedQty: quantitySchema,
  wastageQty: quantitySchema,
  stillAtJwQty: quantitySchema,
  writtenOffQty: quantitySchema,
  pendingAtJW: quantitySchema,
  fullyReceived: z.boolean(),
});
```

`rollup: outItemRollupSchema` is added to `jwChallanOutItemResponseSchema` as
a **required** field. Required, not optional: an optional field would let a
producer silently omit it and reintroduce symptom (a), and the MSW-schema gate
then forces every fixture to carry it.

**Blast radius.** `jwChallanOutResponseSchema` is the response schema for
**five** registry endpoints, not just the detail read —
`listJwChallansOut` (wrapped in `pageOfSchema`), `getJwChallanOutById`,
`createJwChallanOut`, `updateJwChallanOut`, `cancelJwChallanOut`
(`registry/transaction/jw-challans-out.registry.ts:26-65`). A required field
therefore obliges all five BE paths to populate it, the list included. That is
accepted, not worked around — a "detail-only" optional field would be exactly
the hole this change exists to close.

The list cost is bounded and was measured, not assumed.
`getOutItemRollup` takes an array of ids and issues a fixed set of reads
(`jwChallanOutItem.findMany`, the two `findCancelledTransactionIds` lookups,
the write-off ledger read, the beam-candidate read, the weaving-weft read —
about half a dozen) **independent of how many ids it is given**. So the list
must collect every item id across the whole page and make **one** call, then
hand the shared map to each row's mapping.

Note the trap it must not copy: `list` currently resolves placement locks
**per row** (`Promise.all(items.map(… resolveLocksForOutRow(row)))`,
`jw-challan-out.service.ts:218-223`). Following that shape for the rollup
would turn a fixed per-page cost into an N-per-page one. The rollup call is
hoisted above the map deliberately.

**BE** — a single private helper on the service fetches
`inventory.getOutItemRollup({ outItemIds, tx })` for a row's items and calls
the mapper; all five call sites route through it. The mapper takes the
resulting map as a third parameter, following the existing `lockMap`
precedent, and it is **not** defaulted — TypeScript must force every call site
to supply one, or an omission becomes a runtime parse throw instead of a
compile error. No new query shape, no SQL aggregation (compute-in-app rule
holds — `getOutItemRollup` sums in the application layer).

**FE** (`jw-challan-out-detail.page.tsx`)

- **Header:** `Received`, `Wastage`, `Pending` stats join `Total Net Wt`,
  summed across items. A challan headed "Fully Received" now states
  180 sent · 165 received · 15 wastage · 0 pending on its own page.
- **Line items:** the `Status` column is renamed **`Placement`** — it keeps
  rendering `placementStatus`, now under a header that says what it is — and a
  new right-aligned **`Pending`** column renders `rollup.pendingAtJW`. Receipt
  state becomes readable where a reader looks for it.
- **`Close as loss`** renders only when `rollup.pendingAtJW > TOLERANCE`.
  The dead button disappears on every fully-received item; the BE guard stays
  as the authority.

Tolerance: reuse the FE's existing kg tolerance constant rather than a literal
— a float `> 0` test would resurrect the button on a `1e-9` residue.

### 3.2 F2 — one placement-status vocabulary

A new `placement-status.ts` vocabulary module exports the label map, the
variant map, and a `PlacementStatusBadge` component — the same "one
vocabulary, every consumer" shape as `lot-labels.ts` + `InventoryLotSelect`.

All three sites in the table above are repointed at it in one change:
`jw-challan-out-detail.page.tsx` (its module-local maps deleted),
`jw-challan-in-detail.page.tsx:287` (raw enum replaced), and
`placements/columns.tsx` (its private `PlacementStatusBadge` and divergent
wording deleted). The Place Stock queue's labels change from
*Partial* / *Placed* to *Partially placed* / *Fully placed* — a deliberate,
user-visible wording change, not a refactor side effect, and the e2e specs
that assert those strings move in the same commit.

### 3.3 F3 — make the receipt reconcile on screen

`SourcesTable` (`jw-challan-in-detail.page.tsx`):

- A `Still at JW` column between `Consumed Qty` and `Wastage`.
- A `TableFooter` totals row: Σ`consumedQty`, Σ`stillAtJwQty`, Σ`wastage`.
- Totals are computed in the component from the rows already fetched — no new
  request, no BE change.

`YarnItemCard`, per **D1**: an `SKU` stat rendered with `ColourSwatch` +
`formatSkuDisplay`, the same pair the Sources table already uses, so the
received lot and its inputs speak one visual vocabulary. The SKU name/shade
come from the yarn-SKU list the page already loads for its quality map.

The conservation identity Σconsumed − Σwastage − ΣstillAtJw = netWeight is
**displayed, not asserted** — the BE `superRefine` remains the authority. A
second implementation in the FE would be a second thing to keep true.

### 3.4 F4 — seed through the real writer

The eight hand-rolled `stockLedger.create` calls for `challan_out` /
`challan_in` in `prisma/seed.ts` are deleted and replaced with calls to the
application's own writers:

```ts
const inventory = new PrismaInventoryService(prisma);
await inventory.applyChallanOutLedger({ challanOutId, outItemId, ..., tx });
await inventory.applyChallanInYarnLedger({ challanInId, yarnItemId, sources, ..., tx });
```

`PrismaInventoryService`'s constructor takes only the Prisma client
(`prisma-inventory.service.ts:97`), and both writers read the placements the
seed has already created from the caller's `tx`. So the seed stops describing
the ledger convention and starts *using* it — which is the only version of
this fix that cannot drift again. Hand-copying the two-leg shape into the seed
would leave the same class of bug one convention change away.

Ordering constraint: both writers read `placement` rows for the item, so each
call must follow the `placement.create` calls it depends on. The seed already
creates placements first in all four blocks.

**D2:** a dyed SKU (`DYED MAROON` / shade `DYE-R01`, same `20s CP` quality) is
added to the seed's SKU fixtures and the S3 received lot is filed under it,
replacing the reuse of `SKU-001 RED`.

**Guard.** A BE integration test asserts the *shape* invariant against a
freshly seeded DB: for `transaction_type IN ('challan_out','challan_in')`,
no row is both floor-located and carries a `jobWorkerId`, and every
`challan_out` item has both legs. This is the check that fails if a future
seed block hand-rolls rows again — the reason the defect survived from S5 to
now is that nothing ever asserted it.

---

## 4. Non-goals

- **No fix to the transaction itself.** `JWO/JWI-2026-27-003` is arithmetically
  correct; nothing about its data changes beyond D2's SKU.
- **No backfill of production ledger rows.** The malformed rows exist only in
  seed data. If prod carries pre-S5 challans with the same shape that is a
  separate, evidence-first workstream — not assumed here.
- **No new list-endpoint rollup.** F1 touches the detail read only.
- **No FE re-implementation of the conservation rule** (§3.3).

---

## 5. Verification

The 9-gate bar, plus the two that are specific to this change:

1. BE + FE + shared: `format:check`, `lint`, `typecheck`, `test`, `build`,
   coverage thresholds.
2. BE integration suite against the isolated `fabtraq_test` DB
   (`DATABASE_URL` override — never the dev DB).
3. `db:reset && db:seed`, then the F4 shape invariant re-run against the
   fresh seed.
4. MSW-schema validation: every JW-Out handler fixture carries `rollup`.
5. Live e2e, full suite, servers stopped first.
6. **Re-verify the original symptom, not a synthetic path** — reopen the
   re-seeded `JWO-…-003` / `JWI-…-003` pair in a real browser and confirm:
   no "Close as loss" on a fully-received item, header states
   180/165/15/0, receipt totals row reconciles to 165, SKU visible, chip
   reads "Fully placed".
7. **Visual verification** — Playwright screenshots of both pages read as a
   first-time user, per the standing rule that green tests prove nothing
   about looks.

e2e specs move in the same commits as the FE change (standing lockstep rule);
the JW-Out and JW-In flow specs are updated for the renamed column, the new
columns, and the conditional button.
