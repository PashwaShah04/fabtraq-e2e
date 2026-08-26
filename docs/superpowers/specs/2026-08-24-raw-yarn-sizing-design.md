# Direct Raw-Yarn → Sizing — Design

> **Status:** locked 2026-08-24 (session `session-1787554454119`).
> **Supersedes:** the `sizing` row of the L18 predicate table in
> `docs/brainstorms/2026-05-19-jw-domain-redesign.md` §L18.
> **Precedent:** the same table's `weaving` row was already amended once, by
> `docs/superpowers/specs/2026-07-30-weaving-dispatch-design.md` §3.3 (WD-L3).

---

## 1. Problem

A sizing JW-Challan-Out can only be raised against a source lot that already
carries `warping` in its `processedTypes`. Raw yarn (`processedTypes = []`)
is rejected at `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts:518`
with `BUSINESS_RULE_VIOLATION` / `details.code = 'INVALID_SOURCE_STATE'`, and
never appears in the FE `SourceLotPicker` at all.

The mill does in fact send raw yarn straight to a sizing job worker. There is
no warping leg in that chain — not an unrecorded one, not an implicit one.
Today that transaction cannot be recorded in the system.

### 1.1 Why the design assumed a warping leg

L18 was written when the beam track was speculative (S5; "beam-track ships the
predicate but isn't user-selectable until S8+"). The chain was modelled as the
textbook one — warp, then size, then weave — and each predicate was written to
require its immediate predecessor. That produced
`sizing: P.has('warping') && !P.has('sizing') && !P.has('weaving')`.

It is the only predicate in the table shaped that way. `twisting`, `gassing`,
`dyeing` and `warping` are all "not already done, and not already on the beam
track"; they gate on what must NOT have happened, never on what must have. The
`sizing` row is the odd one out, and the `weaving` row already had to be
corrected off the same faulty assumption in WD-L3.

### 1.2 Blast radius (verified, not assumed)

The thing that would have made this expensive is not present.

- **The `Beam` entity is minted at the sizing RECEIPT, not at warping.**
  `fabtraq-be/src/modules/beam-receipt/beam-receipt.service.ts:584-600`,
  `tx.beam.create(...)` inside `createSizingJw`, `beamOrigin: 'sizing_jw'`.
  Warping-IN produces an ordinary warped **yarn lot**
  (`JwChallanInYarnItem`, `processedTypes: ['warping']`, `prisma/schema.prisma:468-497`)
  — no `Beam` row, no beam-specific fields. So dropping the warping leg does
  not relocate where a first-class entity is born. There is no beam concept at
  all before the sizing receipt.
- **`isValidInputState` is the only gate on sizing source eligibility.**
  Two call sites, both consuming the shared primitive, neither with its own copy
  of the rule: BE `jw-challan-out.service.ts:518` (`assertLotInputStates`) and
  FE `src/shared/components/SourceLotPicker.tsx:55`.
- **Nothing downstream re-derives "sized implies warped".**
  - Beam-receipt eligibility filters on the OUT **challan's declared**
    `jobWorkTypes has 'sizing'` (`prisma-beam-receipt.repository.ts:172`), not
    on the source lot's `processedTypes`.
  - `createSizingJw` re-asserts `challan.jobWorkTypes.includes('sizing')`
    (`beam-receipt.service.ts:500-505`) — again the declared types, not lot state.
  - The yarn-vs-beam eligible-out-item split
    (`prisma-inventory.service.ts:1128`, `BEAM_TRACK_TYPES`) routes on the
    challan's declared `jobWorkTypes`. A raw→sizing OUT declares `sizing`, so it
    is correctly excluded from the yarn picker and included in the beam picker
    with no change.
  - A repo-wide grep for `'warping'` across `fabtraq-be/src`, `fabtraq-fe/src`
    and `fabtraq-shared/src` returns only the sites above plus the enum
    definition and the predicate itself.
- **No migration.** `processedTypes` is already a free `JobWorkType[]` column.
  No enum change, no backfill, no data repair.

### 1.3 Existing data

Unaffected. Every historical sizing challan was raised off a warped lot and
still satisfies the relaxed predicate — the change only widens what is
accepted, never narrows it. No existing row becomes invalid.

---

## 2. User decisions (2026-08-24)

| # | Question | Decision |
|---|---|---|
| D1 | Is this one job worker doing warping+sizing in one trip, or sizing that genuinely accepts un-warped yarn? | **Sizing genuinely takes raw yarn.** No warping stage exists in that chain. |
| D2 | Should the intermediate warped stage be recorded implicitly? | **No.** A directly-sized beam's provenance carries `sizing` and no `warping`. |
| D3 | Shared package version bump | **Deferred.** Ship the change unversioned; the bump and republish are decided separately. See §4. |

---

## 3. The change

One predicate. `fabtraq-shared/src/primitives/job-work.ts:36-37`:

```diff
       case 'sizing':
-        return P.has('warping') && !P.has('sizing') && !P.has('weaving');
+        return !P.has('sizing') && !P.has('weaving');
```

### 3.1 Why this shape and not a special case

The relaxed rule makes `sizing` structurally symmetric with `warping`
(`!P.has(self) && !P.intersects(downstream)`), which is the shape every other
row in the table already has. It reads as one sentence: *a lot may be sent for
sizing unless it has already been sized, or already been woven.*

The rejected alternative — an `allowUnwarped` flag, or a second predicate
variant selected by challan kind — would encode the mill's process choice into
the eligibility primitive. Eligibility answers "can this lot physically be the
input to this process." Whether a particular customer's chain includes warping
is not that question, and putting it there would mean the next chain variant
needs a third flag.

### 3.2 What stays blocked

| Source `processedTypes` | Sizing allowed? | Why |
|---|---|---|
| `[]` (raw) | **yes — new** | D1 |
| `['twisting']`, `['dyeing']`, `['twisting','gassing']` | **yes — new** | Same rule; any pre-beam yarn state is a legitimate sizing input |
| `['warping']` | yes (unchanged) | The existing warped-lot chain |
| `['sizing']`, `['warping','sizing']` | no | Cannot size twice |
| `['weaving']`, `['warping','sizing','weaving']` | no | Cannot size after weaving |

### 3.3 Free consequence: `['warping','sizing']` on one challan

Today a JW-Out declaring `jobWorkTypes = ['warping','sizing']` is
**unsatisfiable for every possible lot state** — `warping` demands
`!P.has('warping')` while `sizing` demands `P.has('warping')`, and
`isValidInputState` evaluates both against the same snapshot
(`jobWorkTypes.every(predicate)`, `job-work.ts:43`). The FE
`JobWorkTypeMultiSelect` offers both checkboxes independently
(`JobWorkTypeMultiSelect.tsx:9`), so a user can construct the combination and
be rejected by every lot they try.

After the change that combination becomes valid on any pre-beam lot. This is
accepted, not merely tolerated: it is exactly the right wire shape for a single
round-trip where one worker warps and sizes. Nobody can be depending on the
current behaviour, because the current behaviour is a guaranteed 422.

### 3.4 Accepted consequence: two beam provenance shapes

Per D2 a directly-sized beam's source lot carries `processedTypes` without
`warping`, while the classic chain carries `['warping']`. Lineage and trace
views render `processedTypes` verbatim and make no inference from it, so both
shapes display correctly today.

The standing rule this creates, recorded here so a future reader does not have
to rediscover it: **the absence of `warping` means "no warping leg was recorded",
not "the yarn was not warped."** Any future report that wants to distinguish
warped-in-house from not must carry an explicit field on the receipt. It must
not infer the distinction from the absence of a `processedTypes` member.

---

## 4. Contract & versioning

`isValidInputState`'s signature is unchanged; this is a pure behaviour
relaxation inside the function body. No schema, no registry entry, no endpoint
shape changes. BE and FE both consume the primitive and need no code change of
their own.

Per **D3 the shared version bump is deliberately NOT part of this workstream.**
`fabtraq-shared/package.json` stays at `1.21.0` and no CHANGELOG release
section is written. Consequence, stated plainly: until the bump-and-publish is
decided and executed, BE and FE resolve the *published* `1.21.0` and still see
the old predicate. The BE integration test and the e2e spec in this workstream
therefore only pass against a locally-linked or tarball-installed shared build.
Both plans call this out at their verify step rather than silently working
around it.

---

## 5. Verification

| Gate | What proves it |
|---|---|
| shared unit | `tests/primitives/job-work.test.ts` Group E rewritten: raw / twisted / dyed accepted, warped still accepted, double-sizing and post-weaving still rejected; Group G gains the `['warping','sizing']` compound case |
| BE integration | `tests/integration/jw-challan-out.routes.test.ts` — a sizing JW-Out off a raw lot returns 201 and writes the `challan_out` ledger leg; the double-sizing rejection keeps returning `INVALID_SOURCE_STATE` |
| FE | No code change. Existing `SourceLotPicker` tests re-run to prove no regression |
| e2e (live) | New case in `tests/flows/beam-receipt.spec.ts`: own-fixture raw lot → sizing JW-Out (no warping leg) → `sizing_jw` beam receipt, asserting the `Beam` row is minted and the at-JW position drained. The existing warping-first case stays as the regression guard |
| docs | This spec + the amended L18 row mirrored byte-for-byte across `docs/`, `fabtraq-shared/docs/`, `fabtraq-be/docs/`, `fabtraq-fe/docs/`, `e2e/docs/` |

---

## 6. Out of scope

- The shared version bump and republish (D3).
- Any FE affordance that *encourages* raw→sizing (a chain-preset, a warning
  banner, a "direct sizing" toggle). The picker simply stops excluding lots.
- Reporting that distinguishes warped-in-house beams from directly-sized ones
  (§3.4). No such report exists; when one is wanted it needs an explicit field.
- The `['warping','sizing']` single-trip flow as a *product feature* — §3.3
  makes it expressible, but no UI guides a user to it and no test asserts the
  end-to-end round trip beyond the shared-level predicate case.
- Merging to `main`. This workstream ends at pushed branches + PR links.
