# Sprint 8 — Weaving domain (beam dispatch out, grey fabric receipt in)

**Status:** ✅ Shipped — shared **1.16.0 published**, all four branches **pushed 2026-08-20**. Not
merged to `main`. Three post-release correctness workstreams also shipped and pushed on the same
branches (shared 1.17.0 → 1.19.1) — see [Status append — 2026-08-20](#status-append--2026-08-20-post-release-correctness-workstreams).
**Window:** 2026-07-30 → 2026-08-14
**Branches:** `feat/s6-consolidated-shared` / `-be` / `-fe` / `-e2e` (one per repo)

**Numbering note.** This sprint runs *before* [`sprint-7.md`](./sprint-7.md) (Reports, Dashboard,
UAT — still not started). The weaving domain was scoped out to "S8+" in
[`sprint-6.md`](./sprint-6.md) line 121 ("Beam-as-source / weaving domain → **S8+**") but was
pulled forward at the user's direction once the beam register and sizing-JW work landed, because
weaving is the transaction that consumes beams and without it the beam lifecycle dead-ends at
`issued_to_weaver`. Sprint 7 keeps its number and its scope.

---

## Goal

Close the beam lifecycle end to end. Before this sprint a beam could be built, sized and
registered but never leave the mill in the system; grey fabric coming back from the weaver had no
representation at all. Sprint 8 ships both legs:

- **Weaving Dispatch (out)** — issue beams to a weaver, with weft yarn delivered on the same
  physical trip via a linked JW challan-out.
- **Weaving In (return leg)** — receive woven grey fabric ("taka") back against those dispatched
  beams, reconciling both the beam meters consumed and the weft yarn drained.

---

## Scope

### 1. Weaving Dispatch — shipped 2026-08-07

Beam-issue challan (`JWB-`) plus an optional weft delivery composed from the existing
JW-challan-out machinery rather than a parallel implementation:

- New `WeavingDispatch` + `WeavingDispatchBeam` models; beams flip `received → issued_to_weaver`.
- `jw-challan-out` refactored to expose `createIn`/`cancelIn`/`updateHeaderIn` so the dispatch
  service composes weft delivery in-transaction instead of duplicating it, with boundary guards
  so a weaving-dispatch-owned challan cannot be mutated through the generic challan-out routes.
- Full cancel reversal; print-only header edits allowed while sent.
- Two print blocks on the detail page (Job Work Beam Issue / Job Work Delivery Weft Purpose),
  each with its own Print button.

Provenance: `docs/brainstorms/2026-07-30-weaving-dispatch.md`,
`docs/superpowers/specs/2026-07-30-weaving-dispatch-design.md` (§7 of which scoped Weaving In out
by name), handoff `.claude/handoffs/2026-08-07-134303-weaving-dispatch-final-push.md`.

### 2. Weaving In — shipped 2026-08-14

Grey fabric receipt (`FRC-`) with beam + weft reconciliation. Deliberately modelled on the **Beam**
precedent, not the yarn/JW-In precedent:

- **Fabric taka live OUTSIDE `stock_ledger`** — their own entity with nullable
  `locationId`/`floorId`, exactly like `Beam`. Only the weft drain writes ledger rows. Forcing
  individually-numbered physical units into the ledger fights the B-015 custody model.
- **Weft drain** = one JW-debit-only row per source via `applyWeavingInWeftLedger`, a direct
  sibling of the shipped `applyChallanInBeamLedger`. New `StockTransactionType.weaving_in`;
  `transactionId = weavingInId`; cancellation via the standard `notes='cancellation'` reversal
  rows through the generic `reverseLedger`.
- **Weft allocation is client-submitted, BE-revalidated** — the FE fetches open positions,
  computes an oldest-first suggestion, lets the storekeeper edit, and submits `weftSources[]`;
  `WeavingInService.createTx` re-validates against a live snapshot *inside the same transaction*.
- **Beam drain is implicit/derived, never stored** — `metersWoven` = Σ
  `WeavingInTakaBeam.metersAttributed` over non-cancelled receipts, computed in the application
  layer (batched, no N+1). Cancelling a receipt therefore reverses beam drain for free.
- **GLM (grams per linear metre) is always computed, never stored** — shared `computeGlm()` is
  used by both BE and FE so the preview and the persisted value cannot drift. The paper challan's
  "Avg Wt" column = GLM × 100 (verified against the sample sheet: 167,660 g ÷ 1787 m = 93.82 →
  9382).
- **New `FabricDesign` master**, separate from the beam/warp `Design`. The reviewer objected to
  the duplication; overridden deliberately after user confirmation that fabric design is a
  different vocabulary and the M:N link is the reconciliation (logged as spec risk #4).
- **Taka serials** are per-weaver **per financial year**, gapless, with the weaver's own
  `paperSerialNo` preserved in its own column.
- Beam `close`/`reopen` write surface (`issued_to_weaver → fabric_received`).
- Stock Overview gains a **Fabric tab**, reading a BE aggregate endpoint rather than
  client-aggregating page 1 (receipts accumulate forever; page-1 aggregation would silently drop
  older in-stock taka and make the stock overview lie).

Provenance: `docs/brainstorms/2026-08-12-weaving-in.md` (locked decisions WI-L1…WI-L16),
`docs/superpowers/specs/2026-08-12-weaving-in-design.md`,
`docs/superpowers/plans/2026-08-13-weaving-in-context.md` (13 cross-repo locked resolutions),
handoff `.claude/handoffs/2026-08-14-001709-weaving-in-workstream.md`.

---

## What shipped, per repo

All work is committed on the `feat/s6-consolidated-*` branches. **Nothing is pushed and shared
1.15.0 is not published to npm** — batched pending the user's go, per the standing
commit-now/push-at-end rule.

| Repo | Commits (workstream) | Gates |
|------|----------------------|-------|
| `fabtraq-shared` | 15 (base `09561db`), version **1.15.0** | 1121 tests green ᶜ |
| `fabtraq-be` | 26 (base `73182a5`) | 693 unit + 631 integration green ᶜ |
| `fabtraq-fe` | 23 (base `b84822f`) | **1265/1265 green; coverage 93.77 / 87.19 / 86.48 / 93.77** (stmts/branch/func/lines, thresholds 80/75/80) ᵐ |
| `e2e` | 12 (base `2840d7a`) | **117/117 green**, full regression from cold start ᵐ |

ᵐ measured in the closing session (2026-08-14). ᶜ carried forward from the implementation
sessions — `shared` and `be` took only a docs commit at close, so their suites were not re-run.

**shared** — `FRC-` entry-no triplet and branded ids; `FabricDesign` schema family + registry;
`WeavingIn` transaction schema family + weft-position DTO; transaction registry entries; beam
response additions (`beamTotalMeters`, `metersWoven`, `weavingDispatchId`,
`weavingDispatchBeamId`) plus close/reopen endpoints; fabric-stock aggregate with custody split;
duplicate-`beamId`-per-taka and duplicate-`outItemId`-per-challan rejection.

**BE** — migrations (6 models, `weaving_in` enum, `beamTotalMeters`); `FabricDesign` module;
inventory writer/reader plus the rollup's 5th source; `WeavingIn` repository, service
(create/cancel/list/getById) and HTTP/DI wiring; beam close/reopen and derived fields; the guards
below; T-CI-1 bounded-context allowlist extended to `weaving-in/` and `fabric-design/`.

**FE** — fabric-designs master; weaving-ins api/hooks; the three-part form (header + beam picker,
taka grid with GLM flagging, weft reconciliation panel); detail/list pages, routes and nav; beam
remaining-meters column with close/reopen; Stock Overview Fabric tab; detail print block.

**e2e** — fabric-designs master spec, route smoke + role guards, and the full-chain flow spec
(dispatch → receive → cancel-reversal → re-receive → beam close → dispatch-cancel-blocked).

---

## Defects this sprint found and fixed

Six real defects, four of which unit tests could not see. Recorded because they are the argument
for the process, not incidental history.

1. **P0 in already-shipped dispatch code** (`f8eedf3`) — `WeavingDispatchService.cancel` restored
   beams with an unconditional update, so a beam that had *already yielded fabric* would silently
   revert to `received` and become re-issuable. Fixed with per-beam conditional `updateMany` +
   count assertion. The general rule: every multi-row status flip uses `updateMany({where:{id,
   status:'X'}})` + count assertion on **both** the create and the reverse path.
2. **WI-L6 never implemented** (`453e899`) — `beamTotalMeters` was only ever written by the manual
   backfill endpoint, never prefilled at dispatch, which hard-blocked the entire receive flow for
   any freshly-dispatched beam. Caught **only** by the live e2e chain.
3. **Weft ceiling race + stale beam totals** (`aba846f`) — the ceiling check read outside the
   transaction, and `beamTotalMeters` resolution could silently use a *cancelled* dispatch's stale
   value as both the derivation divisor and the over-drain ceiling.
4. **Silent-ledger-class FE bug** (`fc4d692`) — a taka's `beamOverride` was not pruned when the
   header beam selection changed, so drain could be attributed to a beam the user had deselected
   and could no longer see. Same shape as the B-013 and place-stock bugs.
5. **Print block never printed** (`8204464`) — the weaving-in detail page's own
   `@media print { header { display: none !important } }` rule outranked Tailwind's `print:block`
   on the print block's own `<header>`, so the printed grey-fabric-receipt came out with no title,
   no challan number and no weaver. Invisible to every prior check: the flow could not reach the
   page live, and a screen-media screenshot cannot show a print-only block. Fixed with the
   `.print-block` escape hatch the dispatch page already established, plus the weaver / paper
   challan no / date identity line and the signature footer the paper form carries. Now asserted
   under `emulateMedia({ media: 'print' })`, and that assertion was falsified against the pre-fix
   build to confirm it is not vacuous.
6. **e2e suite did not boot the PDF parser** (`fed4c83`) — the design-v2 PDF-import specs proxy
   through the BE to the standalone `fabtraq-pdf-parser` service, but `playwright.config.ts` only
   booted BE and FE. A full run failed three specs purely because the service was down: a false
   red indistinguishable from a product regression. Added as a third `webServer` entry.

Two **spec** bugs (not product bugs) were also fixed in the e2e flow spec: absolute ledger
assertions that violated this suite's own "deltas, never absolute" rule and so only passed on a
freshly-seeded DB; and driving a beam-attribution popover that the UI deliberately does not render
when a single header beam is selected (`effectiveBeamLinks` attributes the full meters
implicitly).

---

## Verification performed

- FE, this session: `format:check`, `lint`, `typecheck`, `build`, and a serial full-suite coverage
  run — all clean. shared / BE gates were run in the implementation sessions and not repeated at
  close (docs-only commits since).
- e2e: the weaving-in flow spec run **three consecutive times with no reseed**, specifically to
  prove the delta-assertion property rather than assume it.
- **Full `npm run e2e` regression from a cold start: 117/117 green.**
- The weaving-in detail print block verified visually under print-media emulation against
  `job-work-weaving-in.jpeg` — title, challan no, weaver, paper challan no, date, the seven-column
  taka grid, totals row and signature lines all present and matching the paper layout.

**Pre-existing FE suite flake (not caused by this sprint, not fixed here).** The full FE suite is
load-flaky: successive `npm run test:coverage` runs failed 1, then 4, then 3, then 1 test, with a
*different* set each time, across `beam-receipts/form.page`, `jw-challans-in/form.page` and
`inventory/balance.page`. Every one of them passes in isolation (70/70 for the three files
together), and all failures are `Test timed out` under parallel load rather than assertion
failures — some tests carry their own hardcoded 15 s timeout that loses when workers contend.

Run serially (`npx vitest run --coverage --no-file-parallelism`) the suite is **1265/1265 green**,
which is where the coverage figures above come from. Worth fixing on its own ticket: as it stands
CI can go red for reasons unrelated to any change, and — because vitest suppresses the coverage
report whenever a test fails — a flaky run also silently produces no coverage numbers at all.

**Pre-existing FE format drift.** `npm run format:check` (CI step 4) reports style issues in **228
files** repo-wide. This predates the sprint; `weaving-in-detail.page.tsx` was itself already
unformatted before this sprint touched it, and has now been brought to prettier-clean. The other
227 are left alone deliberately — reformatting them is a large unrelated diff and belongs on its
own ticket.

---

## Definition of Done

- [x] Weaving dispatch: beam issue + weft delivery + cancel reversal
- [x] Weaving in: taka receipt, beam attribution, weft reconciliation, cancel reversal
- [x] Beam lifecycle closes (`received → issued_to_weaver → fabric_received`, with reopen)
- [x] Fabric visible in Stock Overview via a BE aggregate
- [x] Print blocks match the paper challans, verified under print media
- [x] Full e2e regression green from a cold start
- [x] Sprint doc written and mirrored to all four repos
- [ ] `npm publish` shared 1.15.0
- [ ] Bump `@pashwashah04/fabtraq-shared` `^1.14.1` → `^1.15.0` in **both** `fabtraq-be` and
      `fabtraq-fe` `package.json`, reinstall, re-verify
- [ ] Push all four branches (explicit user approval required)

---

## Known gotchas for whoever picks this up

- **BE and FE `package.json` still pin `^1.14.1`** while `node_modules` holds an unsaved 1.15.0
  tarball. A plain `npm ci` will silently downgrade shared and break the build. Publish and bump
  before any clean install.
- After a tarball install, `rm -rf fabtraq-fe/node_modules/.vite` — the dev server otherwise
  bundles the stale shared schema.
- `fabtraq-be/prisma/seed.ts` is non-idempotent (pre-existing, unrelated): `db:seed` fails unless
  preceded by `db:reset`.
- Single-spec e2e runs do **not** reseed; full `npm run e2e` does `db:reset && db:seed` and wipes
  `fabtraq_dev`.
- The T-CI-1 bounded-context guard is a hardcoded directory allowlist. Any new module touching
  `stock_ledger` must be added to it or the rule is silently unenforced.

---

## Deferred

- **B-021** — at-JW balance checks do not serialize across concurrent transactions (insert-only
  ledger, READ COMMITTED, no row lock). Systemic — JW-Out has the same shape — and low practical
  risk with a single storekeeper.
- Optional debt: `fabtraq-shared/src/primitives/entry-no.ts` now carries six near-identical
  format/isValid/schema triplets; a `makeEntryNoTriplet(prefix)` factory would collapse them.
- Out of scope by design (spec §7): taka split, checking/grading workflow, fabric sale /
  dispatch-to-processing, weaver billing from `jobRatePerMeter`, ITC-04 one-year return flag.
- Open question never asked or answered: should a *cancelled* dispatch's beams be re-issuable
  after a cancelled receipt existed against them? Current behaviour after this sprint's fix: yes
  (cancelled receipts no longer block).

---

## Status append — 2026-08-14: Fabric Taka Register + per-taka placement

**Origin:** user question during manual testing of Weaving In — *"where is the page of fabric taka
where I can see all the stock? Is this not mentioned in any plan?"* It was not. WI-L1 locked
"taka-level register **+** aggregate view"; Weaving In shipped the data model and the aggregate
(Stock Balance → Fabric tab) but never the register. Spec §7's deferral list does not mention it,
so it fell through the gap between "receipt entry" and "stock overview" rather than being a
conscious omission.

**Docs:** `docs/brainstorms/2026-08-14-fabric-taka-register.md` (FTR-L1…L14),
`docs/superpowers/specs/2026-08-14-fabric-taka-register-design.md` (v2),
`docs/superpowers/plans/2026-08-14-fabric-taka-register-context.md` (locked cross-repo contract)
plus one implementation plan per repo. All mirrored to all four repos.

### What shipped

A searchable per-roll register at `/fabric-takas` with a detail page, bulk placement, and — the
change that makes it usable — **location capture on the weaving-in receipt itself**. Requires **no
Prisma migration**: `FabricTaka.locationId`/`floorId` already existed.

| Repo | Commits | Verified gates (re-run independently by the lead) |
|------|---------|---------------------------------------------------|
| `fabtraq-shared` → **1.16.0** | 6 | 1145/1145 (was 1121), lint/typecheck/build clean |
| `fabtraq-be` | 9 | 714 unit (was 693) + 652 integration, all gates clean |
| `fabtraq-fe` | 6 | 1281/1281 (was 1265), coverage 93.65 / 87.02 / 86.32 / 93.65 |
| `e2e` | 6 | **122/122** (was 117), two consecutive uncontended full runs |

### The design debate earned its keep

Three agents (adversarial critic / domain reviewer / simplification advocate) reviewed the v1 spec
before any code. They found **three errors in the spec itself**:

1. **§2's premise was factually wrong.** It claimed `locationId`/`floorId` were "never written".
   They are: `createFabricTakaSchema` accepts them as *independent* optionals and the service and
   repository persist them **with no validation at all** — so `POST /weaving-ins` accepted an
   inactive location, a floor from a different location, or a floor with no location. A latent
   defect in already-shipped code, found by reading. Closed by §3.0's guard, shared with the
   placement path (B-016: guards on create AND edit).
2. **The feature would have shipped permanently reading "Unplaced".** The receipt form had no
   location field, so the design required re-entering, on a second screen, a location the
   storekeeper knew while the rolls were being put on the rack. Nobody sustains that. FTR-L9 moved
   capture to the receipt header; the register became the correction/move surface.
3. **The taka serial collides.** `nextTakaSequenceForWeaver` keys on `${FY}:${weaverId}`, so
   `takaNo` restarts per weaver per year, while the display format `TK-<FY>/<n>` carries no weaver
   — two weavers both produce `TK-2026-27/1`. Harmless until a feature leans on it as an
   identifier. FTR-L11 switched the register to `FRC-<challan> / <weaver serial>`, which is
   provably unique and is what the mill says on the phone; falls back to `/#<takaNo>` because
   `paperSerialNo` is nullable (and null for every taka currently in the DB).

They also removed work: no new BE repository (no module here splits one aggregate across two), one
response schema instead of two, `LocationFloorSelect` reused verbatim, and `DataTable` left
untouched — it has no row-selection support, so selection state lives in the register page rather
than modifying a component sitting behind ~15 pages.

A fourth spec error surfaced during execution: §4 specified days-in-stock from `createdAt`, which
is data-entry time. Corrected to the receipt `date` — ageing on the rack starts when the fabric
arrived.

### Two e2e test-isolation defects (no product bugs)

Neither was a product bug; both were the new spec contending for shared fixtures, and both were
caught only by full-suite runs.

1. **Shared seed lot.** The spec drew weft from the same lot `jw-out.spec.ts` targets, starving it.
   Proven causally — removing only the new spec made the suite green. Fixed by funding its own lot
   via an API-driven purchase, not by reordering files or lowering quantities.
2. **Shared job worker.** Subtler and intermittent (2 failures in 7 runs, 0 in 3 without the spec).
   `suggestWeftAllocation` drains open at-JW positions FIFO filtered on `jobWorkerId` + `qualityId`
   but **never on lot**, and FTR-L12's cancel credits weft back to a position that outlives the
   test (cancel reverses the receipt's drain, not the dispatch). When quality coincidentally
   matched — which drifts across a full run as other specs deplete lots — the greedy fill took
   weaving-in.spec's 9 kg from the leftover position, leaving its own ledger key at delta 0. Fixed
   by minting a private weaver, making the candidate sets disjoint by construction rather than
   merely improbable.

### Process note worth keeping

Three separate runs were invalidated by two agents running against the single shared `fabtraq_dev`
concurrently — twice caused by the lead reading an agent's "idle" notification as a stall. An idle
notification is emitted between tool rounds and does **not** mean stopped. One further run was
invalidated by the Vite dev server being killed mid-run under memory pressure
(`ERR_CONNECTION_REFUSED`, 14 unrelated failures). Parallelise agents across *repos*; the database
is exclusive, and "my command returned" is not "the resource is free".

### Adversarial review round (2026-08-14, post-implementation)

Three reviewers (BE / FE / shared+e2e) attacked the shipped code. Gates were already green; the
review found **three defects no gate could see**, which is the argument for doing it at all.

1. **FE P1 — a half-filled header bricked the receipt form.** `LocationFloorSelect` fires
   `onFloorChange('')` when the location changes; the mapper tested `!== undefined`, so `''` passed
   through and every save failed with `Must be a valid UUID`, with no field-level error and no way
   to un-pick the location. Worse, shared's both-or-neither refinement computes
   `hasFloor = floorId !== undefined`, so with `''` it never fired — **§3.0's guard was present in
   the code but dead**. Fixed at the wire chokepoint (`a34b0fd`), with a co-located `<FieldError>`
   and a test verified to fail against the pre-fix source.
2. **BE P1 — the feature's only write was untested.** Changing `data: { locationId, floorId }` to
   `data: {}` left every test green. Fixed with a persistence assertion, mutation-tested red→green
   (`74ae10c`). The same review found `place()` issuing ~300 queries inside a 5 s transaction to
   build data it discarded — replaced with one `findMany` (`0721021`), a net deletion.
3. **shared P1 — an open drift gate.** `fabricTakaRegisterRowSchema.date` was a bare `z.string()`
   while both siblings in the file use `.datetime()` and the BE emits `toISOString()`. A mock could
   emit `'2026-08-12'`, pass validation on both sides, and render `NaN` in days-in-stock — the
   B-005/B-006 failure mode. Tightened with a table-driven test locking it, plus a `.max(200)` cap
   on the previously unbounded `search` (`224e551`). No version bump: 1.16.0 was not yet published.

Also fixed: a cancel race that could leave a placed taka on a cancelled receipt (`4b9180a`),
`beamLinks` hydrated on the list contrary to §3.1 and an untrimmed search string (`f9ad592`), cache
invalidation missing on create/cancel, the absent receipt→register link, and running totals
disagreeing with the submitted payload (`0367aad`, `2b1e081`, `b96df91`).

Reviewers also **confirmed correct**: e2e delta discipline throughout, fixture ownership genuinely
closed, repeat-run safety, the helper extraction as behaviour-preserving line by line, the search
OR nesting inside the AND, the int4 bound, and the `{id:'asc'}` tiebreak.

### Final verified gates (all re-run by the lead after the fixes)

| Repo | Result |
|------|--------|
| `fabtraq-shared` | 1148/1148 · lint/typecheck/build clean |
| `fabtraq-be` | 714 unit + 653 integration · all gates clean |
| `fabtraq-fe` | 1291/1291 · coverage 93.81 / 87.21 / 86.63 / 93.81 |
| `e2e` | **122/122**, two of three full runs green (see B-027) |

### Backlog logged

**B-022** unbounded fabric-stock aggregate read · **B-023** nothing records fabric leaving the
godown (mitigated by relabelling the Fabric tab count "Received") · **B-024** declared vs derived
lot totals on the receipt (the paper challan carries both) · **B-025** filter/sort by `cutNotation`
· **B-026** test helper emits an invalid transporter code prefix (`TR-` vs `TRP`) · **B-027** low-rate
load-sensitive e2e timeout flake.

### Release — 2026-08-20 (Definition of Done closed)

Done on the user's explicit go (session
[`session_01XDj53MdB2b3LTTfy5yjxfs`](https://claude.ai/code/session_01XDj53MdB2b3LTTfy5yjxfs)).

- **shared 1.16.0 published** to `npm.pkg.github.com` (shasum `8e74f0475e48b5baa1e7979baff82dc7825fc4df`).
- **1.15.0 was deliberately skipped.** Once BE/FE moved to `^1.16.0` nothing could ever resolve
  1.15.0, and publishing it would have meant a detached build of `30bffbf` for zero consumers. The
  registry gap `1.14.1 → 1.16.0` is intentional, not a mistake to be repaired later.
- `@pashwashah04/fabtraq-shared` bumped `^1.14.1 → ^1.16.0` in `fabtraq-be` and `fabtraq-fe` and
  reinstalled **from the registry** — both lockfiles now carry the published tarball's integrity
  hash, which is the proof that what shipped is what was tested.
- All four branches pushed: `feat/s6-consolidated-{shared,be,fe,e2e}`.

Re-verified after the bump (dev servers stopped first; `fabtraq_dev` was reset by the integration
run and re-seeded afterwards):

| Repo | Result |
|------|--------|
| `fabtraq-shared` | 1148/1148 · lint/typecheck/build clean |
| `fabtraq-be` | 714 unit + 653 integration · lint/typecheck/build clean |
| `fabtraq-fe` | 1297 tests · coverage thresholds met · build clean |

One FE integration test (`jw-challans-in/form.page.test.tsx`) hit a 5 s timeout while the BE suite
ran concurrently on the same machine; green in isolation and green on the coverage re-run. Same
shape as [B-027](../backlog.md#b-027--e2e-suite-has-a-low-rate-load-sensitive-timeout-flake).

**e2e was not re-run.** The bump swaps a local tarball for the byte-identical published artifact;
122/122 from 2026-08-14 stands.

### Still outstanding

- **B-028 (new, found while releasing).** `npm run format:check` fails on already-committed files
  in three repos — be 140, fe ~225, shared 46. It is step 2 of CI in all three. `fabtraq-fe` builds
  every branch, so **its CI is failing on the branch pushed today**; be and shared only build `main`
  and PRs into it, so theirs lands on the merge PR. Left unfixed here deliberately: a ~400-file
  whitespace commit would bury the one-line version bump this release is supposed to be.
- **Nothing is merged to `main`** in any repo (be +221, fe +251, shared +121 commits ahead;
  e2e +63 ahead of `master`). Open since S6.
- **Sprint 7** (Reports, Dashboard, UAT) not started.

---

## Status append — 2026-08-20: post-release correctness workstreams

Three workstreams landed **after** the Sprint 8 release above, all on the same four
`feat/s6-consolidated-*` branches, all **pushed**, with shared **1.17.0 → 1.19.1 published** to
`npm.pkg.github.com` and consumed from the registry by both `fabtraq-be` and `fabtraq-fe`
(lockfiles carry the published tarball's integrity hash for `1.19.1`).

Written up on 2026-08-20 in session
[`session_01TNUv9gbV11RniPWVs456Lo`](https://claude.ai/code/session_01TNUv9gbV11RniPWVs456Lo), from
the git/registry record plus the two specs — the implementation sessions did not leave a handoff.

They are recorded here rather than as a new sprint: Sprint 7 (Reports, Dashboard, UAT) has not
started, and these are post-sprint correctness work in the shape `sprint-6.md` already uses for its
own post-S6 bug-fix appends.

### 1. JW-Out placement conservation (L23)

**Origin:** `JWO-2026-27-026` dispatched 100 kg of a lot holding 50 kg and wrote **zero**
`stock_ledger` rows. Both `assertLotBalances` and `applyChallanOutLedger` iterate `item.placements`;
the item had none, so both loops were no-ops and `netWeight` was never compared to anything. The
source lot still read its full balance and could be issued again.

**Decision (L23, amends L14):** L14's "placements may be filled in later" is **inbound-only**.
Outbound requires `Σ placements.quantity === netWeight` (±0.001) at save time. Inbound keeps its
awaiting-placement bucket, which is the asymmetry that produced the bug.

Three checks, per spec §3: check 2 (conservation) enforced **twice** — in the shared zod schema
(covers both HTTP routes and both FE forms in one edit) and as a `JwChallanOutService` guard (covers
the internal `createIn` caller and unit-test inputs that never reach zod); check 1 (`netWeight ≤`
the lot's on-floor balance) is FE-only fast feedback, mathematically implied on the backend; check 3
already existed. No migration, no response-shape change.

**Consequence:** the L11 accountant/storekeeper split no longer applies to JW-Out — out-items are
always created `fully_placed`, so the `jw_challan_out_item` branch of the Place Stock queue is dead
for new data. Left in place for pre-existing rows (**B-029**).

Shared **1.17.0**. Docs: `docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md`,
plan `docs/superpowers/plans/2026-08-20-jw-out-placement-conservation.md`, brainstorm L23.

### 2. JW-In status + cancelled-parent placement guard + ledger repair

**Origin:** user report on `JWI-2026-27-016` ("no option to place the stock"), which surfaced three
defects of the same family — **cancellation and provenance were inferred rather than recorded**.

- **`jw_challans_in.status`** (`active | cancelled`) — JW-In was the only transaction whose
  cancelled state existed nowhere but as reversal rows in `stock_ledger`, re-derived on demand by
  `hasReversalRows()`. A cancelled receipt was byte-for-byte identical to a live one and its Cancel
  button stayed enabled forever. Migration backfills from the ledger markers (L9: backfill is
  mandatory here, unlike the party-lot one).
- **Cancelled-parent guard** — `parentActive` projected through the one resolver every placement
  path already calls, rejecting writes under any dead parent, for all three source types.
- **`mintPlacements` fix** (`505ba54`) — skipped on empty placements, leaving status at the
  `fully_placed` DB default, so unplaced JW-In items never reached the Place Stock queue. This is
  the defect the user actually reported.
- **Ledger repair script** (`62375a0`, made idempotent by net-position grouping in `a3c68e2`) —
  reverses rows written against already-cancelled parents. In `fabtraq_dev` that was **125 kg of
  phantom yarn on real floors** (`LOT-260820-0003` 100 kg + `LOT-260820-0004` 25 kg): each lot nets
  to zero so no aggregate alarm fires, but per position it is bucket −q and floor +q. The script was
  **run against `fabtraq_dev` and every affected position verified back at 0.000**; it is
  mutation-tested and safe to re-run.

**The tagging asymmetry is load-bearing** (spec §4.0): `applyPlacementLedger` writes
`placement`-tagged bucket→floor pairs for `yarn_purchase_item` / `jw_challan_in_yarn_item` but
**`challan_out`**-tagged floor→JW pairs for `jw_challan_out_item`. So `cancelIn` reversing only
`challan_out` is correct, not a missing step — an earlier draft recorded it as a defect and proposed
a shared reversal function; that proposal is **withdrawn**.

Shared **1.18.0** (`JwChallanInStatus` on the JW-In response, `parentActive` on the place-stock item
detail). FE surfaces the status and gates edit/cancel actions on it for both yarn purchases and JW-In
receipts.

### 3. Party-lot carry-forward

The vendor's party lot number now survives every job-work hop and stays visible on returned yarn
until that yarn becomes a beam.

**Approach A — denormalized per generation** (L10): each JW-In yarn item and each beam composition
source stores its **own** resolved party lot, combined from its immediate sources, so resolution is
a single hop at any chain depth — no recursion, no graph walk. Combining rule (L5): drop
null/empty/whitespace, trim, dedup, **sort**, join with `' / '`, `null` when nothing survives, no
cap. Strictly derived and read-only (L2) — no form field, no override, no API input. Party lot stops
at the beam (L11); `beamNumber` takes over, though composition rows still snapshot their sources'
values. **No backfill** (L3) — the 16 historical JW-In yarn items stay `NULL` and render `—`.

Shared **1.19.0**, then **1.19.1** after review found `combinePartyLots` was neither idempotent nor
associative — re-combining an already-combined value (the third hop) would have duplicated tokens.

### Commits

| Repo | Workstream commits (after the release commit) | Shared version |
|------|-----------------------------------------------|----------------|
| `fabtraq-shared` | `92ee267` → `0b32006` (8) | 1.17.0 → 1.19.1, all published |
| `fabtraq-be` | `505ba54` → `80f784e` (17) | consumes 1.19.1 from the registry |
| `fabtraq-fe` | `da6e153` → `166a1cc` (7) | consumes 1.19.1 from the registry |
| `e2e` | `76e35d0` → `102e37c` (6) | n/a |

Two live-testing fixes also landed just **before** the release commit and are not covered by the
release append above: the weaving-in weft-ceiling Save gate (`3404e18`) and the beam picker clearing
its own selection while its list reloaded (`941d0e5`, `14370af`).

### Verification status ᶜ

Gates for these three workstreams were run **in their implementation sessions** and are asserted by
the commit trail (BE branch-coverage gate closed by `903da79`/`27e5d65`; final-review gaps closed by
`03bc381`; e2e specs added for the JW-Out refusal, the cancelled-parent queue exit, and party lot
across two hops plus third-hop idempotency). They were **not re-run when this append was written**,
so no test counts are quoted here — quoting carried-forward numbers as if measured is the failure
mode this doc exists to prevent. Re-run the four repos' gates before the merge-to-`main` PR.

### Backlog logged

**B-029** dead `jw_challan_out_item` Place-Stock branch · **B-030** re-enter `JWO-2026-27-026`
(likely moot — the row was destroyed when the e2e suite truncated `fabtraq_dev`; it survives only in
`db-snapshots/fabtraq_dev-2026-08-20-pre-conservation-tests.sql`) · **B-031** JW-Out row's unit
`<Select>` not pinned to the picked lot · **B-032** guard messages wrap one word per line in the
~70px `Net Wt` cell · **B-033** Totals row renders `NaN` for blank Bags / Gross Wt.

### Still outstanding

Unchanged from the release append above: **B-028** first (it fails `fabtraq-fe` CI on every push
today and blocks the merge PR everywhere), then **merge to `main`** — nothing has ever been merged
in any repo — then **Sprint 7**.
