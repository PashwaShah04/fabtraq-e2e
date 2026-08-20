# Backlog

Cross-repo deferred items. Each entry is something we agreed is worth doing
"later" — not vague aspirations. Each entry MUST have an origin (which session
/ which conversation surfaced it), a status, and an explicit trigger that
should make us revisit.

---

## B-001 — Thin options endpoints for master-data pickers

**Origin:** 2026-05-08 SKU-bug brainstorm
(session `session-1778183391254`, spec
`docs/superpowers/specs/2026-05-08-yarn-sku-contract-alignment-design.md`)
**Status:** Deferred
**Trigger to revisit:** any master grows past ~150 active records, OR picker
payload size becomes a measured FE perf concern.

Today every master picker (`VendorSelect`, `TransporterSelect`,
`LocationFloorSelect`, `QualitySkuSelect`, `useQualities` in line-item rows,
`useJobWorkers` in challan-out list/form) hits the paginated CRUD endpoint
with `pageSize: 200, status: 'active'`. The 200 is a magic cap that leaks into
FE knowledge and silently truncates if any master ever exceeds it.

**Proposal:** introduce `GET /<resource>-options` endpoints returning a flat
thin DTO `{items: [{id, code, name}]}` with no pagination, fixed to active
records, used by every picker. CRUD pages keep paginated `Page<>`.

**Why deferred:** scope is cross-cutting — 6 master types × BE service +
controller + shared schema + FE hook + MSW handler + tests each. Today's
pickers work; future-proofing is not justified yet. Filed at user's explicit
direction during the SKU brainstorm: "match what other masters do for now,
file proper design for later."

---

## B-002 — Server-side PDF rendering for T1 / T2 / T3

**Origin:** 2026-05-19 S4 close-out (session `session-1779219341176`).
Originally Sprint 4 §3.
**Status:** Deferred (pushed from S4)
**Trigger to revisit:** before Phase 1 client UAT (S7), per user instruction
L2626 "we need a consistent pdf before completing phase 1." If S7 ships
without PDFs, this becomes blocker.

Today three transactional surfaces use `window.print()` stubs that produce
inconsistent browser-default output:

1. Yarn Purchase entry (T1) — Sprint 2 detail page
2. JW-Challan Out (T2) — Sprint 3 detail page (has `@media print` stylesheet)
3. JW-Challan In (T3A/B/C) — currently no print path at all

**Proposal:** BE generates PDFs on-demand at `/yarn-purchases/:id/pdf`,
`/jw-challans-out/:id/pdf`, `/jw-challans-in/:id/pdf`. Same renderer reused by
Sprint 7 report PDFs.

**Engine pick deferred to spec phase:** `wkhtmltopdf` (PRD's pick, binary
toolchain, mature) vs `pdf-lib` (npm-only, more code) vs Puppeteer/Playwright
(heavy). Decide when picking this up.

**Why deferred:** S5/S6 JW redesign is schema-breaking and time-critical
while the wipe-and-rebuild migration window is open. PDF rendering is
independent — can land in S6.5 (between S6 and S7) or fold into S7 itself.

---

## B-003 — In-place Yarn-Purchase line-item edit

**Origin:** 2026-05-19 S4 close-out (session `session-1779219341176`).
Originally Sprint 4 §5 — was already deferred from Sprint 2.
**Status:** Deferred (pushed from S4)
**Trigger to revisit:** when accountant/storekeeper users (after S6 ships
L11/L16) start filing tickets about typo fixes on yarn-purchase items
becoming painful via void-and-reenter MVP.

The void-and-reenter MVP from Sprint 2 works for inward-only stock but is
annoying for typo fixes on long item lists.

**Proposal:**

- New endpoint `PATCH /yarn-purchases/:id/items` body `{ items: [...] }` —
  `id?` per item: present = edit, absent = add, items missing from list = remove
- Per-item delete writes a reversal row in `stock_ledger` via Inventory
  service (post-S5: `IInventoryService.reversePurchaseItem`)
- Per-item add writes a forward row
- Per-item edit = reversal + forward in one transaction
- **Hard rule:** any item with placements consumed by a downstream JW-Out is
  immutable (matches L15 placement-edit-locking rule)
- Service-layer guard re-uses the slice-balance pattern from S6

**Why deferred:** scope notably easier after S5 lands (Inventory module owns
ledger primitives — no need to split `applyPurchaseEntries` /
`applyPurchaseCancellationEntries` per-item, that's already inventoried).

**Note:** the dependency on Inventory module (L12) makes post-S5 timing
strictly better than pre-S5 timing for this work.

---

## B-004 — Schema-first API: endpoint registry + OpenAPI + FE codegen + CI drift gate

**Origin:** 2026-06-08 session (chat: "Clarify job work quality visibility
after jw-challan-out", session `f1ddbbe7-c679-4562-8162-bcc474625247`). The
S5 P0 ledger/`/jw-challans-in/beam` bug exposed a whole _class_ of bug; this is
the agreed permanent fix. Discussion was cut off by a socket error before being
written down — this entry is the durable capture.
**Status:** **PRIORITY-BUMPED (2026-06-12).** Promoted ahead of other S6-adjacent
work after S5 FE↔BE drift shipped two live 404s (B-005 #4, B-006) — exactly the
class B-004 makes a compile error. Still a standalone workstream (decoupled from
S6 feature work), but no longer "whenever."
**Interim mitigation already shipped (2026-06-12):** a method-aware real-wire
contract test — `fabtraq-fe/tests/smoke/_meta/contract-coverage.smoke.ts` —
probes EVERY `api.ts` endpoint against a live seeded BE with its real HTTP verb,
with a completeness guard (fails if any `api.ts` path is missing from the
manifest). Runs in the existing `contract-smoke.yml` CI gate (PRs to main). This
catches path/method drift at test time; B-004 is the structural fix that catches
it at COMPILE time.
**Trigger to revisit:** user picks it up as its own effort. Explicitly NOT a
prerequisite for S6 and NOT to run in parallel with it (see decision below).
**STARTED (2026-06-12, session `session-1780939507081`):** B-004 kicked off as
the next workstream, **sequenced BEFORE Sprint 6** (user briefly considered
running them in parallel this session, then confirmed the original lock:
B-004 first, S6 after). Sequencing nuance: "S6 after B-004" means after the
**infrastructure phases P1–P4 + P6** are in place — P5 (lazy strangler-fig
migration of existing endpoints) explicitly rides on future PRs, and S6's NEW
endpoints will be built registry-first, which advances P5 rather than blocking
on it. Branch basing: stacked on the open S5 PR branches (user decision, same
session — S5 PRs stay open for separate review). Branch:
`feat/b004-endpoint-registry-<repo>`.

**P1 SHIPPED (2026-06-12 — final review READY; PUSHED + shared@1.1.0 PUBLISHED 2026-06-16):**

- shared `feat/b004-endpoint-registry-shared` @ `59d649c`: full endpoint
  registry — 45 live endpoints (verified 45/45 against the contract-coverage
  manifest, 0 mismatches; 2 dead endpoints tombstoned in source), `EndpointDef`
  / `PathParams` type model, `uuidIdParamsSchema`, version → **1.1.0**;
  536 tests, lint/typecheck/build/coverage all green; every list `querySchema`
  verified against the BE controller's ACTUAL validation (3 distinct pagination
  compositions documented in wire-truth comments).
- be `feat/b004-endpoint-registry-be` @ `36612cc`: `no-raw-router-verb` ESLint
  guard (error severity, anchored matching, 11-file allowlist = P5 burndown).
- fe `feat/b004-endpoint-registry-fe` @ `1da784c`: `no-raw-client-url` flat-config
  guard (12-file allowlist; `client.ts` CSRF probe inline-disabled, NOT
  allowlisted — burndown stays honest).
- Spec + plans: `fabtraq-shared/docs/specs/2026-06-12-b004-endpoint-registry-design.md`,
  `fabtraq-shared/docs/superpowers/plans/2026-06-12-b004-p1-*.md`.

**Carry-forwards discovered during P1 (for P2/P3/P4 pickup):**

1. **P2:** `GET /beams/:id` has NO param validation on the live wire today; the
   registry binds a uuid schema, so wiring `registerEndpoint()` tightens
   behavior (non-uuid id: 404 → 400). Intentional, but verify FE handles it.
2. **P2:** Express 5 `TypedRequest` generics — prototype first (spec §OPEN-5).
3. **P3:** 4 master list endpoints (job-workers, transporters, locations,
   yarn-qualities) FAKE their page envelope on the BE (validate no pagination,
   return everything with `page:1, pageSize:max(len,1)`) — B-001-adjacent;
   decide in P3 whether OpenAPI documents the fake envelope or BE gets real
   pagination first.
4. **ESLint-9 era note:** be pins `@types/eslint@^8` alongside `eslint@^8`; both
   bump together when be migrates to ESLint 9.
5. **FE nice-to-haves:** one-line comment that `isUrlish` ignores string
   concatenation by design; add a `delete`-verb invalid RuleTester case.

**P2 SHIPPED (2026-06-12 — both reviews Approved; PUSHED 2026-06-16):**
All 3 b004 branches (`feat/b004-endpoint-registry-{shared,be,fe}`, stacked on the
open S5 PR branches) are now on origin; `@pashwashah04/fabtraq-shared@1.1.0` is
published to GitHub Packages so the branches' CI can resolve the registry. PRs
not yet opened.
be `feat/b004-endpoint-registry-be` @ `7ba5924` (4 commits on top of P1):

- `src/shared/http/register-endpoint.ts` — `registerEndpoint(router, def, handler, deps)`
  - `TypedRequest<Def>` + `RegisterDeps`. Composes requireAuth (when
    `def.auth !== false`) → requireRole(...roles) (fail-fast on unknown role) →
    doubleCsrfProtection (mutating methods) → validate(from def schemas) →
    asyncHandler. Mount-prefix stripping folded in (`RegisterDeps.mountPrefix`,
    **segment-boundary guarded** so `/jw-challans-in-beam` can't false-match
    `/jw-challans-in`); absolute `def.path` still drives all typing → **zero cast
    in module code**. Exactly 2 documented casts confined to the adapter
    (Express 5 query-slot, shared/BE role decoupling). 9 unit tests.
- Vendor module migrated as the **reference P5 template** + first P5 increment:
  `vendor.routes.ts` (cast-free, 4 `registerEndpoint` calls), `vendor.controller.ts`
  (raw `TypedRequest` handlers, validation from the def, 2 documented body casts),
  and `vendor.routes.ts` **removed from the lint allowlist** — proves the
  `no-raw-router-verb` burndown works un-exempted.
- Spike (Express 5 `TypedRequest` decision = B, bounded internal casts) resolved
  P1 carry-forward #2. Vendor integration oracle held **25/25** through every
  iteration; full unit suite 379; coverage 90/77/94/91 over thresholds; build clean.
- Plan: `fabtraq-be/docs/superpowers/plans/2026-06-12-b004-p2-register-endpoint.md`.

**P5 migration guidance (from P2 quality review — apply when migrating the 10
remaining modules; the vendor module is the canonical template to copy):**

1. **`MOUNT_PREFIX` is the highest-risk copy-paste site.** A mismatch with the
   module's `app.use('/x', ...)` mount in `app.ts` throws at startup (fail-fast),
   but only surfaces if an integration test boots the router. Per-migration
   checklist line: verify `MOUNT_PREFIX` against the exact `app.ts` `app.use` line.
2. **Body-cast canonical rule:** `TypedRequest` body is the zod _input_ shape;
   after `validate()` runs, `req.body` is the _output_ shape. Cast
   `req.body as XInput` where `XInput = z.infer<typeof xSchema>` (output). Do NOT
   cast to the input type.
3. **List-query canonical form = destructure** the typed `req.query`
   (`const { search, status, page, pageSize } = req.query`) — NOT an intermediate
   `as` cast (that escapes narrowing; it was caught + removed in vendor).
4. **`deps` boilerplate:** `requireAuth`/`doubleCsrfProtection`/`validRoles:
USER_ROLE_VALUES` is identical in every router. Consider a
   `buildRegisterDeps(env): Omit<RegisterDeps,'mountPrefix'>` helper before the
   ~10th copy (also the natural place to separate routing-config `mountPrefix`
   from the middleware deps — `RegisterDeps` currently mixes both).
5. Optional adapter test add-ons: minimal authenticated GET (no schemas → just
   validate({}) + asyncHandler); assert the `auth:false` `/auth/login` path-strip.
6. `/beams/:id` 404→400 tightening (P1 carry-forward #1) triggers when the beam
   module migrates — verify FE handles 400.

**P3 SHIPPED (2026-06-16 — both reviews Approved; committed, not pushed):**
be `feat/b004-endpoint-registry-be` @ `5338d56` (7 commits on top of P2):

- `src/shared/openapi/` — emits a deterministic **OpenAPI 3.0.3** doc from the
  registry. `buildOpenApiDocument()` enumerates all **45** EndpointDefs (filters
  the shared barrel for method+path+responseSchema, sorts for determinism),
  registers each with `cookieAuth` (`{apiKey, in:cookie, name:fabtraq_session}`)
  security (omitted only for `auth:false` = `/auth/login`), and serializes via
  `@asteasolutions/zod-to-openapi@7.3.4` (devDep, NOT in the runtime bundle).
- Two spike-proven wrinkles handled, BE-only (no shared change): (a) zod
  instance-identity — `ensureZodOpenApiCjs()` + `ensureZodOpenApiEsm()` patch
  BOTH copies of shared's zod (CJS backs sanitizer-rebuilt schemas; ESM backs
  the registry's pass-through schemas under tsx/vitest); (b) `sanitizeForOpenApi()`
  rewrites only the generator-incompatible nodes (`ZodPipeline`, `ZodUnion`-with-
  undefined/null/nan/literal'' from `optionalFiniteNumber`/`optionalPhone`/
  `optionalGstin`) while leaving clean constructs (coerce, brand, merge,
  pageOfSchema, ZodDefault-with-`default`) byte-identical — pinned by passthrough
  regression tests.
- Artifact: `fabtraq-be/docs/openapi.json` (10,011 lines, 45 ops / 29 paths),
  committed; `npm run openapi:emit` regenerates it **byte-identically**
  (determinism verified). Plan: `fabtraq-be/docs/superpowers/plans/2026-06-16-b004-p3-openapi-emit.md`.

**P3 carry-forwards (for P4/P6):**

1. **P6 drift-gate command is proven:** `npm run openapi:emit && git diff --exit-code docs/openapi.json`. Add it to the BE CI workflow.
2. **P4 (FE codegen):** `components.schemas` is empty — all schemas inline in each op (openapi-typescript handles fine; check orval verbosity if used). Only success codes (200/201) are emitted; error shapes use shared `AppError`, not generated.
3. `emit.test.ts` pins operation count == 45 (intentional; failure message says to regenerate openapi.json when an endpoint is added).

**P4 SHIPPED (2026-06-16 — both reviews Approved; committed, not pushed):**
fe `feat/b004-endpoint-registry-fe` @ `4074d2e` + a shared root-fix.

- `src/shared/api/typed-client.ts` — `typedClient.call(def, args)`: a type-driven
  FE client over the registry (spec §P4 Option A). Derives real arg/return types
  from the EndpointDef schema fields, conditional `params`/`query`/`body` keys per
  endpoint (`IsUnknown` + path template check), path-param substitution
  **segment-boundary-anchored** (mirrors the BE mountPrefix fix — `:id` can't match
  inside `:idLong`), body re-validated + response parsed via `parseOrThrow`. Two
  casts confined inside `call`; a typed `CLIENT_METHOD` map (no method cast).
- Vendors feature migrated as the **cast-free** FE P5 template + first FE P5
  increment: `vendors/api.ts` is 4 clean `typedClient.call` delegations (signatures
  preserved → hooks/components untouched), **de-allowlisted** from the FE lint guard
  (burndown proof). Oracle 28/28; full FE suite 470.
- **ROOT BUG FOUND + FIXED in shared (this is the headline):** P1's registry had a
  latent type-correctness bug — for response schemas with transforms/brands/defaults
  (input ≠ output), the `EndpointDef` Response generic was the zod **input** shape,
  not the **output** the server returns (e.g. `getVendorById` typed `id: string`,
  `status?` optional instead of branded `VendorId`, required `status`). `listVendors`
  dodged it via `pageOfSchema` (input==output). Fixed at root in shared `endpoint()`
  (`feat/b004-endpoint-registry-shared` @ `2ff38fd`): now derives
  `Response = z.output<RS>` from the responseSchema type — **one helper change, zero
  per-entry edits**, so EVERY endpoint now carries the correct output-typed response
  and all ~11 remaining FE migrations are cast-free. shared 541 tests (+5 type-assert
  proofs). **BE typecheck stays clean + committed `openapi.json` byte-identical**
  (type-only change). **shared bumped 1.1.0 → 1.2.0** (`dc9cafc`) — the published
  1.1.0 carries the bug; **1.2.0 must be republished** alongside the push.
- Plan: `fabtraq-fe/docs/superpowers/plans/2026-06-16-b004-p4-typed-client.md`.

**P6 SHIPPED (2026-06-16 — committed, not pushed):** be `feat/b004-endpoint-registry-be`
@ `ac37e84` adds the "OpenAPI spec drift gate" step to `.github/workflows/ci.yml`
(after Build): `npm run openapi:emit && git diff --exit-code docs/openapi.json` →
fails the build (with a `::error::`) if the committed spec is stale, OR if the emit
itself errors (GitHub's `bash -eo pipefail`). **Validated under a real non-symlink
install** (npm-pack tarball → `npm install`, zod hoisted to top-level = the exact CI
dedup scenario): emit succeeded, byte-identical `openapi.json`. So the gate won't
red-fail CI on the zod-instance resolution. (P5/P2 lint guards + typecheck already
run earlier in the same CI job — three enforcement layers now all in CI.)

**B-004 INFRASTRUCTURE COMPLETE (P1–P4 + P6).** The original goal is MET — an FE call
to a renamed/removed endpoint, OR one expecting the wrong response shape, is now a
**compile error** (the S5 beam-bug class), backed by build-time OpenAPI emit and a
CI drift gate. Three-layer guarantee live: (1) compile-time (FE typedClient + BE
registerEndpoint + corrected output-typed registry), (2) build-time (openapi.json
emit), (3) CI-time (drift gate + lint guards). **S6 can now start.**
**P5** remains lazy/ongoing: vendors migrated on BOTH BE + FE (cast-free templates);
~11 FE `api.ts` + ~10 BE `*.routes.ts` features remain, migrated per-PR as touched,
each de-allowlisted from its lint guard until both `*_ALLOWLIST`s reach empty.

**P5 FE-migration recipe (from P4 — vendors is the cast-free template):**

1. Import the registry endpoint objects (values) + keep `import type` for the DTOs
   (verbatimModuleSyntax).
2. Replace `client.<verb>(url, …)` + manual `parseOrThrow` with
   `typedClient.call(def, { params?, query?, body? })`.
3. Keep the explicit exported function signatures (IDE-readable; no downstream churn).
4. Remove the file from `CLIENT_ALLOWLIST`. No feature-layer cast needed (helper fix).

**Pending republish/push (user-gated):** 3 branches already pushed at P1/P2;
P3+P4 commits are local; **shared must republish as 1.2.0**; PRs not yet opened.

> **CORRECTION 2026-06-24 (git/registry-verified, session `session-1782164199057`):**
> The "Pending republish/push" line above and the three "committed, not pushed"
> notes (P3 `5338d56`, P4 `4074d2e`, P6 `ac37e84`) are **STALE**. Verified:
> `git log --oneline @{u}..` is **empty in all three repos** → nothing unpushed;
> P3/P6 are on `origin/feat/b004-endpoint-registry-be` and in the pushed
> `feat/s6-be` history. Published `shared` advanced **1.2.0 → 1.3.0 → 1.3.3 →
> 1.3.4 → 1.4.0**; BE+FE both declare `^1.4.0`. **There is NO pending 1.2.0
> republish and NO unpushed B-004 work.** The only outstanding B-004 mechanic is
> opening/merging PRs (shared with the `feat/s6-*` PRs). Do not treat B-004 as
> gating a new sprint.

### The problem it solves

The drift class: the API contract is **stringly-typed**. A path like
`'/jw-challans-in/beam'` is a hand-written string on the FE and a separate
route registration on the BE; TypeScript cannot connect the two, so an FE call
to a non-existent / renamed endpoint compiles fine and only fails at runtime.
This is exactly how the S5 beam bug slipped past type-checking. The existing
`docs/specs/2026-05-06-contract-drift-prevention.md` (runtime schema-validate
on every response + a real-wire smoke CI) catches drift at _test/runtime_ — this
B-004 work moves the guarantee to _compile-time + build-time_.

### Architecture — schema-first, codegen-everywhere

`@pashwashah04/fabtraq-shared` becomes the single source of truth: it exports
an **endpoint registry** alongside the existing Zod schemas — each entry binds
`{ method, path, body-schema, response-schema }`. BE registers each route from
the registry and emits an OpenAPI spec at build; FE calls endpoints only through
a thin generated client keyed off the registry, so a missing/renamed URL is a
compile error, not a runtime 404. CI re-emits the OpenAPI spec and diffs it
against the committed one — build fails on drift.

```
            shared (registry: path+verb+req+res, as const)
                       /                    \
        BE: registerEndpoint() +      FE: generated typed client
            emit openapi.json             (no raw URL strings)
                       \                    /
                        CI: diff openapi spec, fail on drift
```

Three layers of guarantee: **(1) type system** (compile-time — FE cannot name a
URL string), **(2) spec + codegen** (build-time — BE emits OpenAPI via
`@asteasolutions/zod-to-openapi`), **(3) CI drift gate** (diff committed spec).

### Phased rollout (P1–P6)

- **P1** — endpoint-registry types in `shared` (~1.5 days; brainstorm→spec→review first).
- **P2** — `registerEndpoint()` helper in BE (thin `router.post(...)` adapter, registry-aware).
- **P3** — OpenAPI emit from the registry (observes registry; no coupling).
- **P4** — FE generated typed client from the registry.
- **P5** — migrate existing endpoints **lazily** (strangler-fig: one endpoint per PR that already touches it; do NOT big-bang). Delete hand-rolled `api.ts` at the end.
- **P6** — CI drift gate live once most endpoints are registered.

### Decision (locked 2026-06-08)

User: **"I want to have it completely separate. Even if the long-term solution
is not available to S6, that is fine."** So:

- This is its own workstream with its own kickoff — **not** S6 Week-0 prep, **not**
  run in parallel with S6.
- The earlier "P1 must lock before S6 features start" sequencing constraint is
  therefore **moot / withdrawn** — S6 proceeds on the current `router.post` +
  hand-rolled `api.ts` pattern; this migration happens later, independently.
- An ESLint guard to stop new code copying the old pattern is only relevant
  _once this workstream starts_ (to manage the dual-pattern coexistence window).

---

## B-005 — Beams workstream (direct entry + ledger + cancel) → Sprint 6

**Origin:** 2026-06-11 session (this "complete Sprint 5" pass). Surfaced while
unskipping the beam integration tests; user decided to **defer the whole beam
ledger/cancel area to S6 and design it as one coherent piece** rather than
patch piecemeal.
**Status:** ✅ **SHIPPED in Sprint 6** (all 4 items). Direct beam entry, at-JW
drain, `countActiveReceipts` cancel-awareness, and the FE dead-endpoint migration
all landed on `feat/s6-be` / `feat/s6-fe` (pushed to origin) and were then
superseded/extended by **B-010 Beam Register v2** (dedicated `BeamReceipt` header
replaces `JwChallanInBeam`). No longer open.
**Trigger to revisit:** n/a — closed.

Three related items, to be designed together (beam receipts touch all three):

1. **Direct beam entry (Path #2) — NEW Phase-1 feature.** Today beams can only
   be received from a sizing JW-out (`challanOutId` is _required_ in
   `jw-challan-in-beam.service.ts`). The user wants a second path: **directly
   purchasing finished beams** (no job-work origin). Needs schema (beam receipt
   without `challanOutId`), service, route, FE form, tests. Not in the current
   PRD or S5 spec — confirmed in scope for Phase 1 by user 2026-06-11.

2. **At-JW position drain on beam receipt** (the "stuck at job worker" bug).
   Sizing JW-out opens an at-JW ledger position (post-I13, `applyChallanOutLedger`
   is universal); yarn-IN drains it via `applyChallanInYarnLedger`, but **beam-IN
   writes no ledger rows**, so sized yarn returned as a beam stays "at job worker"
   forever. A drain leg (`applyChallanInBeamLedger`) was prototyped this session
   and **reverted** (commit-free) so S5 ships clean — the S5 spec explicitly says
   "beam ledger writes preserved (no drain)", so register-only beam is S5-correct.

3. **`countActiveReceipts` cancellation-awareness** (`prisma-jw-challan-out.repository.ts`).
   It deems an in-challan "active" if it has any `notes IS DISTINCT FROM 'cancellation'`
   ledger row — but forward rows persist after `reverseLedger` (which only _adds_
   offsetting rows). So a fully-cancelled in-challan still counts as active and
   blocks its OUT from being cancelled. Affects yarn too; untested today (no test
   covers cancel-IN-then-cancel-OUT). Fix: active = has forward rows AND no
   matching cancellation rows. Add the missing integration test.

4. **FE beam form points at a DEAD endpoint (confirmed live 2026-06-11).** The
   route `/jw-challans-in/new/beam` (router.tsx:191 → `JwChallanInBeamFormPage`)
   submits via `jw-challans-in-beam/api.ts` → `POST /jw-challans-in/beam`, which
   **returns 404** (S5 unified beam receipts into `POST /jw-challans-in` with a
   `beamItems[]` array, but the FE form was never migrated). So the "New Beam
   Receipt" screen cannot save through the UI. Migrate the form + `api.ts` +
   `hooks.ts` to the unified endpoint/payload (the `jw-challans-in` feature already
   does this); retire the stale `jw-challans-in-beam` feature folder. This is the
   FE half of the S5 beam unification.

**Also:** the live smoke `fabtraq-fe/tests/smoke/jw-challans-in-beam.smoke.ts`
is `describe.skip`-ped (pre-existing red, independent of S5 work): it sends a
stale `GET /inventory/lots?stockState=raw` (S5 dropped `stockState`) → early 500,
and its cancel-cleanup needs items 2+3 above. Unskip + fix as part of this
workstream. Beam happy/over-consume/picker/cancel are covered by BE integration
(`tests/integration/jw-challan-in-beam.routes.test.ts`, unskipped in S5).

See also **B-006** (yarn JW-In source picker — a sibling FE-migration miss found
the same day).

---

## B-006 — Yarn JW-In source picker calls a DEAD endpoint (CORE flow, triage urgency)

**Origin:** 2026-06-11 session — full FE→BE API sweep ("verify every page's API").
**Status:** **Folded into Sprint 6 (decided 2026-06-11).** Resolve as part of S6
L3 (M:N + partial returns). **Owner approved cross-challan M:N** — so the source
picker becomes a **global (cross-parent-challan) eligible-out-items search**, not
parent-scoped: a yarn receipt may combine source out-items from different parent
Out challans. The header "Parent Challan Out" becomes a convenience seed/filter,
not a hard scope. (Supersedes the parent-scoped interim fix below — that's only a
fallback if the flow is urgently needed before S6.)
**Trigger:** S6 L3 design spec.

**UPDATE 2026-06-25 — non-dyed multi-source SHIPPED (FE-only).** The dyed-only
render gate was lifted: `YarnLineRow` now renders `YarnLineSourceSubTable`
(multi-source, "+ Add source row") for **all** processed types; the 1:1
`YarnLine1to1SourceRow` component is deleted. Backend + shared already supported
it (no production/schema change, no shared republish). Spec
`fabtraq-fe/docs/specs/2026-06-24-jw-in-non-dyed-multi-source-design.md`; plan
`fabtraq-fe/docs/superpowers/plans/2026-06-25-jw-in-non-dyed-multi-source.md`;
pushed FE `feat/s6-fe` 5224749..b17e487, BE test `feat/s6-be` e8bce06. The dead
`GET /jw-challans-out/items/eligible` picker call was already replaced by the new
`GET /jw-challans-in/eligible-out-items` endpoint earlier in S6.

The yarn JW-In form's source-lot picker (`EligibleOutItemSourcePicker` →
`useEligibleOutItems` → `jw-challans-in/api.ts getEligibleOutItems`) called
**`GET /jw-challans-out/items/eligible`**, which **returned 404** — the BE removed
it in S5 (`jw-challan-out.routes.ts:24`: _"Removed GET /items/eligible … dyed-only
concept retired in S5 redesign"_). The picker rendered in **both** branches of
`YarnLineRow` (originally dyed → `YarnLineSourceSubTable`, non-dyed →
`YarnLine1to1SourceRow`; the non-dyed branch was unified into the sub-table on
2026-06-25 — see UPDATE above), so **every** yarn JW-In receipt's source
selection was broken in the UI until the endpoint fix.

**Design reality (corrected 2026-06-11):** the yarn form ALREADY has a header
"Parent Challan Out" picker (`ParentOutPicker` → sets `challanOutId`, and seeds
each line's `processedTypes` from that parent). The form is therefore
**parent-challan-scoped** — but `EligibleOutItemSourcePicker` is **mis-wired**: it
ignores `challanOutId` and queries globally (`{ pageSize, search }`), against the
now-dead endpoint. So this is NOT a global/cross-challan picker by design; it's a
parent-scoped picker that was left unfinished.

**Correct fix (mirror the beam form, which works):**

- FE: thread `challanOutId` from form → `YarnLineSourceSubTable` →
  `EligibleOutItemSourcePicker` → query (beam form already does exactly this with
  `useEligibleOutItemsForBeam`).
- BE: add challan-scoped `GET /jw-challans-in/eligible-out-items?challanOutId=…`
  (near-copy of `eligible-out-items-beam`, filter inverted to yarn-eligible /
  non-sizing out-items), OR generalize the beam endpoint to serve both tracks.

**Two decisions for the owner (tilt this to S6/L3):**

1. Make the Parent Challan **required** (it's labelled "optional" today but sources
   must come from a parent)?
2. **Cross-challan M:N** — brainstorm L3 wants combining source lots from
   _different_ parent challans into one receipt; that's the only case a _global_
   picker fits, and it's **scheduled for S6 (L3 — M:N + partial returns)**. L3 will
   formally settle the source↔parent-challan model, so this picker fix is best done
   **as part of L3** rather than a throwaway interim patch. A minimal parent-scoped
   fix can be done now if the flow is needed before S6.

Found because the user pushed on "are you 100% sure every API works" — the live
smoke didn't cover this picker call. Both this and B-005 item 4 are the FE half
of S5 route changes that weren't propagated to the frontend.

---

## B-007 — Surface per-item `pendingAtJW` on JW-Out detail (CF-5)

**Origin:** S6 FE-5 (close-as-loss modal). Spec §6 wanted the JW-Out detail to show
per-item `pendingAtJW`; FE-5 displays `placementStatus` instead because
`pendingAtJW` is not in the shared `jwChallanOutResponseSchema.items`. The
write-off modal would be clearer if it showed how much will be written off.
**Status:** Deferred (S6 close-out, 2026-06-17). Display polish — the write-off
flow works; status is shown, just not the residual quantity.
**Fix:** add `pendingAtJW` to the shared JW-Out response item schema; BE projects
it via `getOutItemRollup` in the JW-Out mapper; FE shows it on the detail page +
in the close-as-loss modal. Cross-repo (shared+BE+FE) + a shared patch publish.

## B-008 — SKU picker on the Stock Transfer form (CF-7)

**Origin:** S6 FE-7. The stock-transfer create form omits `skuId` (optional in
`createStockTransferSchema`), so transfers are quality-level only.
**Status:** **CLOSED — SUPERSEDED, verified 2026-07-13.** The stock-transfer
bug-#2 fix replaced the free-text lot field with a **floor-scoped position picker**
that fills Quality/Lot/SKU read-only from a real on-hand `/inventory/lots` position
and now sends the real `skuId` on submit (verified in
`stock-transfer-form.page.tsx` — picker sets `skuId` from the picked row — and the
BE `INSUFFICIENT_BALANCE_AT_FLOOR` guard in `StockTransferService.create` matches
`skuId: null` as IS NULL). SKU-level transfers are selected implicitly by picking
a sku'd position; the separate "SKU dropdown" this item asked for is moot.
**Original fix (probably moot):** add a quality-dependent SKU dropdown to
`StockTransferFormPage` (FE-only; the contract already accepts `skuId`).

---

## B-009 — JW-Out source-lot aggregation + floor-aware pull placement

**Origin:** 2026-06-19 session — surfaced while debugging the JW-Challan-Out
"Lot number must match format" error. `GET /inventory/lots` is grouped per
`(lot, floor)`, so a lot split across floors returns 2 rows with un-combined
balances; in the source-lot picker this both breaks selection (duplicate Radix
`value`) and shows a per-floor balance instead of the true on-hand total.
**Status:** **SHIPPED (pushed + published 2026-06-24).** All 4 sections plus
follow-ups on `feat/s6-{shared,be,fe}` (all pushed to origin, 0 unpushed).
`@pashwashah04/fabtraq-shared@1.4.0` published to GitHub Packages; BE + FE bumped
to `^1.4.0` with refreshed lockfiles. Full bar in every repo (shared 670; BE 477
unit + 43 JW-Out + 21 inventory integration; FE 576). Design:
`docs/plans/2026-06-19-jw-out-lot-aggregation-floor-pull-design.md`. Sprint 6,
under L10/L11.
Commits: shared `7d14d31`; BE `0a2f967` (endpoint), `1eddfc3` (per-floor), `d961ec4`
(dep bump); FE `b0cf0a6` (picker), `32a7763` (floor-pull), `f40472f` (UI redesign),
`1b17def` (col widths), `bb16fbe` (dup-floor prevention), `7ae9805` (dep bump).
**Follow-ups also on these branches (not strictly B-009):** FE `0dc3208` fixes the
JW-Challan-In "Invalid date" submit bug (schema `date` is `z.string().date()`, form
was sending an ISO datetime); FE `b0511e1` redesigns the yarn-lot UI. **PRs not yet
opened.**

Four sections (all in the design doc):

1. **BE** — new generic `GET /inventory/lots/aggregated` endpoint: one row per
   `lotNumber` with `totalBalance` + nested per-floor `placements[]`. Built with
   a **clean repo(fetch)/service(compute) split** — NOT the current fat-repository
   `listLots` pattern. **No new DB query/aggregation** (standing rule
   `feedback-compute-in-app-not-db`): reuse the existing flat `findMany`, roll up
   in the service. `listLots` kept as-is (backs the Inventory Lots report page).
2. **FE** — `SourceLotPicker` migrates to the aggregated endpoint (fixes the
   duplicate-`lotNumber` selection bug by construction; shows summed balance).
   Add the missing multi-floor regression test.
3. **FE** — floor-aware "pull from" placement: picked lot's per-floor availability
   feeds `PlacementFieldArray`; floor options constrained to floors-with-stock
   with available qty; `Σ-per-floor ≤ available` (FE guard + BE authoritative
   `INSUFFICIENT_BALANCE_AT_FLOOR` 422).
4. **FE** — redesign the "Add placement" editor UI (currently poor): clean
   card/table rows, visible conservation indicator, inline per-floor availability,
   shadcn/neutral house style, accessible + responsive. Use the frontend-design /
   ui-ux-pro-max skill.

---

## B-010 — Beam Register v2 (3 inward paths + Designs master + ends/reed + composition + PDF recipe)

**Origin:** 2026-06-24 session (`session-1782164199057`) — started as "parse a PDF
of SKU colour %s and deduct from inventory," clarified into a full **beam-register
redesign**. Full durable record:
`docs/brainstorms/2026-06-24-beam-register-redesign.md` (decisions BR-L1…BR-L7).
**Status:** **COMPLETE (2026-07-08) — PDF-ingest integration SHIPPED, code-complete + live-verified; pushes pending.**
The §9 integration landed (session `session_014KByE3Ry1JrQLVuSMsvn7y`): shared 1.6.0
(zod-v3 port of the parser contract + `parseDesignPdf` registry endpoint, published to
GitHub Packages, commits `e97b29a..53c95b5` tag `v1.6.0`), BE proxy
`POST /designs/parse-pdf` (multer preValidation on registerEndpoint, HttpPdfParserClient,
DesignParseService with boundary re-validation, error mapping with PARSER*\* in
`details.code`, OpenAPI 64-pin; 13 tasks, commits `afd96eb..45cdaaa` on `feat/s6-be` —
**in the linked worktree `fabtraq-be-wt-b010`**), FE "Import from PDF" on the Design form
(callUpload w/ fetch adapter + 120s timeout, ImportRecipeDialog with quality/SKU
auto-match + split-by-shade + rescale-to-100, setValue field-array apply; 9 tasks,
commits `80db7f1..1cd38ca` on `feat/s6-fe`). Spec:
`docs/superpowers/specs/2026-07-08-b010-pdf-design-ingest-integration-design.md`.
**Live-verified 2026-07-08:** both digital fixtures parse 200/text through FE-path→BE→parser;
scanned PDF → 422 `details.code=AI_NOT_CONFIGURED` passthrough; unauth 403; FE contract
smoke 64/64 vs live BE. AI engine still never verified live (needs ANTHROPIC_API_KEY).
**REMAINING (not code):** (1) push `feat/b010-beam-register-v2` (shared — git source of
1.5.0+1.6.0 local-only), BE worktree commits, FE commits — on user go; (2) `.env.example`
PDF_PARSER*\* block (permission-gated, 4 lines — see session notes); (3) parser deploy +
nginx `client_max_body_size` bump when prod deploy happens; (4) pre-existing BE branch-cov
debt 74.5%<75 from the earlier Designs-master commit (`893dcbf`), not this workstream.
**Lineage:** extends the beams workstream **B-005**; builds on shipped Inventory /
ledger / B-009 floor-pull.

**SUPERSEDED (2026-07-17) — Design v2:** item 1 below (flat `(quality, SKU, %)`
recipe) and the PDF-recipe path's "warp-only percentages" limitation (item 6,
§9) are replaced by the Design v2 workstream — full sheet storage (header
attributes + warp/weft groups with exact weights), colour-ways (a beam is
woven in exactly one colour-way), and a per-design shade→SKU mapping (nullable,
editable post-create). Design + spec:
`docs/superpowers/specs/2026-07-17-design-v2-colourways-beam-drain-design.md`;
plan: `docs/superpowers/plans/2026-07-17-design-v2-be.md`. **BE (this repo)
shipped 2026-07-17** — shared 1.7.0 consumed; migration converts every
existing flat recipe row into a single 'Legacy' colour-way (§7); beam-receipt
items now carry `colourwayId`/`colourwayName`. FE/e2e workstreams tracked
separately (see the shared/FE/e2e sprint docs).

**Scope (locked model, pre-Design-v2 — see supersession note above):**

1. **Designs master (NEW)** — `name/code` + stored **recipe** `[(quality, SKU, %)]`.
   One design → many beams. (BR-L2.)
2. **Beam attributes** — add `ends` (int), `reed` (int; maybe text "60s" — confirm
   at spec), link to design; `cut` already exists. (BR-L7/BR-L8.)
3. **Three inward paths** (BR-L1/BR-L3): (1) purchase finished beam — no deduction;
   (2) **in-house manufacture — deducts yarn from inventory at register time**
   (genuinely new modelling: internal production, no job worker); (3) external
   warping/sizing JW — deducted at JW-Out, beam received as plain JW-In.
4. **Composition (NEW table)** — `(quality, optional SKU, qty)`, any yarn kind
   (normal/processed/dyed, BR-L4); operator **picks exact source lot/floor**
   (reuse JW-Out picker + B-009 floor-pull, BR-L6); ledger-OUT per slice.
5. **Manual entry accepts BOTH** absolute-kg and %+total (BR-L5); %×total
   reconciled via JW wastage auto-split ±0.001 KG (BR-L7).
6. **PDF-recipe path — PARSER SERVICE SHIPPED 2026-07-02** (`session-1782988559742`;
   was: parked pending sample). Samples arrived in `beam-designs/` → new standalone
   repo **`fabtraq-pdf-parser`** (Express/TS microservice, initial commit `9f8b772`):
   `POST /v1/parse/beam-design` parses design-sheet PDFs into structured yarn tables
   (quality text, shades, ends/picks, **%**, KG) via a deterministic pdf.js engine
   (digital CAD sheets) + Claude-vision fallback (scanned/unknown layouts,
   `ANTHROPIC_API_KEY`-gated). See its `docs/design.md`. **Still open for B-010 FE/BE:**
   upload affordance on the design form, calling this service, and the
   parsed-text → quality/SKU master mapping UX (spec §9).

## B-011 — BE coverage debt: `modules/design` + integration-only services

**Logged:** 2026-07-10 (session `session_01UPopVriGaXuKSn1dqzUZPW`, unplaced-stock-visibility workstream).

Two related test-debt findings surfaced while shipping the awaiting-placement bucket:

1. ~~**`modules/design` sits at 6–11% statement coverage**~~ **RESOLVED 2026-07-17**
   (Design v2 workstream, fabtraq-be `8f7820c`): `design.service.test.ts` added — 16 unit
   tests, design.service.ts now 96.66%/86.36%, repo branches 78.29%. The predicted
   gate-trip did happen (B2's v2 rewrite dropped branches to 71.39%) and was fixed the
   same day. Original text: the module had the repo-wide branch gate RED at `feat/s6-be`
   HEAD (74.5% vs 75%) with only ~75.8% margin after incidental inventory tests.
2. **`place-stock.service.ts` has no unit-test file**, and because the v8 provider runs
   without `all: true`, the file doesn't appear in the coverage report at all — its
   (substantial) logic is covered only by integration suites
   (`place-stock-be10`, `place-stock-ledger-wiring`). Either add a unit suite or enable
   `all: true` so untested files are at least visible.

Bonus finding, same file: `place-stock.service.ts` has 8 pre-existing direct
`tx.placement.*` / `tx.stockLedger.*` touchpoints that contradict the inventory
bounded-context rule in its own header comment (L12). New writes from the 2026-07-10
workstream were routed through `IInventoryService`; the legacy ones were left as-is.
Refactor them behind `IInventoryService` when next touching the file.

Addendum (E2E, same date): queue-based E2E coverage exists only for the
`yarn_purchase_item` path; `jw_challan_in_yarn_item` bucket-drain and
`jw_challan_out_item` (422 floor guard / 409 immutable) queue paths are covered by BE
integration tests only. Consider adding queue-based E2E chains for those two in S7.

---

## B-012 — Place-Stock ↔ ledger sync (stale floors after transfer) + duplicate-floor placements

**Origin:** user-reported 2026-07-13 (session `session_01DfjZtMYygXUWEN4FeA6aMr`):
placing stock twice to one floor creates two placement rows; floor UUIDs shown
instead of names; placement UI width regression; Place Stock shows the pre-transfer
floor after a Stock Transfer.
**Status:** **COMPLETE (2026-07-13, same session — all local, unpushed).** Design LOCKED at
`docs/superpowers/specs/2026-07-13-place-stock-ledger-sync-design.md` (mirrored
be/fe/e2e). Canonical rule established: `stock_ledger` is the single source of
truth for current location; `placements` is a put-away event record. Fix = FE
used-floor exclusion + BE `DUPLICATE_FLOOR_PLACEMENT` guard + floor names + width
restore (Phase 1, agent-dispatched) → ledger-derived "Currently on floors" panel
via existing `GET /inventory/lots/aggregated` + stale-placement flag + editPlacement
ledger-balance guard (Phase 2) → chained place→transfer→place-stock E2E tripwire.
No shared-contract change, no republish.
**Shipped:** BE `fe287de`+`9d54830`+`3a3da6e` (guards + env-gated RATE_LIMIT_AUTH_MAX
knob, default 100 unchanged); FE `8df5315`+`204d2d5`; e2e `81e680e`+`f6b8e62`+`1c86f31`
(tripwire spec + two-batch retarget + rate-limit wiring). Full battery green:
BE 523 unit + 494 integration, FE 747/747, e2e **69/69 twice**. Two legacy tests that
exercised the duplicate-floor bug as a feature were retargeted (BE ledger-wiring +
e2e placement two-batch). E2E suite rate-limit cliff (69 serial tests × per-nav
/auth/me > 100/15min default) fixed via the env knob raised only by the e2e runner.

---

## B-013 — PATCH /placements ledger duplication (P0, found live by user)

**Origin:** user live-testing 2026-07-14 (session `session_01DfjZtMYygXUWEN4FeA6aMr`):
1000 kg purchase showed 500 placed + 600 awaiting (=1100). Root cause: editPlacement
step-6 scan-cancel-rewrite — cancellation counter-rows never mark the row they
cancel, so every edit re-matches ALL prior forward rows and rewrites them at
newQuantity → floor legs double per edit (1→2→4→8; verified 33 ledger rows after
4 edits). Pre-existing from the 2026-07-10 workstream; single-edit tests couldn't
see it. Bucket side (delta-based) was always correct.
**Status:** **FIXED 2026-07-14** — BE `a9b320d` on feat/s6-be (local): scan loop
replaced with append-only delta correction rows derived from the placement row's
old/new state (one row on qty change, two on floor change, nothing on no-op save).
Repeated-edit conservation tests added (3-edit sequence, row-count growth exactly
+1/edit); a legacy assertion that enshrined the cancel-row shape was replaced.
BE bar green (523 unit / 497 integration). User's dev data snapshot-restored and
ledger repaired (single 400 kg placement row; divergence scan across all items = 0).
E2E edit-twice conservation scenario added to the sync tripwire spec.
**Lesson:** ledger is append-only — NEVER identify "live" rows by absence of a
cancellation marker; corrections must derive from domain state, not ledger scans.

---

## B-014 — UI-wide raw-UUID audit (Playwright sweep)

**Origin:** user directive 2026-07-14 after the B-012 floor-UUID fix: "check every
page and replace uuid with actual value using playwright."
**Status:** **COMPLETE (2026-07-14).** Playwright crawler (authed owner) swept all
44 pages — every static route + one detail/edit page per shape, scanning visible
text nodes and non-hidden input values for the UUID pattern. **One offender found**:
Place Stock queue "Lot / Quality" column rendered `qualityId` raw. Fixed on
`feat/s6-fe` `11ee83e` (getQueueColumns factory + qualityId→name map from
useQualities, raw-id fallback, both-branch tests; 749/749 green). Re-sweep after
fix: **0 findings across all pages**. Durable tripwire: `no-raw-uuids` sweep spec
added to the e2e suite (validation rides the next full-suite run).
**Extension (2026-07-14, user-reported):** the first sweep missed TRUNCATED ids —
13 sites rendered `id.slice(0,8)+'…'` (jw-out detail, jw-in detail, yarn-purchase
form + line table, beam-receipt detail). Fixed: 12 via client-side name lookups
(FE `dcefd58`, incl. dropping the wrong `status:'active'` filter on historical
display lookups — deactivated masters must still resolve); the jw-in SOURCES ref
via contract enrichment — shared **1.6.1 published** (`61ddbae`: optional
`sourceOutChallanNo`/`sourceLotNumber`), BE hydration set-based no-N+1 (`50bb3a3`),
FE consume + "JWO-xxx · LOT-xxx" display (`44ee02b`). e2e sweep spec regex now also
catches the truncation signature (`0d39067`). Final sweep: **0 findings, 46 pages,
both patterns**. Gotcha: vite's `.vite` dep-cache kept serving shared 1.6.0 whose
schema STRIPPED the new optional fields client-side — cache clear + FE restart
required after a shared bump.
**Note / follow-up:** transient states (error toasts) aren't covered by a page
sweep — e.g. the BE `INSUFFICIENT_BALANCE_AT_FLOOR` message embeds a floorId; if
any UI ever surfaces raw server messages, that could leak an id. Low priority.

## Follow-ups from Design v2 workstream (2026-07-18)

Logged at Design-v2 close (all branches READY TO MERGE; see spec 2026-07-17-design-v2-colourways-beam-drain-design.md):

1. **Dedicated `fabtraq_test` DB for BE integration tests** — now overdue; the shared-dev-DB truncation hazard bit twice this workstream (reviewer-agent wipe + L-FK4 leak; leak's root fixed in BE `027c7f2`).
2. **e2e `fillByLabel` substring flake** — `placement quantity 1` collides with `existing placement quantity <uuid starting "1">` ~1/16 runs; switch to exact-match labels.
3. **shared CHANGELOG** — missing entries for 1.6.0 and 1.7.0 (1.7.0 is a breaking shape change: recipeItems removed).
4. **FE repo-wide prettier drift** — ~173 files, pre-existing (base branch red on CI step 4 too); needs one dedicated formatting pass.
5. **BE audit-log writes are not atomic with the domain transaction** — pre-existing pattern across modules, surfaced during design-module review.
6. **FE polish**: detail-page mapped-cell label renders twice for owner/storekeeper (span + edit trigger); `numberFieldProps`/`fmt()` helper duplication across 3/2 files.
7. **e2e cold-start timing flake** — placement.spec.ts's first test can hit the 60s per-action timeout waiting for the vendor Select right after Playwright cold-spawns fresh BE/FE servers (`reuseExistingServer:false`); passed on re-run, product ruled out. Consider a warm-up navigation in auth.setup or a longer first-action timeout.

## B-015 — Stock Balance overview redesign (quality/SKU/state list + positions detail page)

**Origin:** user directive 2026-07-22 (session c5f3c08a): the balance page shows
position-level rows (location × floor × JW) when the owner needs a stock-item
overview — quality, SKU, processed state, quantity. Location/floor/job-worker move
to a drill-down page.

**Design:** `docs/superpowers/specs/2026-07-22-stock-balance-overview-design.md`.
New schema-first `GET /inventory/summary` (shared 1.9.0) rolling up the same
position accumulation `listBalances` uses; `/inventory` page becomes the 4-tuple
(quality, sku, processedTypes, unit) overview with a muted custody split
(In-house / At JW / Unplaced); new `/inventory/positions` detail page renders the
physical breakdown from the existing `GET /inventory`; e2e inventory spec
rewritten in lockstep (overview total == direct stock_ledger sum, click-through
to detail).

**Status:** COMPLETE 2026-07-22 (worktrees `feat/stock-overview-*`; main
checkouts untouched — concurrent agent). shared `eaa681b` (1.9.0, unpublished);
BE `2cf9529`+`3da20fa`+custody-normalization commit; FE `b3ba947`+`01defc7`+
stock-transfers floor-name fix; e2e rewrite + port/dir-parameterized config.
All gates green; live-verified visually + via rewritten e2e spec.
**Three real bugs found & fixed en route** (all pre-existing): (1) position
grouping key omitted `processedTypes` — distinct states silently merged;
(2) hybrid challan-out debit legs (destination jobWorkerId on the floor-debit
row) overstated in-house balances — fixed via read-side custody normalization
(`position-custody.ts`, D6 in the spec); (3) stock-transfers list rendered raw
floor UUIDs (B-014 violation, exposed by the sweep on a transfer-bearing DB).
**Pre-merge steps:** publish shared 1.9.0; `npm i` to refresh BE/FE lockfiles
(package.json already at ^1.9.0); push all four branches on user go.
**Known gap (pre-existing, unrelated):** `design-parse.routes.test.ts` multer
test fails in WORKTREE checkouts only — its fixture path resolves to
`../../../beam-designs/*.pdf` outside the repo; fine in the default layout.

## B-017 (candidate, 2026-07-28) — percent_total composition slices resolved per-slice, multi-line compositions 500

Found by sku-shade workstream BE Task 6 (impl-be-t6): `beam-receipt.controller.ts` (~line 104 area)
calls `distributeByPercentage(totalYarnUsed, [{ percentage: slice.percentage }])` per slice;
that helper requires percentages to sum to 100±0.001, so a lone slice under 100% throws an
uncaught Error → generic 500. Multi-line percent_total compositions (60%+40%) therefore 500 on
the second slice. Pre-existing — first HTTP-level test of this path is the D3 lock in
`tests/integration/sku-shade-regression-beam-receipt.routes.test.ts` (uses percentage:100 to
sidestep, with inline reasoning). Triage: check whether the FE ever emits multi-line
percent_total (consolidated-pull redesign may always send absolute); if the path is live, fix =
batch all of an item's percent_total slices into ONE distributeByPercentage call.

## B-018 (candidate, 2026-07-29) — beam composition ledger writes trust the DECLARED SKU; no BE-side lot-identity guard

Found by sku-shade e2e E5 (impl-e2e-e5): `applyBeamCompositionLedger` debits
`skuId: slice.skuId ?? null` (the beam yarn row's DECLARED SKU per
allocate-pulls), not the pulled lot's actual ledger SKU, and `createInHouse`'s
balance guard (`findLotLocationBalance`) checks lot+location+floor+unit only —
no qualityId/skuId. The shipped UI can't produce a mismatch (the pull picker's
query filters by exact SKU / IS NULL — verified live in E5), but a direct API
caller naming a lot whose stock sits under a different/null SKU would get a
cross-bucket ledger write (B-012 class). D2a's design explicitly assumed
"picker constrains input" rather than a BE guard. Triage: add a service-side
check that each composition slice's (lot, skuId-key) actually has balance under
that exact key, or accept + document the API trust boundary.

## B-019 (low, 2026-07-29) — OpenAPI documents skuId as uuid-format; server accepts NO_SHADE token

From sku-shade final review (LOW-1): the emitted query param on /inventory,
/inventory/lots, /inventory/lots/aggregated is {"type":"string","nullable":
true,"format":"uuid"}, but the server accepts the literal NO_SHADE (z.preprocess
is invisible to the emitter). No live impact today (nothing validates requests
against the spec), but a future B-004 request-validation gate would reject the
exact token D2a depends on. Fix: teach the emitter/schema the token union.

## B-020 (low, 2026-07-29) — sentinel label duplicated in four places, comment-enforced

From sku-shade final review (LOW-2): "No shade / greige" lives in shared's
SKU_ANSWER_REQUIRED_MESSAGE, FE QualitySkuSelect SENTINEL_LABEL, FE
DYED_LOT_SKU_REQUIRED_MESSAGE, and e2e fixtures/copy.ts (deliberate mirror).
e2e live-render assertions catch drift after the fact. Cheap fix: export the
label itself from shared and compose the messages from it (e2e stays a mirror).

---

## B-021 (2026-08-13) — at-JW balance checks don't serialize across transactions

**Origin:** Weaving-In BE review (session 4a58ca9b). `getWeavingWeftPositions` now reads
inside the caller's tx (fixed), but two CONCURRENT transactions can still both pass a
`consumedQty ≤ stillAtJwQty` ceiling check and overdraw an at-JW position: the stock
ledger is insert-only, Postgres runs READ COMMITTED, and no row lock is taken. This is
systemic — `findLotLocationBalance` (JW-Out path) has the same shape. Options when it
matters: advisory lock keyed on (jobWorkerId, outItemId), SERIALIZABLE with retry, or a
balance-materializing table with a CHECK. Low practical risk today (single storekeeper).

## B-022 — Fabric-stock aggregate loads every taka unbounded

`findActiveTakasForFabricStock` (`fabtraq-be/src/modules/weaving-in/prisma-weaving-in.repository.ts`)
fetches **every** non-cancelled `fabric_takas` row to build the Stock Balance Fabric tab aggregate.
Correct today and consistent with the house "compute in app, never aggregate in DB" rule, but it
degrades linearly as receipts accumulate.

The taka register (2026-08-14) is paginated and does not add to this. Fix when the row count makes
it felt — likely by bounding the read (e.g. paging internally and folding) rather than pushing the
aggregation into SQL, which the house rule forbids.

Logged: 2026-08-14, from `docs/superpowers/specs/2026-08-14-fabric-taka-register-design.md` §6.4.

## B-023 — Nothing records fabric leaving the godown

`findActiveTakasForFabricStock` treats every non-cancelled taka as on hand, and no transaction ever
removes fabric. The day the first lot ships to a processor, the register still shows it on the rack.

Predicted shadow behaviour: a storekeeper creates a Location named "Sent to Processor" and _places_
rolls there, at which point `locationId` silently encodes two different things and location data
becomes unrecoverable.

Pre-existing (not created by the taka register). Mitigated for now by labelling the Fabric tab count
"Received" rather than "In stock". Real fix is fabric dispatch, deferred by weaving-in spec §7.

Logged: 2026-08-14, from the fabric-taka-register design debate.

## B-024 — Declared taka count and lot totals on the weaving-in receipt

The paper challan carries a hand-written "13 Taka" across the middle, and a separately-weighed
`(13) 168.100` alongside the derived row-sum `1787 / 167.66 / 9382`. Mills reconcile declared
against derived precisely because the two disagree — that disagreement is what gets argued about at
the gate.

`weavingIn.totals` is derived from the grid rows only, so there is no declared figure to check
against and the mill's actual reconciliation is impossible in the system. Add a declared count +
declared meters/weight on the header, validated (or variance-shown) against the row sum. Cheapest
data-quality guard available.

Logged: 2026-08-14, from the fabric-taka-register design debate (domain review).

## B-025 — Filter/sort the taka register by `cutNotation`

`cutNotation` already stores the mill's own quality shorthand per roll (`11/0`, `4/9`, `1/12`). Made
filterable and sortable it answers "show me the clean rolls" — roughly 80% of the value of the
grading feature deferred by weaving-in spec §7, with no schema change and without reopening that
decision.

Logged: 2026-08-14, from the fabric-taka-register design debate (domain review).

## B-026 — Test helper emits an invalid transporter code prefix

`fabtraq-be/tests/helpers/masters.ts:89` builds transporter fixtures as `TR-${suffix}`, but shared's
canonical prefix is `TRP` (`fabtraq-shared/src/primitives/code.ts:19`, consumed by
`transporterCodeSchema`). Any read path that validates the fixture through that schema would fail
with a ResponseShapeViolation.

Latent, not currently triggered: `transporter.routes.test.ts` creates its transporter through the
API rather than this helper, so nothing exercises the bad code today.

Pre-existing — surfaced 2026-08-14 during the fabric-taka-register BE work (which fixed a _separate_
collision bug in the same helper, where `seedJwMasters`'s `code` fields ignored `namePrefix` while
`name` honoured it). Fix when next touching transporter fixtures; check for tests that assert the
`TR-` literal before changing it.

Logged: 2026-08-14.

## B-027 — e2e suite has a low-rate, load-sensitive timeout flake

Across many full `npm run e2e` runs the suite is green, but roughly one run in three fails a single
spec on a **timeout** — a different spec each time, never an assertion failure:

- `e9-verification` (PDF import) — `Test timeout of 60000ms exceeded`
- `masters/fabric-designs` — `getByText('Fabric design updated')` not visible within 10 s
- one run failed 14 specs at once with `ERR_CONNECTION_REFUSED` on :5173 — the Vite dev server was
  killed mid-run

Every affected spec passes 3/3 when run in isolation. The common factor is machine load: this box
runs unrelated dev servers alongside the suite and had ~7 GB of 39 GB free during these runs, so
Vite and the PDF parser are the first things to starve.

Not caused by the fabric-taka-register workstream (its two genuine contention bugs were separately
found, proven causally, and fixed). Worth addressing because a suite that is red one run in three
trains people to re-run rather than read the failure — which is exactly how a real regression gets
waved through.

Likely cheapest fixes: raise the toast/visibility timeouts that are tuned for an idle machine,
and/or give the pdf-parser webServer a longer readiness timeout.

Logged: 2026-08-14.

---

## B-028 — `format:check` fails on committed files in three repos

**Status:** Open. Found 2026-08-20 while running the Sprint-8 release gates.
**Severity:** Medium — red CI on `fabtraq-fe` today, and it blocks the merge-to-`main` PR everywhere.

`npm run format:check` (Prettier) reports already-committed files as unformatted:

| Repo             | Files failing                  |
| ---------------- | ------------------------------ |
| `fabtraq-be`     | 140                            |
| `fabtraq-fe`     | ~225                           |
| `fabtraq-shared` | 46                             |
| `e2e`            | n/a — no `format:check` script |

It is **step 2 of `.github/workflows/ci.yml`** in all three repos. When it bites differs by trigger:
`fabtraq-fe` runs CI on `push`/`pull_request` for `'**'`, so the 2026-08-20 push to
`feat/s6-consolidated-fe` **is failing now**; `fabtraq-be` and `fabtraq-shared` only trigger on
`main` and PRs into `main`, so theirs surfaces the moment a merge PR is opened.

How it hid: only `fabtraq-be`'s `verify` script chains `format:check`; `fabtraq-fe` and
`fabtraq-shared` run `lint && typecheck && test && build` with no formatting step. Agents that
verified per-repo with `verify` (or with the individual gates) never executed it. The offenders are
mostly `.superpowers/` planning docs and test files — i.e. exactly the paths nobody opens in a
watch loop.

**Fix:** `npm run format` in each of the three repos, one commit per repo, then re-run the gates.
Deliberately _not_ done as part of the 2026-08-20 release: a ~400-file whitespace diff on top of a
one-line version bump makes the release unreviewable. Do it as its own change, first thing before
the merge-to-`main` work.

**Also worth doing:** add `format:check` to `fabtraq-fe` and `fabtraq-shared`'s `verify` scripts so
the local gate matches CI, which is the actual root cause of the drift.

## B-029 — Retire the dead `jw_challan_out_item` Place-Stock branch

**Status:** Open. Created 2026-08-20 alongside L23.
**Severity:** Low — dead code for new data, not a defect. Removing it is riskier than leaving it.

Since L23, JW-Out items are always created `fully_placed`, so they never enter the Place Stock queue. These paths in `fabtraq-be` are now reachable only by rows created before that change:

| Path                                         | Location                                     |
| -------------------------------------------- | -------------------------------------------- |
| Queue listing (`jw_challan_out_item` branch)  | `place-stock.service.ts:185-191, :231-241`   |
| `resolveSourceItemMeta` challan-out cases     | `place-stock.service.ts:902, :958, :1037`    |
| `applyPlacementLedger` dispatch legs          | `prisma-inventory.service.ts:1955`           |

Three integration tests still exercise this path deliberately (`inventory-placement-ledger.service`, `place-stock-ledger-wiring.service`, `jw-challan-in-be8.routes`); since 2026-08-20 they seed their pending rows directly via Prisma, because the route can no longer create one. Remove the branch only once no pre-L23 `pending`/`partially_placed` out-items remain in any environment — and delete those fixtures with it.

## B-030 — Re-enter `JWO-2026-27-026`

**Status:** Open. User-owned manual fix-up. **Note:** the row was destroyed when the e2e suite truncated `fabtraq_dev` on 2026-08-20; it survives only in `db-snapshots/fabtraq_dev-2026-08-20-pre-conservation-tests.sql`. If that snapshot is never restored, this item is moot — close it.
**Severity:** Medium — while it existed, the lot it drew on still read its full pre-challan balance, so it could be issued twice.

`JWO-2026-27-026` dispatched 100 kg of `LOT-260819-0028` (50 kg on floor) with zero placements, so it wrote zero `stock_ledger` rows. It is the defect that prompted L23. It could not be repaired in place — `editPlacement` 409s on `jw_challan_out_item`, and topping it up through the Place Stock queue stops at 50 kg. The fix is cancel-and-recreate with a real placement. No migration or backfill (L8 convention).

## B-031 — JW-Out row's unit `<Select>` is not pinned to the picked lot

**Status:** Open. Found 2026-08-20 while implementing L23's check 1.
**Severity:** Low — the backend catches the mismatch; the UI just allows a nonsensical intermediate state.

`SourceLotPicker`'s `onChange` sets `sourceLotNumber`, `availableFloors` and clears `placements`, but never sets `items.N.unit`. So the row's editable unit `<Select>` can diverge from the picked lot's actual denomination (KG vs METER). The backend rejects it — balances are keyed by unit, so a METER request against a KG lot finds zero available — but the form lets the two drift silently until save. The check-1 warning sidesteps this by formatting with the lot's own unit (captured into `lotUnit` state), rather than the form field. Proper fix: pin the unit from the lot on selection, or make it read-only once a lot is chosen. Pre-existing; not introduced by L23.

## B-032 — JW-Out line-item guard messages wrap one word per line

**Status:** Open. Found 2026-08-20 by visual verification of L23's guards (green tests did not surface it).
**Severity:** Low — both guards fire correctly and the text is legible; it is ugly, not broken.

The Line-items table has ten columns, so the `Net Wt` cell is ~70px wide. Both L23 guard messages render in that cell's `<FieldError>` and wrap to 5-8 lines of one or two words:

- `Only 50.000 KG available in this lot` (check 1, `ChallanOutLineItemRow.tsx`)
- `Placements must add up to the net weight — 50 of 30 KG allocated.` (check 2, the shared schema's superRefine)

A `w-44` on the `<td>` was tried and had **no effect** — the auto table layout ignores it while the Placements column dominates the width; it was reverted rather than left in as a no-op. Real fixes, in rough order of preference: let the error text span the row beneath the inputs instead of living inside the narrow cell; or shorten both strings (the check-2 string lives in `@pashwashah04/fabtraq-shared`, so that half needs a republish). Note the `ConservationBar` in the Placements column already states the same fact far more legibly ("Over by 20.000"), so check 2's long message is largely redundant with it.

Screenshots: `e2e/e2e-artifacts/conservation-1-over-balance.png`, `conservation-2-not-conserved.png`.

## B-033 — Line-items "Totals" row renders NaN for blank Bags / Gross Wt

**Status:** Open. Pre-existing; observed 2026-08-20 during L23 visual verification. Not caused by L23.
**Severity:** Low — cosmetic, but it is on-screen on every new JW-Out challan.

The JW-Out form's totals row shows `Totals NaN` for Bags and `NaN kg` for Gross Wt whenever those optional inputs are left blank, because the reducer sums `undefined`/`NaN` from `valueAsNumber` registrations instead of coalescing to 0. Visible in both screenshots above. Fix: coalesce non-finite values to 0 in the totals reducer.
