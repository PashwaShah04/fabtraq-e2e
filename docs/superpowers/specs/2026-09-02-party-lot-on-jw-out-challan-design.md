# Party Lot on the JW Challan-Out & its Printed Challan — Design

> **Status:** GO 2026-09-02 (owner: "complete all the stages", session `session-1788324721003`). Q1–Q3 taken at their recommendations (yes / yes / yes, subject to the V7 PNG read) as a recorded assumption — the owner did not rule on them individually.
> **Tier:** FULL — touches `fabtraq-shared/src/**` (a contract) and
> `features/challan-print/**`. Confirmed by `node .claude/helpers/tier.mjs`.
> **Branch:** `feat/inventory-rewoven` in all four repos — no new branch.
> **Stage 1:** brainstormed 2026-09-01, session `54c5222c-86f3-48e4-9fce-9e0c823ca902`;
> decisions L1–L8 reproduced verbatim in §2 and are the input to this spec, not
> its output.
> **Trigger:** the job worker signs a paper challan that names a lot number they
> have never seen. Gosrani's minted `LOT-260324-0001` is an internal identity;
> the party knows only their own lot number.

---

## 1. Problem

`YARN_COLUMNS` prints `item.sourceLotNumber` in the "Lot No." column
(`fabtraq-fe/src/features/challan-print/documents/yarn-delivery.ts:20`,
`fabtraq-fe/src/features/challan-print/templates/yarn-delivery.ts:8`). That
value is the lot number **Gosrani mints** at purchase or at JW-In. It is the
correct identity for every internal screen and for `stock_ledger`, and it is the
wrong identity for a document that leaves the building: the consignee cannot
reconcile it against anything they hold.

The party's own lot number already exists, denormalized per generation, on both
lot-minting tables — `yarn_purchase_item.party_lot_no` and
`jw_challan_in_yarn_item.party_lot_no` — and there is already a bulk reader for
it: `IInventoryService.findPartyLotsByLotNumbers`
(`fabtraq-be/src/modules/inventory/i-inventory.service.ts:524-527`, implemented
`fabtraq-be/src/modules/inventory/prisma-inventory.service.ts:583-609`). It is
*not* wired into `jw-challan-out` at all today (`jw-challan-out` BRIEF §5,
§6 "unverified" note). Nothing about the JW-Out response, the two detail pages,
or the PDF has ever seen it.

Three consequences, one root cause:

| # | Symptom | Site |
|---|---|---|
| a | The printed yarn-delivery challan names an identity the consignee cannot use. | `fabtraq-fe/src/features/challan-print/documents/yarn-delivery.ts:20` |
| b | The JW-Out detail page can show staff only the minted lot, so a floor query from the party ("which of your challans carried our PL-441?") has no answer on screen. | `fabtraq-fe/src/features/jw-challans-out/jw-challan-out-detail.page.tsx:316` |
| c | The weaving-dispatch weft table has the same gap for the dispatch-minted weft challan. | `fabtraq-fe/src/features/weaving-dispatches/weaving-dispatch-detail.page.tsx:296` |

### 1.1 Supersession

`fabtraq-be/docs/superpowers/specs/2026-08-20-party-lot-carry-forward-and-jw-in-status-design.md`
**L7** (`:36`) reads: party-lot visibility is "JW-In detail, Stock Balance / lot
listings, Beam detail composition. **Not** JW-Out challan or print".

**L7 is superseded by the owner decision of 2026-09-01, recorded here as L1–L8.**
The 2026-08-20 spec is not edited (docs are immutable once locked); this section
is the supersession record, and the `jw-challan-out` BRIEF §3 item 11 note that
"no spec/plan for that change exists on disk in any doc tree" is closed by this
document.

L10 of that same spec — **single-hop resolution, denormalized per generation** —
is *not* superseded and is the reason §3.2 needs no ancestry walk.

---

## 2. Locked decisions (owner, 2026-09-01)

| # | Decision |
|---|---|
| **L1** | The printed PDF challan's "Lot No." column prints the **party lot**, never the minted lot. |
| **L2** | Empty party lot → **blank cell**. The column always stays. **No fallback** to the minted lot. |
| **L3** | Merged lots print the combined string **verbatim** — `combinePartyLots` already joined with `" / "`. |
| **L4** | BE resolves `partyLotNo` **at read time** via `IInventoryService.findPartyLotsByLotNumbers`. No new column, no migration. |
| **L5** | Shared: `JwChallanOutItemResponse` gains `partyLotNo` as **required-nullable** (same reasoning as `rollup`); populated on all five JW-Out response paths (getById, list, create, update, cancel). The weaving-dispatch weft challan inherits it via `getById`. |
| **L6** | JW-Out detail page **and** weaving-dispatch detail weft table show **both** numbers: party lot on top, minted lot beneath in muted text. |
| **L7** | "Lot No." column widens 15% → 20%; "Quality" narrows 42% → 37%. Measured: a 3-way short merge fits at 9pt; a 2-way long vendor-format merge still truncates — **accepted**. |
| **L8** | Tests at all three levels: unit (shared schema, BE mapper, FE `yarnDeliveryDocument` + both detail pages), BE integration (`getById` + `list` resolving from a purchase lot and from a JW-In lot carrying a combined value), e2e (`jw-out.spec` owns a 3-lot fixture; `challan-pdf.spec` asserts the printed value). |

> L7 here is this spec's own L7 (column widths). Where the 2026-08-20 spec's L7
> is meant, it is written "the 2026-08-20 L7".

**§4 raises one proposed amendment to L8's e2e clause.** It is not applied; the
owner rules on it at go.

---

## 3. Design

### 3.1 Shared — the contract (already on disk, uncommitted)

`fabtraq-shared/src/schemas/transaction/jw-challan-out.ts`:

```ts
sourceLotNumber: lotNumberSchema,
partyLotNo: z.string().nullable(),      // required-nullable
```

Blessed **as written** — the working-tree diff on `feat/inventory-rewoven`
(schema field at `:224` with its doc comment at `:208-223`, 44 test lines,
`package.json` → `1.28.0`) is this section's implementation. It stays
uncommitted until go; it commits as the **first task** of Stage 4, under this
spec, with the doc comment amended to cite this file instead of standing alone
as the only record of the decision.

**Why required-nullable and not optional.** Identical to `rollup`
(2026-08-31-jw-challan-visibility §3.1): an optional field lets exactly one of
the five producers omit it silently, and the failure mode is a blank lot column
on a document a job worker signs. Required makes the omission a `ZodError` at
`fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.ts:136` — loud, at
the boundary, in the BE's own tests.

**Why `z.string().nullable()` and not `partyLotNoSchema`.** The value is not
minted here and is not validated here. It is `combinePartyLots`' own prior
output (`fabtraq-shared/src/primitives/party-lot.ts:17`) read back out of the
database, or a purchase's free-text `optionalText(80)` field
(`fabtraq-shared/src/schemas/transaction/yarn-purchase.ts:56`). A combined value
has no length bound by design (2026-08-20 L5: "no cap"). Constraining it on the
*response* side could only reject data the write side already accepted.

**No other shared schema changes.** `eligibleOutItemSchema`,
`weavingDispatchResponseSchema`, and the beam-receipt out-item picker are
untouched — see §3.5 for why the dispatch needs nothing.

**Lockfile rider.** The same diff moves `fabtraq-shared/package-lock.json` from
`1.24.0` to `1.28.0` — the lockfile was already three minors stale at HEAD. It is
harmless (npm reads `package.json`) and is committed with the contract change
rather than split, noted here so nobody reads it as an accidental hunk.

**Version:** `1.28.0` (minor — additive field on a response). Registry is at
`1.27.0`; `npm view` is the authority, checked again at publish (§6).

### 3.2 Backend — resolve at read time, hoisted

`findPartyLotsByLotNumbers` returns `Map<lotNumber, string | null>` and is
**single-hop by construction** (2026-08-20 L10): every generation stores its own
already-combined party lot, so no caller walks an ancestry chain. Purchase wins
over JW-In on a collision, the same precedence
`fabtraq-be/src/modules/inventory/inventory.mapper.ts:73` applies.

**Mapper.** `mapJwChallanOutRow` gains a 4th positional parameter,
`partyLotMap: ReadonlyMap<string, string | null>`, **with no default** — the
`rollupMap` precedent (`jw-challan-out.mapper.ts:46-50`): a call site that
forgets it fails at compile time, not at runtime on one endpoint.

```ts
partyLotNo: partyLotMap.get(item.lotNumber) ?? null,
```

**Why `?? null` here when `rollup` deliberately has no default.** They are
different failures. A missing rollup entry means "we did not ask how much came
back" — there is no safe value, so it must throw. A missing party-lot entry
means the lot number matched no `yarn_purchase_item` and no
`jw_challan_in_yarn_item` row, i.e. **the lot has no origin that ever recorded a
party lot** — materially the same state as an origin row whose `party_lot_no` is
`NULL`, which L2 already rules must print blank. Collapsing "absent key" and
"present key, null value" into `null` is therefore not a fallback; it is the
correct answer to the question asked. (It is also the only reachable shape for a
beam- or weaving-derived lot, which never mints a purchase or JW-In row.)

**Service — five paths, two shapes.**

| Path | How the map is built |
|---|---|
| `list` (`jw-challan-out.service.ts:206`) | Collect **every** `item.lotNumber` across the whole page, dedup, issue **one** `findPartyLotsByLotNumbers`, hoisted above `items.map` — exactly mirroring the rollup hoist at `:219-226`. |
| `create` (`:63`), `getById` (`:247`), `updateHeader` (`:263`), `cancel` (`:337`) | New private `fetchPartyLotMap(items)` beside `fetchOutItemRollupMap` (`:661-665`), one call per row. |

`list` is explicitly **not** modelled on `resolveLocksForOutRow` (`:671`), which
is N-queries-per-page; the `jw-challan-out` BRIEF §8 names copying that shape for
new per-item data as the trap this hoisting exists to avoid.

No `tx` is passed: all five are post-commit reads, consistent with how
`getOutItemRollup` is called on the same lines.

`createIn` / `cancelIn` / `updateHeaderIn` are **unchanged** — they return rows,
not responses; their callers re-hydrate through `getById` (§3.5).

**No migration, no new column, no new query in the DB layer**
(`findPartyLotsByLotNumbers` already exists and already batches). Compute stays
in the app layer.

### 3.3 Frontend — the printed challan

`fabtraq-fe/src/features/challan-print/documents/yarn-delivery.ts:20`:

```ts
item.partyLotNo ?? '',
```

Blank on null (L2, and consistent with I7 — "a printed zero is a factual claim
about the ledger"; a printed *minted* lot would be a factual claim about the
party's paperwork). The value is printed **verbatim** (L3); the document layer
does not split, re-join, re-sort, or truncate the `" / "` string —
`combinePartyLots` is the single authority and it already ran BE-side.

`fabtraq-fe/src/features/challan-print/templates/yarn-delivery.ts:7-8`:

```ts
{ header: 'Quality', widthPct: 37.0, align: 'left' },
{ header: 'Lot No.',  widthPct: 20.0, align: 'left', shrinkToFit: true },
```

**Geometry — a checked claim, not a hope.**

| Check | Before | After |
|---|---|---|
| Σ widthPct | 6.5+42.0+15.0+10.5+14.0+12.0 = **100.0** | 6.5+37.0+20.0+10.5+14.0+12.0 = **100.0** |
| Cumulative span before `boxFromColumn: 6` (`fabtraq-fe/src/features/challan-print/documents/yarn-delivery.ts:39`) | 6.5+42+15+10.5+14 = **88.0** | 6.5+37+20+10.5+14 = **88.0** |
| `labelSpanIsNarrow` (`render.tsx:208-212`, `spanPct < 50`) | 88.0 → `false` | 88.0 → `false` |

Only the internal boundary between columns 2 and 3 moves; every boundary from
column 4 rightwards, and therefore the whole totals strip, is byte-identical.
The BRIEF §8 width trap is discharged by arithmetic.

`shrinkToFit` stays on the column: a long combined party lot still shrinks to the
6pt floor and then pre-truncates with `…` rather than being handed to react-pdf's
line breaker (I2 — a forced break injects a hyphen glyph and falsifies the
identifier). L7 accepts that a 2-way long vendor-format merge truncates.

The visual matrix (`fabtraq-fe/scripts/challan-visual.ts`) is run and its PNGs
opened — the standing rule for any geometry change (challan-print BRIEF §7).
Two execution snags to budget for in the plan: `fabtraq-fe/scripts/challan-visual.ts:21-22`
hardcodes a dead session-scratchpad `OUT_DIR`, and it needs `pdftoppm` (poppler)
on `PATH`. Case 14 ("lot-no edge") is re-pointed at a party-lot value.

**What Quality loses at 37%.** Quality is *not* a `shrinkToFit` column: the
renderer gives it `maxLinesFor(height)` lines and `textOverflow: 'ellipsis'`
(`render.tsx:293-299`), so an over-long name is clipped with `…`, not shrunk.
Narrowing 42% → 37% costs ~4.9 characters on **each** wrapped line, so the total
loss scales with the line count the cell height allows. L7
measured the *lot* side only. The existing long-quality visual case
(`fabtraq-fe/scripts/challan-visual.ts:170-180`, 120 chars) is therefore the one case this change
actually degrades, and it is named in V7 as a must-open PNG. Whether a
clipped quality name is acceptable on a signed document is **open question Q3**
for the owner (§4.1); the widths themselves are L7 and are not re-argued here.

`render.tsx`, `paginate.ts`, `types.ts`, `font-metrics.ts`, `fonts.ts`: **no
change**. The renderer keeps zero domain knowledge (I1).

### 3.4 Frontend — the two detail pages (both numbers, L6)

Same cell shape in both places — party lot as the primary line, minted lot
beneath in muted text, because staff trace stock by the minted one:

```tsx
<TableCell className="text-xs">
  <div className="font-mono">{item.partyLotNo ?? '—'}</div>
  <div className="font-mono text-muted-foreground">{item.sourceLotNumber}</div>
</TableCell>
```

- `fabtraq-fe/src/features/jw-challans-out/jw-challan-out-detail.page.tsx:316`
- `fabtraq-fe/src/features/weaving-dispatches/weaving-dispatch-detail.page.tsx:296`

`—` on screen, not blank: an internal screen with an em-dash reads as "we have no
party lot for this", which is information. A blank *printed* cell is L2's
deliberate silence on a document. The two differ on purpose.

The column header stays "Lot No" / "Lot No." on both pages — a second header
would imply two columns.

`formatLotIdentity(lotNumber, partyLotNo)` (`fabtraq-fe/src/features/inventory/lib/lot-labels.ts:34`,
"LOT — partyLot") is deliberately **not** used: it is the one-line wording for
option strings in pickers, and L6 fixes a two-line stacked cell with the party
lot leading. Reusing it would invert the order L6 locks. Recorded so the FE
reviewer does not spend a round on it.

**Not a Tailwind-vs-print conflict:** these are screen surfaces; the print
surface is §3.3 and shares no code with them.

### 3.5 Weaving dispatch inherits — nothing to change

`weavingDispatchResponseSchema.weftChallanOut` is
`jwChallanOutResponseSchema.nullable()`
(`fabtraq-shared/src/schemas/transaction/weaving-dispatch.ts:168`) — the **whole**
JW-Out response, embedded. `weaving-dispatch.mapper.ts:20,55` takes it as a
parameter and passes it through; it is built by
`this.jwChallanOutService.getById(...)` at
`fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.ts:409`
(`hydrateAndMap`, serving `getById` and `updatePrintFields`) and `:309` (cancel).
Dispatch `create` returns via the same hydration; `list` deliberately does not
hydrate `weftChallanOut` at all (`:205-210`).

Therefore: **no `weaving-dispatch.ts` schema change, no `weaving-dispatch.mapper.ts`
change, no weaving-owned production BE change.** One weaving-owned **test** does
change: `fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.test.ts:100`
builds the weft response through the real mapper
(`mapJwChallanOutRow(weftRow, undefined, rollupMap)`) and must gain the 4th
argument — typecheck catches it, and it is listed in §3.6 and owned by W2. L5's "inherits it via `getById`" is
verified, not assumed. Both weft consumers — the detail weft table (§3.4) and
`printYarnDelivery(dispatch.weftChallanOut)`
(`weaving-dispatch-detail.page.tsx:150`) — get the field for free.

The one weaving-side edit is the FE cell at `:296` (§3.4), which the
`weaving-fe-reviewer` should see at Stage 4 diff review.

### 3.6 Fixtures that move in the same commits

A required field on `jwChallanOutItemResponseSchema` breaks every producer.
Complete list, verified by grep:

| File | Sites |
|---|---|
| `fabtraq-fe/tests/msw/handlers/jw-challans-out.ts` | the literal `mockJwChallanOutItem` at `:33` and the POST create handler's per-item map `~:296-320`. The items at `:80` (by reference), `:93`, `:129`, `:145`, `:181`, `:188` spread `mockJwChallanOutItem` and override scalar fields only (`sourceLotNumber`, `netWeight`, `rollup`), so they inherit the field and need no edit. The challan-print BRIEF §6 line list (`:38,131,147,183`) cites real `sourceLotNumber` lines; only its inference that those sites "build items without it" and need editing is wrong — fixed under §8 |
| `fabtraq-fe/tests/msw/handlers/weaving-dispatches.ts` | none directly — `:68` spreads `mockJwChallanOut`, so it is fixed transitively |
| `fabtraq-fe/src/features/challan-print/documents/yarn-delivery.test.ts` | `:36` |
| `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.test.ts` | every `mapJwChallanOutRow` call gains the 4th argument |
| `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.test.ts` | **no double edit needed** — the shared double `fabtraq-be/tests/helpers/inventory-service-mock.ts:18` already stubs `findPartyLotsByLotNumbers` → `new Map()`. That is exactly why V6 must assert a *non-empty* override reaches the response: with an empty-map stub plus `?? null`, a path that never calls `fetchPartyLotMap` still emits a schema-valid `null` and stays green. The mapper's required 4th parameter catches a forgotten argument, not a forgotten call. |
| `fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.test.ts` | `:100` — weaving-owned caller of the mapper (§3.5); gains the 4th argument; `weaving-be-reviewer` sees it at diff review |
| `fabtraq-be/docs/openapi.json` | regenerated with `npm run openapi:emit` and committed in the BE task — CI's drift gate (`fabtraq-be/.github/workflows/ci.yml:108-113`) fails the build otherwise (step header `:107`). Precedent: `ed2fbdc`, the rollup change |
| `fabtraq-shared/tests/schemas/transaction/jw-challan-out.test.ts` | already done in the uncommitted diff |

MSW handlers are `jsonValidated`, so a missed site fails the FE suite rather
than drifting — but only **after** FE is on 1.28.0 (§6).

---

## 4. Proposed amendment to L8 — the e2e clause is not literally implementable

**L8 says:** "`challan-pdf.spec` asserts the printed value."

**It cannot, as written.** Embedded PDF text is CID/Identity-H encoded and is
**not byte-greppable** — stated in `render.tsx:214-216` and in the challan-print
BRIEF §7 traps, and the reason `pageOfLabel`/`bodyTextFor` are exported as pure
functions and unit-tested directly instead of through a rendered buffer. There is
no assertion in the suite today that reads a *string* out of a generated PDF, and
adding one means either shipping a PDF text-extractor into the e2e harness or
routing `challan-pdf.spec` through `pdftoppm` + OCR. Both are new harness
dependencies for one assertion.

**Proposed substitute (owner rules at go):**

| Level | Assertion | Where |
|---|---|---|
| e2e — wire | `GET /jw-challans-out/:id` returns `items[].partyLotNo` equal to the party lot typed into the purchase form | `challan-pdf.spec.ts`, extending the existing live-wire block at `:92-105` |
| e2e — screen | the detail-page Lot No. cell shows the party lot **and** the minted lot | `challan-pdf.spec.ts`, beside the existing `qualityName` cell assertion at `:111-113` |
| e2e — document | unchanged: `window.open` blob captured, `%PDF-`, >10KB | `challan-pdf.spec.ts:115-155` |
| FE unit | `yarnDeliveryDocument` puts `partyLotNo` in cell index 2 and `''` when null — the actual "printed value", asserted on the `ChallanDocument` the renderer consumes | `documents/yarn-delivery.test.ts` |
| Visual | party-lot values in the 14-case matrix, PNGs opened by a human | `scripts/challan-visual.ts` |

This keeps L1/L2/L3 covered end to end. The only thing it does not prove
mechanically is that react-pdf drew the string it was handed — which no existing
test proves for any column, and which the visual matrix is the standing answer
to.

**Second e2e gap — the fixture is costlier than L8 implies.**
`e2e/support/sentinel-purchase.ts` never fills the `Party lot number for line N`
input (`PurchaseLineItemRow.tsx:178`), so every lot it mints has
`party_lot_no = NULL`. The form-driving code is the private `createPurchase`
(`sentinel-purchase.ts:29-108`), shared by both public wrappers (`:111-117`,
`:125-131`), and it has no party-lot step at all; the optional `partyLotNo`
parameter is added there and exposed on both wrappers, defaulted to omitted. The only code that
fills that input today is a private helper inside
`e2e/tests/flows/party-lot-carry-forward.spec.ts:162`; the suite forbids
importing across spec files, so the support-helper route is the right one.

The third leg — **a JW-In lot carrying a `" / "`-combined value** — has no
support helper at all: it needs a purchase ×2 with party lots → JW-Out with two
sources → JW-In minting one lot. `party-lot-carry-forward.spec.ts` (owned by
`jw-challan-in`) already builds exactly that at `:389-395`. **Proposed (Q2):**
prove L3 on the wire *there* — one extra step creating a JW-Out from the
combined lot and asserting `items[0].partyLotNo` equals the combined string —
rather than rebuilding the round trip inside `jw-out.spec`. `jw-out.spec` then
owns a **2-lot** fixture (party lot present / absent) and L3-verbatim is
additionally proven by BE integration (already required by L8). If the owner
prefers L8 literally, Stage 3 must budget a `e2e/support/` helper for the JW-In
round trip.

### 4.1 Open questions for the owner at go

| # | Question | Recommendation |
|---|---|---|
| Q1 | Accept the §4 substitute for L8's "challan-pdf.spec asserts the printed value"? | **Yes** — no test in any suite reads a string from a rendered PDF; the substitute covers L1–L3 up to the renderer. |
| Q2 | L3-verbatim e2e proof lives in `party-lot-carry-forward.spec` (existing fixture) rather than a new JW-In round trip in `jw-out.spec`? | **Yes** — reuses a fixture that exists; `jw-out.spec` keeps a 2-lot fixture. |
| Q3 | Quality is a wrapping column: at 37% it loses ~4.9 chars **per wrapped line** (527pt content width, `render.tsx:256`; 217→191pt interior at 9pt), so a 120-char name clips several words, not five characters; row height comes from the mm budget (`fabtraq-fe/src/features/challan-print/render.tsx:26-33`), so the visual matrix, not arithmetic, states the line count. Acceptable, the same way L7 accepted a truncating 2-way long lot merge? | **Yes, with the PNG opened** (V7). Real quality names on the floor are ≤ ~40 chars; if the PNG disagrees, the fallback is 39/18. |

---

## 5. Non-goals

1. **No new column, no migration.** Resolution is at read time (L4). If a future
   report needs to *filter* by party lot, that is a different spec.
2. **No fallback to the minted lot, anywhere, ever.** L2. A reader who wants the
   minted lot on paper is asking for a different column, which is also not built.
3. **`mapJwChallanOutRow` keeps positional parameters.** Converting to an options
   object would touch 5 call sites and a 211-LOC test file for no behavioural
   gain; the `rollupMap` precedent already establishes the shape. Explicitly not
   relitigated.
4. **No party lot on `eligibleOutItemSchema`** or the beam-receipt out-item
   picker. Those are internal pickers; staff pick by the minted lot
   (2026-07-27 lot-label architecture: the lot number is always the leading
   token).
5. **No party lot on the beam-issue challan.** 2026-08-20 L11 — party lot stops
   at the beam; `beamNumber` takes over as identity.
6. **No change to `combinePartyLots`,** to either write path, or to the JW-In
   carry-forward. This spec is read-side only.
7. **No `list` response change on the FE.** The JW-Out list columns
   (`jw-challans-out/columns.tsx`) do not show a lot at all; `list` carries the
   field only because L5 requires all five paths to agree.
8. **The 2026-08-20 spec is not edited.** §1.1 is the supersession record.

---

## 6. Sequencing and release constraints

**Repo order is forced, not stylistic:** `shared → be → fe → e2e`.

1. **shared** — commit the uncommitted diff, then **publish 1.28.0**.
   `npm view @pashwashah04/fabtraq-shared version` first, run from a directory
   whose `.npmrc` maps the `@pashwashah04` scope to GitHub Packages with a token
   (e.g. `fabtraq-fe/`) — a bare `npm view` 404s on the public registry (the
   registry is the authority; local `package.json` lies),
   publish from a clean tree, export-diff the built `.d.ts` against the published
   tarball before pushing the tag. **Publish is irreversible and no consumer has
   compiled against the shape yet**: before publishing, wire the BE mapper
   against a local `npm pack` tarball (`--no-save`) and get its unit tests green.
   A shape correction found then costs an edit; found after publish it costs
   1.29.0. **Clean up the rehearsal**: a `--no-save` install leaves
   `fabtraq-be/node_modules` ahead of its lockfile; commit nothing in that state,
   and after publish run a real `npm install @pashwashah04/fabtraq-shared@1.28.0`
   so `package-lock.json` moves too, or CI's `npm ci` reinstalls 1.27.0 and
   typecheck goes red. The `.vite` cache rule applies to FE only.
2. **be** — bump to 1.28.0, wire the mapper + five paths. **A BE on 1.28.0 whose
   mapper does not yet supply `partyLotNo` fails its own `parse` at
   `jw-challan-out.mapper.ts:136`** — bump and wire land in the same task.
3. **fe** — bump to 1.28.0, `rm -rf fabtraq-fe/node_modules/.vite` (a stale Vite
   dep cache bundles the old schema and the change silently does nothing), then
   §3.3, §3.4 and every fixture in §3.6 together. **FE cannot bump before BE
   ships**: `parseOrThrow` (`features/jw-challans-out/api.ts:27-64`) would reject
   every live response.
4. **e2e** — §4's spec changes, run live, one suite at a time, output to a file.

**Merge-to-main order is also forced.** `fabtraq-fe/.github/workflows/contract-smoke.yml:48-62`
checks out **shared and BE at `main`**, packs shared, installs it into BE
(`:71-80`) and runs the smoke suite against that server. If the shared PR merges
before the BE PR, main-BE's mapper meets a schema that requires `partyLotNo`,
throws at `jw-challan-out.mapper.ts:136`, and contract-smoke goes red on every
FE PR until BE catches up. The safe direction is the reverse: zod strips unknown
keys, so a wired BE against an un-bumped shared is fine. **Merge BE → shared →
FE (→ e2e), in that order, as one batch.** The owner merges; this line is the
instruction.

FE fixtures typecheck today only because FE is pinned to shared **1.27.0**
(`fabtraq-fe/package.json:28`) while the local tree is 1.28.0 unpublished. That
is the tripwire: fixtures go red the moment step 3's bump lands, which is the
intended order.

**Wave sketch for Stage 3** (the plans prove independence; this is the skeleton):
W1 = shared commit + publish. W2 = BE mapper + service + unit + integration.
W3 = FE print (§3.3) ∥ FE detail pages (§3.4) — disjoint files, both after the
bump. W4 = e2e. **e2e checkpoints:** end of W2 (wire only), end of W3, and
pre-release. `challan-pdf.spec` and `jw-out.spec` are `e2e-required`.

---

## 7. Verification

Per-task gate (format:check, lint, typecheck, unit + integration, build,
coverage, `contract:paths`, `pretest` lock, `check-citations.mjs`) **plus, for
the BE task, `npm run openapi:emit` with `docs/openapi.json` committed** — the CI
drift gate is not in CLAUDE.md's list and is the one this change trips. Then:

| # | Claim | How it is proven |
|---|---|---|
| V1 | Every one of the five paths carries `partyLotNo` | BE integration asserts it on `getById` **and** `list`; `fabtraq-fe/tests/smoke/jw-challans-out.smoke.ts` already runs `parseOrThrow(jwChallanOutResponseSchema)` against the **live** list and create responses in CI (`contract-smoke.yml:101-108`), so `list` + `create` are real-wire proven once FE is on 1.28.0; `updateHeader` + `cancel` by the V6 non-empty-override unit assertion |
| V2 | Resolves from a purchase lot | BE integration against `fabtraq_test`: a real purchase row with a party lot → `getById` and `list` return that **non-null** string. This is the only test that can catch a map keyed on `item.id` instead of `item.lotNumber` — unit tests with the empty-map double cannot (§3.6), so V2 is mandatory, not a nice-to-have |
| V3 | Resolves from a JW-In lot with a combined value, verbatim | BE integration, L8 (same real-row rule as V2); e2e per §4 / Q2 |
| V4 | Null origin → blank on paper, `—` on screen | FE unit on `yarnDeliveryDocument`; FE integration on both detail pages |
| V5 | No fallback to the minted lot | FE unit asserts the cell is `''` and specifically **not** `LOT-…` |
| V6 | Every path actually *calls* the resolver, and `list` calls it **once** per page | BE unit: on **all five** paths, override the double with a non-empty map and assert the value reaches `items[].partyLotNo` (an empty-map stub + `?? null` makes a forgotten call invisible — §3.6); for a multi-row `list`, assert exactly one `findPartyLotsByLotNumbers` call |
| V7 | Geometry unchanged from column 4 rightwards; Quality at 37% still legible | template unit test on the widths + the §3.3 table; visual matrix PNGs opened — **case 8 (120-char quality, `fabtraq-fe/scripts/challan-visual.ts:170`) and case 14 are the two that must be read**, before/after side by side |
| V8 | The weft challan inherits it | FE integration on `weaving-dispatch-detail`; e2e already exercises the dispatch flow |
| V9 | The original symptom | live: create a JW-Out from a lot with a party lot, print, **open the PDF at 100%** and read the Lot No. column. Screenshots cannot see print output |

Stage 5's 9-gate done bar applies unchanged.

---

## 8. Stale artifacts this change must fix in the same commits

Not Stage-2 edits — Stage-4 tasks, listed so no plan omits them:

1. `fabtraq-be/docs/specs/2026-08-21-challan-pdf-design.md` §4:128 states
   `Quality 42.0 | Lot No. 15.0`. Amend and **re-mirror** (that doc lives in
   be/fe/shared `docs/specs/`; it has no root copy).
2. `fabtraq-fe/scripts/challan-visual.ts` case 14's comment ("the reported string,
   15 chars", `:221`) — re-derive for 20%.
3. `.claude/agents/modules/jw-challan-out/BRIEF.md` — I16 "in flight", §3 item 11
   "no spec/plan exists on disk", §5 "`findPartyLotsByLotNumbers` is NOT yet
   called here", §6 "Missing doc". All become citations of this spec.
4. `.claude/agents/modules/challan-print/BRIEF.md` — §1 "in flight", I20 "the FE
   line does not exist yet", §6 "FE fixtures lack `partyLotNo`" (`:112` — the
   MSW line numbers are correct but the inference that those sites need editing
   is wrong per §3.6, and its `fabtraq-fe/package.json:27` should be `:28`).
5. `fabtraq-shared/src/schemas/transaction/jw-challan-out.ts:208-223` — the doc
   comment currently carries the owner decision **as the only record on disk**;
   it should cite this spec instead.

6. `fabtraq-be/docs/openapi.json` — regenerated, not hand-edited (§3.6).
7. `.claude/agents/modules/challan-print/BRIEF.md:105` says the value is resolved
   "via `findPartyLotsByLotNumbers` + `combinePartyLots`" — wrong: single hop,
   already joined, never re-derived (§3.2). `jw-challan-out/BRIEF.md:123`'s
   "unverified … not called from that service" becomes false; its I16 (`:102`)
   cites `prisma-inventory.service.ts:583-600`, the method ends at `:609`.

Per the handbook rule, a stale `file:line` citation is a finding, not an excuse —
these are re-verified when each task lands, not copied forward.

---

## 9. Provenance

- **Stage 1** brainstorm: 2026-09-01, session
  `54c5222c-86f3-48e4-9fce-9e0c823ca902`. L1–L8 locked there.
- **Stage 2** spec: 2026-09-02, session `session-1788287737705`.
- **Reviewers:** `jw-challan-out-shared-reviewer` + `critic`, in parallel,
  max 2 rounds (CLAUDE.md Stage 2).
- **Round count:** 2 of max 2. Round-2 findings applied; anything still open is listed for the owner in §4.1 and the handoff.
- **Canonical copy:** `fabtraq-be/docs/superpowers/specs/`. Mirrored byte-for-byte
  with `cp` to `fabtraq-fe/`, `fabtraq-shared/`, `e2e/`, and root `docs/`.

### 9.1 Review rounds

**Round 1 (2026-09-02, `session-1788324721003`)** — `jw-challan-out-shared-reviewer`
NO-GO (2 MAJOR, 3 MINOR); `critic` 4 MAJOR, 4 MINOR, 3 unresolved → owner.
Both independently found: the weaving-owned mapper test caller
(`weaving-dispatch.service.test.ts:100`) missing from §3.6, and the committed
OpenAPI snapshot + CI drift gate missing from every list. Also: Quality-column
clipping at 37% unverified (→ Q3, V7); the JW-In combined-lot e2e fixture
uncosted (→ Q2); publish-before-consumer ordering risk (→ §6 step 1); lockfile
rider unnoted (→ §3.1); five citations off by a line or a quotation (fixed).
All applied in this revision. Nothing was conceded by the reviewers; nothing was
rejected by the author — every finding verified on disk before being applied.

**Round 2 (2026-09-02)** — `jw-challan-out-shared-reviewer` NO-GO (1 MAJOR, 4 MINOR):
the service-test double already stubs `findPartyLotsByLotNumbers` → empty map,
which with `?? null` hides a forgotten call (→ §3.6 row corrected, V6
strengthened to a non-empty-override assertion on all five paths); MSW spread
sites also override `rollup` and `:93` was missing (→ §3.6); §8 item 4
overstated the BRIEF error (→ narrowed); `npm view` needs the scoped registry
(→ §6); CI gate header is `:107` (→ §3.6). All verified on disk and applied.
`critic` round 2 (3 MAJOR, 2+ MINOR): the same empty-map-double hazard restated
as "nothing catches a wrong key" (→ V2 made mandatory against a real row);
cross-repo **merge-to-main order** unspecified while `contract-smoke.yml`
checks out shared+BE at `main` (→ §6, BE → shared → FE); the existing live smoke
suite uncredited in V1 (→ V1); `formatLotIdentity` not discussed (→ §3.4); Q3
understated the Quality loss (→ §3.3, Q3 reworded). All verified on disk and
applied; its late tail (three more stale handbook lines → §8 item 7; `--no-save`
rehearsal cleanup → §6; MSW `:80`; §8 numbering) applied too. Its remaining
"unresolved" 1–2 are answered in §6 (merge order) and V2 (keyed by lot number
against a real row). Per CLAUDE.md there is no round 3: anything a reviewer would still
dispute is in §4.1 for the owner.
