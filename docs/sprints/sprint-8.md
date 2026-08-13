# Sprint 8 — Weaving domain (beam dispatch out, grey fabric receipt in)

**Status:** ✅ Code-complete, fully verified, **unpushed and unpublished** (awaiting user go)
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
