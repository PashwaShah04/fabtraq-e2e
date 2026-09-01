# Module expert teams — repo study (2026-09-01)

Evidence behind the 14-module boundary and the per-module agent handbooks (`.claude/agents/modules/<module>/BRIEF.md`).

Produced by a 13-agent read-only workflow (12 domain studies + 1 critic), 147 tool calls, ~1.1M tokens. Raw JSON: session `54c5222c-86f3-48e4-9fce-9e0c823ca902`, run `wf_dfe17a8b-07f`.

**Read the critic section before trusting any citation below — six were corrected.**


## Final module list (owner-approved)

| # | Module | Scope |
|---|---|---|
| 1 | masters | vendor, transporter, job-worker, location, quality+SKU — one CRUD template, 5 stamps; owns the 4 shared FE pickers |
| 2 | designs | design v2 + PDF-parse |
| 3 | yarn-purchase | purchase header + items + placements |
| 4 | jw-challan-out | JW-Out lifecycle; owns eligible-out-item + close-out-as-loss schemas |
| 5 | jw-challan-in | JW-In receipts; boundary reading = beam-receipt.service.ts:493-720 + getOutItemRollup |
| 6 | inventory | ledger, place-stock, stock-transfer, overview; owns stock_ledger/placement Prisma models |
| 7 | provenance | lineage/trace + wastage reports — read-only ledger consumers |
| 8 | beams | beam register + beam-receipt (sole writer of Beam rows) |
| 9 | weaving | dispatch + weaving-in + fabric-taka + fabric-design |
| 10 | challan-print | pure FE PDF render layer |
| 11 | auth | login/JWT/CSRF/rate-limit/role guards — BE+FE |
| 12 | app-shell | router, layouts, shadcn ui, generic shared components/hooks/lib, 404 |
| 13 | shared-infra | registry core, typed client, MSW, error handling, logging, openapi, audit-log service, config |
| 14 | e2e-harness | playwright config, fixtures, seed, repair/audit scripts — not the flow specs |

Changes vs the raw studies: fabric-design → weaving; audit-log → shared-infra; csrf/rate-limit → auth; provenance and app-shell created for unowned code; flow specs routed to feature owners; phantom `jw-challan-in-beam.service.ts` struck; challan-print returns BE mappers to jw-out/weaving.


## Critic pass


### Boundary recommendation

- masters — vendor/transporter/job-worker/location/yarn-quality+sku (BE+FE+shared+e2e/tests/masters minus designs). Keep as one: one CRUD template, 5 stamps; add the 4 shared FE pickers (TransporterSelect, LocationFloorSelect, QualitySkuSelect, CompositionTable) and delete the yarn-purchases re-export shims.
- designs — design v2 + pdf-parse (BE design/, FE designs/, shared design.ts+design-parse.ts+designs.registry, e2e design-v2+masters/designs). Split from fabric-design as the study says.
- fabric-designs → fold into weaving (only consumer is weaving-in; ~1.2k LOC is too small to stand alone; e2e/masters/fabric-designs.spec.ts goes with it).
- auth — BE modules/auth + shared/http/{auth,csrf}.ts + shared/security/rate-limit.ts + FE features/auth + shared/api/{auth-store,csrf}.ts + shared schemas/registry auth + e2e auth.setup + guards/role-guards.spec + smoke/redirects.spec. Take csrf/rate-limit away from shared-infra: they're security surface, not plumbing.
- audit-log → fold into shared-infra as a cross-cutting BE service (write-only, 33 callers, zero read path); FE features/audit stub rides along. Not worth a standalone agent.
- app-shell — NEW: FE src/app/**, components/ui, styles, shared/components (the 15 unclaimed generic ones), shared/hooks, shared/lib, features/not-found, features/audit page shell, e2e smoke/{routes,no-raw-uuids}.spec + visual/. Nobody owns router.tsx today; the UI-redesign waves all touched this.
- shared-infra — BE shared/{http minus auth+csrf, db, logging, openapi, inventory/sequences}, config/, app.ts, main.ts, types/, scripts/emit-openapi.ts; FE shared/api/{client,typed-client,errors,types} + tests/msw + tests/integration/contract; shared registry/types+params+index, errors/, validation/, primitives/, constants/, schemas/common.ts+index.ts. Drop schemas/beam.ts and schemas/forms/* (give forms to their feature owners). Own the per-domain *.registry.ts only as reviewer-of-shape; the feature agent owns content.
- yarn-purchase — keep as is; drop the shim files from its path list once deleted.
- jw-challan-out — keep; owns shared jw-challan-out.ts, close-out-as-loss.ts, eligible-out-item.ts (jw-in is a consumer). Also owns e2e jw-out + out-item-conservation specs.
- jw-challan-in — keep; strike every reference to a 'jw-challan-in-beam.service.ts' (doesn't exist); add e2e cancelled-parent-guard.spec + party-lot-carry-forward.spec + jw-challan-visibility.spec to its owned specs; boundary reading list = beam-receipt.service.ts:493-720 and getOutItemRollup, not a phantom service.
- inventory — inventory + place-stock + stock-transfer + overview (BE+FE+shared incl. placements.registry.ts, schemas/inventory/placement.ts, stock-transfer.ts, overview/) + e2e inventory/inventory-hub/inventory-chart/placement/place-stock-transfer-sync/stock-transfer + guards/seed-ledger-shape.spec. Also owns prisma/schema.prisma stock_ledger/placement models.
- provenance — NEW per inventory study's split: BE lineage + wastage, FE trace + reports, shared lot-lineage.ts + wastage.ts + lot-lineage.registry + constants/wastage, e2e trace + wastage-report. Read-only ledger consumers; ~3.3k LOC; pending inventory-rewoven brainstorm lives here.
- beams — beam + beam-receipt (BE/FE/shared beam.ts + beam-receipt.ts + forms/beam-receipt-yarn.ts + both registries) + e2e beams/beams-grouped/beam-receipt/jw-in-beam. Owns deletion of shared jw-challan-in-beam.ts (dead) and the stale JwChallanInBeamService comments. Owns prisma Beam/BeamReceipt models.
- weaving — weaving-dispatch + weaving-in + fabric-taka + fabric-design (BE/FE/shared/e2e incl. fabric-taka-register + masters/fabric-designs specs). Keep merged per study; absorb fabric-design.
- challan-print — keep as pure FE render layer; REMOVE the 4 BE mapper/repository files from its bePaths (they belong to jw-challan-out/weaving); it holds only a read dependency on the shared consignee schema. Owns e2e challan-pdf.spec.
- e2e-harness — playwright.config, fixtures/*, support/*, auth.setup wiring, package.json scripts, README, BE prisma/seed.ts + seed-constants + scripts/{lot-identity-audit,repair-cancelled-parent-ledger,audit-out-item-conservation.sql}, BE tests/helpers/**. NOT the 26 flow specs — each goes to its feature owner (assignments above). Shrinks to ~3k LOC.

### Disputed / corrected citations

- jw-challan-in B-044: cites 'jw-challan-in.service.ts:1000, no add-back of stillAtJwQty' — line 1000 is toAuditSnapshot(). The ceiling is computed at :939-977 (newConsumed sums src.consumedQty verbatim; no stillAtJw term) — the claim is plausible but the citation is wrong. Correct cite: fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.ts:939-943,954-962 vs prisma-inventory.service.ts:884-892 (the algebra comment saying ΣstillAtJw is kept in pendingAtJW).
- jw-challan-in: repeatedly asserts a 'jw-challan-in-beam.service.ts on BE' sibling service (sharedPaths note, crossDomainDeps, splitOrMerge). No such file exists under fabtraq-be/src (find -iname '*in-beam*' returns nothing). The service was folded into beam-receipt.service.ts:493 ('createSizingJw — moved from JwChallanInBeamService'); only a stale comment in jw-challan-in.module.ts:19 and the shared schema jw-challan-in-beam.ts remain. Beams' 'legacy/dead schema' reading is the correct one.
- beams: 'the beam domain never writes stock_ledger rows directly' — true for writes, but beam-receipt.service.ts:752-755 reads tx.stockLedger directly (cancel guard), bypassing IInventoryService. Phrase as 'never writes; one direct read at :752'.
- designs: cites 'design.ts:66-67 — percentage stored verbatim, NOT gated on summing to 100'. Lines 66-67 only show per-value gt(0).max(100); the no-sum-gate statement is the comment at fabtraq-shared/src/schemas/master/design.ts:110 (plus the FE warning helper at :220-240). Claim true, cite off.
- e2e-harness: cites 'playwright.config.ts:38-44 — workers: 1, fullyParallel: false'. Those are at :30-31; :38-44 is the `use`/projects block. Claim true, cite off.
- masters: 'vendor.service.ts:88-131 generates the code inside the same transaction and retries exactly once' — :101-131 is update(); the retry lives in attemptCreate at :173-240 (P2002 checks at :218-235). Claim true, cite off.
- auth-audit: 'RoleGuard/RequireAuth redirect to /login?from=… — login.page.tsx presumably reads from … suspected root of B-034' is explicitly speculative ('presumably', 'suspected'); not verified against login.page.tsx — flag as hypothesis, not invariant.

### Paths no study claimed

- fabtraq-be/src/shared/inventory/sequences.ts (+test) — used by yarn-purchase/jw-in/wastage repos, claimed by nobody
- fabtraq-be/src/shared/logging/logger.ts (+test)
- fabtraq-be/src/shared/openapi/{emit,sanitize,zod-instance}.ts (+tests) — shared-infra flagged it as 'worth a follow-up read' but did not claim it
- fabtraq-be/src/shared/security/{helmet,rate-limit}.ts (+tests) — rate-limit is what RATE_LIMIT_AUTH_MAX feeds; unclaimed
- fabtraq-be/src/types/express.d.ts
- fabtraq-be/prisma/migrations/** and prisma/schema.prisma (beams cites 3 model line numbers; no study owns the schema)
- fabtraq-be/scripts/{emit-openapi.ts,lot-identity-audit.ts,repair-cancelled-parent-ledger.ts,audit-out-item-conservation.sql}
- fabtraq-be/tests/** (integration suites, tests/helpers/masters.ts only mentioned as B-026 cross-ref by masters)
- fabtraq-fe/src/app/{App.tsx,router.tsx,providers.tsx,layout/AppLayout.tsx,layout/AuthLayout.tsx} — auth-audit says 'fold not-found into whatever shell domain owns router.tsx' but no such domain exists
- fabtraq-fe/src/components/ui/** (shadcn primitives)
- fabtraq-fe/src/styles/**, fabtraq-fe/src/main.tsx
- fabtraq-fe/src/shared/components/{AuthLoadingSkeleton,AvailableFloorSelect,ColourSwatch,ConfirmDialog,ConservationBar,DataTable,DetailSection,EmptyState,ErrorBoundary,FieldError,FormField,GridCellField,PageHeader,PlacementFieldArray,Stat}.tsx — only 6 of 21 shared components are named by any study
- fabtraq-fe/src/shared/hooks/{useDebounce,usePagination,useToast}.ts
- fabtraq-fe/src/shared/lib/{beam-origin,cn,date-input,env,format,location-display,modules,placement-guards}.ts (+tests)
- fabtraq-fe/tests/{unit,smoke,helpers,setup.ts,integration/features/**,integration/api,msw/handlers/**} — only tests/integration/contract/* and tests/msw/ dir were claimed (shared-infra)
- fabtraq-shared/src/schemas/transaction/close-out-as-loss.ts
- fabtraq-shared/src/registry/inventory/placements.registry.ts (inventory study lists inventory+lot-lineage registries only; shared-infra's blanket claim is the sole cover)
- fabtraq-shared/src/index.ts, fabtraq-shared/tests/** (except tests/validation/msw-wrapper.test.ts and the 4 jw-challan-in schema tests)
- e2e/tests/guards/{role-guards,seed-ledger-shape}.spec.ts
- e2e/tests/smoke/{no-raw-uuids,redirects,routes}.spec.ts (codes/db noauth only mentioned tangentially by auth-audit)
- e2e/tests/visual/e9-verification.spec.ts
- e2e/tests/flows/cancelled-parent-guard.spec.ts and party-lot-carry-forward.spec.ts — listed in the harness inventory but no feature domain (jw-in is the natural owner) claims them
- e2e/support/*.ts and e2e/fixtures/{copy,codes,test}.ts, pdfs/ — harness study describes them in prose but enumerates none in its path lists

### Paths claimed twice

- fabtraq-be/src/shared/http/auth.ts (+test) — auth-audit AND shared-infra
- fabtraq-shared/src/registry/** — shared-infra claims all 30 registry files; masters, designs, auth-audit, yarn-purchase, inventory, beams, weaving each also claim their own *.registry.ts
- fabtraq-shared/src/schemas/beam.ts — beams AND shared-infra (shared-infra itself flags it as mis-scoped)
- fabtraq-shared/src/schemas/forms/* — shared-infra claims the dir; yarn-purchase (yarn-purchase-item.ts), jw-challan-in (jw-challan-in-lot.ts), beams (beam-receipt-yarn.ts) each claim one file
- fabtraq-shared/src/primitives/code.ts — masters AND shared-infra
- fabtraq-shared/src/schemas/transaction/jw-challan-out.ts — jw-challan-out (whole file), inventory (superRefine :58,84-110), challan-print (:258-284)
- fabtraq-shared/src/schemas/transaction/jw-challan-in-beam.ts — beams ('legacy/dead') AND jw-challan-in ('adjacent live sibling service')
- fabtraq-shared/src/schemas/transaction/eligible-out-item.ts — jw-challan-out claims it; jw-challan-in is its consumer
- fabtraq-fe/src/shared/components/{TransporterSelect,LocationFloorSelect,QualitySkuSelect,CompositionTable}.tsx — masters lists them under sharedPaths; yarn-purchase claims QualitySkuSelect + its test via re-export shims
- fabtraq-fe/src/features/yarn-purchases/components/{QualitySkuSelect,TransporterSelect,LocationFloorSelect}.tsx — yarn-purchase (shims) vs masters (targets)
- fabtraq-be/src/modules/jw-challan-out/{jw-challan-out.mapper.ts,prisma-jw-challan-out.repository.ts} and weaving-dispatch/{mapper,prisma-repository}.ts — jw-challan-out/weaving own them; challan-print also lists them as bePaths
- e2e/tests/flows/*.spec.ts (26 files) — e2e-harness lists all 26; every feature study also lists its own (jw-in-beam.spec.ts is claimed by jw-challan-in, beams AND harness; weaving-dispatch.spec.ts by weaving, jw-challan-out, challan-print; challan-pdf.spec.ts by challan-print and jw-challan-out)
- e2e/tests/masters/designs.spec.ts + fabric-designs.spec.ts — designs claims; masters explicitly disclaims (fine, but harness also lists masters/ generically)
- fabtraq-be/src/shared/db/serializable.ts — shared-infra; also the runSerializable used by jw-in/beam-receipt (implicit)

## Domain studies (raw, pre-critic)


### masters → `masters`

**Verdict:** keep — the 5 modules (vendor, transporter, job-worker, location, yarn-quality/yarn-sku) share one repeated architectural pattern end-to-end (auto-code-gen-with-retry, soft-status not delete, Page<> envelope, identical BE layering, identical FE hooks/api/columns/list/form shape) with vendor explicitly locked in docs/backlog.md as the canonical template the others must converge on — splitting them would fragment a single template into 5 near-duplicate expert-agent contexts with no natural seam; total size (~11.6k LoC incl. tests) is large but dominated by test files (BE tests alone are ~2066 lines) and near-boilerplate CRUD, not complexity. One caveat: do NOT fold designs/fabric-designs into this domain even though they share the shared/registry/master and e2e/tests/masters directories — those are a genuinely separate domain that merely co-locates files.

**Size:** 11661 LOC. **Tests:** ["BE unit/service tests: vendor.service.test.ts (331), transporter.service.test.ts (243), job-worker.service.test.ts (371), location.service.test.ts (258), yarn-quality.service.test.ts (296), yarn-quality.mapper.test.ts (69), yarn-sku.service.test.ts (498) — 2066 lines total across 7 files","FE test: qualities/hooks.test.tsx (70) — only FE-level test file found in the 5 features (list/form pages otherwise covered by e2e, not unit tests)","e2e: 6 spec files under e2e/tests/masters/ + e2e/tests/flows/sku-empty-quality.spec.ts = 999 lines across 7 files (vendors, transporters, job-workers, locations, qualities, sku-empty-quality); designs.spec.ts and fabric-designs.spec.ts live in the same masters/ e2e dir but are a different domain"]


**BE paths**
- fabtraq-be/src/modules/vendor/vendor.controller.ts (131)
- fabtraq-be/src/modules/vendor/vendor.service.ts (267)
- fabtraq-be/src/modules/vendor/vendor.repository.ts (155)
- fabtraq-be/src/modules/vendor/prisma-vendor.repository.ts (165)
- fabtraq-be/src/modules/vendor/vendor.mapper.ts (44)
- fabtraq-be/src/modules/vendor/vendor.routes.ts (61)
- fabtraq-be/src/modules/vendor/vendor.module.ts (27)
- fabtraq-be/src/modules/vendor/vendor.service.test.ts (331)
- fabtraq-be/src/modules/vendor/index.ts (2)
- fabtraq-be/src/modules/transporter/transporter.controller.ts (96)
- fabtraq-be/src/modules/transporter/transporter.service.ts (174)
- fabtraq-be/src/modules/transporter/transporter.repository.ts (66)
- fabtraq-be/src/modules/transporter/prisma-transporter.repository.ts (114)
- fabtraq-be/src/modules/transporter/transporter.mapper.ts (28)
- fabtraq-be/src/modules/transporter/transporter.routes.ts (65)
- fabtraq-be/src/modules/transporter/transporter.module.ts (58)
- fabtraq-be/src/modules/transporter/transporter.service.test.ts (243)
- fabtraq-be/src/modules/transporter/index.ts (2)
- fabtraq-be/src/modules/job-worker/job-worker.controller.ts (104)
- fabtraq-be/src/modules/job-worker/job-worker.service.ts (210)
- fabtraq-be/src/modules/job-worker/job-worker.repository.ts (85)
- fabtraq-be/src/modules/job-worker/prisma-job-worker.repository.ts (168)
- fabtraq-be/src/modules/job-worker/job-worker.mapper.ts (43)
- fabtraq-be/src/modules/job-worker/job-worker.routes.ts (64)
- fabtraq-be/src/modules/job-worker/job-worker.module.ts (35)
- fabtraq-be/src/modules/job-worker/job-worker.service.test.ts (371)
- fabtraq-be/src/modules/job-worker/index.ts (2)
- fabtraq-be/src/modules/location/location.controller.ts (73)
- fabtraq-be/src/modules/location/location.service.ts (187)
- fabtraq-be/src/modules/location/location.repository.ts (130)
- fabtraq-be/src/modules/location/prisma-location.repository.ts (312)
- fabtraq-be/src/modules/location/location.mapper.ts (27)
- fabtraq-be/src/modules/location/location.routes.ts (62)
- fabtraq-be/src/modules/location/location.module.ts (34)
- fabtraq-be/src/modules/location/location.service.test.ts (258)
- fabtraq-be/src/modules/location/index.ts (2)
- fabtraq-be/src/modules/yarn-quality/yarn-quality.controller.ts (189)
- fabtraq-be/src/modules/yarn-quality/yarn-quality.service.ts (168)
- fabtraq-be/src/modules/yarn-quality/yarn-quality.repository.ts (101)
- fabtraq-be/src/modules/yarn-quality/prisma-yarn-quality.repository.ts (135)
- fabtraq-be/src/modules/yarn-quality/yarn-quality.mapper.ts (55)
- fabtraq-be/src/modules/yarn-quality/yarn-quality.mapper.test.ts (69)
- fabtraq-be/src/modules/yarn-quality/yarn-quality.routes.ts (99)
- fabtraq-be/src/modules/yarn-quality/yarn-quality.module.ts (70)
- fabtraq-be/src/modules/yarn-quality/yarn-quality.service.test.ts (296)
- fabtraq-be/src/modules/yarn-quality/yarn-sku.service.ts (240)
- fabtraq-be/src/modules/yarn-quality/yarn-sku.repository.ts (134)
- fabtraq-be/src/modules/yarn-quality/prisma-yarn-sku.repository.ts (156)
- fabtraq-be/src/modules/yarn-quality/yarn-sku.service.test.ts (498)
- fabtraq-be/src/modules/yarn-quality/index.ts (2)

**FE paths**
- fabtraq-fe/src/features/vendors/{hooks.ts,api.ts,columns.tsx,vendor-list.page.tsx,vendor-form.page.tsx,query-keys.ts} (732 total)
- fabtraq-fe/src/features/transporters/{hooks.ts,api.ts,columns.tsx,transporter-list.page.tsx,transporter-form.page.tsx,query-keys.ts} (603 total)
- fabtraq-fe/src/features/job-workers/{hooks.ts,api.ts,columns.tsx,job-worker-list.page.tsx,job-worker-form.page.tsx,query-keys.ts} (652 total)
- fabtraq-fe/src/features/locations/{hooks.ts,api.ts,columns.tsx,location-form.page.tsx,location-list.page.tsx,types.ts,query-keys.ts,floor-row.tsx} (699 total)
- fabtraq-fe/src/features/qualities/{hooks.ts,hooks.test.tsx,sku-form.tsx,api.ts,columns.tsx,skus-tab.tsx,query-keys.ts,quality-list.page.tsx,quality-form.page.tsx} (1356 total)

**Shared paths**
- fabtraq-shared/src/schemas/master/vendor.ts (70)
- fabtraq-shared/src/schemas/master/transporter.ts (40)
- fabtraq-shared/src/schemas/master/job-worker.ts (65)
- fabtraq-shared/src/schemas/master/location.ts (62)
- fabtraq-shared/src/schemas/master/yarn-quality.ts (50)
- fabtraq-shared/src/schemas/master/yarn-sku.ts (59)
- fabtraq-shared/src/schemas/master/index.ts (9, barrel — also re-exports design/fabric-design schemas outside this domain)
- fabtraq-shared/src/registry/master/vendors.registry.ts (42)
- fabtraq-shared/src/registry/master/transporters.registry.ts (41)
- fabtraq-shared/src/registry/master/job-workers.registry.ts (41)
- fabtraq-shared/src/registry/master/locations.registry.ts (41)
- fabtraq-shared/src/registry/master/yarn-qualities.registry.ts (92)
- fabtraq-shared/src/registry/master/index.ts (7, barrel — also re-exports designs/fabric-designs registries, NOT part of this domain)
- fabtraq-shared/src/primitives/code.ts (30 — ENTITY_CODE_PREFIXES/formatEntityCode consumed by every master service)
- fabtraq-fe/src/shared/components/TransporterSelect.tsx
- fabtraq-fe/src/shared/components/LocationFloorSelect.tsx
- fabtraq-fe/src/shared/components/QualitySkuSelect.tsx
- fabtraq-fe/src/shared/components/CompositionTable.tsx

**e2e specs**
- e2e/tests/masters/vendors.spec.ts (43)
- e2e/tests/masters/transporters.spec.ts (43)
- e2e/tests/masters/job-workers.spec.ts (50)
- e2e/tests/masters/locations.spec.ts (79)
- e2e/tests/masters/qualities.spec.ts (258)
- e2e/tests/flows/sku-empty-quality.spec.ts (208)
- e2e/tests/masters/designs.spec.ts and fabric-designs.spec.ts sit in the same masters/ dir but belong to a separate 'designs' domain, NOT this one

**Governing docs**
- docs/backlog.md:153-154 — 'P3: 4 master list endpoints (job-workers, transporters, locations, qualities)' migrated to schema-first registry pattern (B-004)
- docs/backlog.md:180-291 — Vendor module locked as the canonical P5 cast-free template (BE+FE) that the other 4 master modules should be migrated to match; documents the exact recipe (typedClient.call delegations, no `as` casts)
- docs/backlog.md:900-914 — B-026: fabtraq-be/tests/helpers/masters.ts:89 emits an invalid `TR-` transporter code prefix (canonical prefix is `TRP`), latent because transporter.routes.test.ts doesn't use that helper
- docs/backlog.md:1115-1123 — B-039 (in progress): beam-receipt-form.page.tsx renders transporterId as a free-text UUID box instead of the shared TransporterSelect combobox
- docs/backlog.md:1127-1148 — B-040 (open): purchase-origin beam receipts have no vendorId FK, so 'Sourced From' can't resolve them; also flags dead `sizingName` field for removal
- docs/backlog.md:19-32 — masters-picker N+1 discussion: VendorSelect/TransporterSelect/LocationFloorSelect/QualitySkuSelect/useQualities/useJobWorkers all hit paginated CRUD list endpoints directly (perf/consistency note)
- docs/backlog.md:730-742 — deactivated-master resolution rule: historical display lookups must NOT filter status='active' (fixed 2026-07-14 bug where truncated/raw master ids leaked into UI when the active filter wrongly hid inactive records)
- fabtraq-be/docs/sprints/sprint-3.md:109,113-114,137,141 — Sprint 3 unified job-worker/transporter/yarn-quality/location list responses into the Page<> envelope (fixed Sprint-2 inconsistency); FE transporter PUT→PATCH fix; balanceAfter skuId mismatch note (JW domain, not masters-owned)
- docs/superpowers/specs/2026-05-08-yarn-sku-contract-alignment-design.md — governs the YarnSku shade/code contract shared between BE service and FE sku-form
- fabtraq-shared/src/primitives/code.ts:14-22 — ENTITY_CODE_PREFIXES is the single source of truth for all 6 auto-generated master codes (VEN/QTY/SKU/JW/TRP/LOC/DSN) — must be read before touching any master's code-gen path

**Invariants (see critic corrections)**
- Auto-generated entity codes are sequential per-prefix, zero-padded to 3 digits, format enforced by regex `^${prefix}-[0-9]{3,}$` — fabtraq-shared/src/primitives/code.ts:10-30; every master service (vendor.service.ts:88-131, yarn-quality.service.ts:~104-128, similarly transporter/job-worker/location) generates the code inside the same Prisma transaction as the insert and retries exactly once on a P2002 unique-constraint race before rethrowing as ConflictError — vendor.service.ts:86-97 (create doc), pattern repeated identically across all 5 modules
- Masters use soft status ('active'/'inactive'), never hard delete — every list/get query optionally filters by status but update() only ever sets status, no delete() method exists on any of the 5 repositories (verified: no `delete` in vendor/transporter/job-worker/location/yarn-quality service or repository files)
- Location floor reconciliation on PATCH (only when `floors` is present in the payload): items with `id` → update name+status; items without `id` → insert new floor; existing ACTIVE floors whose id is absent from the payload are soft-deactivated (status='inactive'), never deleted — fabtraq-be/src/modules/location/location.service.ts:36-39 (doc) and prisma-location.repository.ts:236-272 (reconcileFloors implementation)
- Location update validates floor-id ownership BEFORE entering the transaction — a floor id belonging to a different location throws ValidationError, not silently reassigned — fabtraq-be/src/modules/location/location.service.ts:98,116-126
- YarnSku uniqueness is composite on (qualityId, name, shadeNumber) — duplicate throws ConflictError with a message that varies by whether shadeNumber is present ('no shade' vs quoted shade) — fabtraq-be/src/modules/yarn-quality/yarn-sku.service.ts:117-118,167,184,235-239
- YarnSku create/update rejects a URL/body qualityId mismatch and requires the parent YarnQuality to exist — fabtraq-be/src/modules/yarn-quality/yarn-sku.service.ts:116-133
- Deactivated ('inactive') masters MUST still resolve by id for historical/display lookups — filtering list queries by status='active' when resolving a name for an existing challan/ledger row is a confirmed-and-fixed bug class — docs/backlog.md:730-739 (2026-07-14 incident, FE dcefd58)
- Vendor is the locked canonical P5 template (cast-free typedClient/registerEndpoint pattern) that transporter/job-worker/location/yarn-quality are meant to converge on but have NOT yet been migrated to as of the backlog snapshot — docs/backlog.md:180-291

**Cross-domain deps**
- FE: shared/components/{VendorSelect(under yarn-purchases),TransporterSelect,LocationFloorSelect,QualitySkuSelect,CompositionTable} are consumed by ~30 feature pages outside masters — jw-challans-in/out, weaving-ins/dispatches, stock-transfers, beam-receipts, placements, designs, yarn-purchases, inventory, overview, reports — i.e. masters is a heavily-fanned-out dependency, not a dependent
- FE: useJobWorkers / useQualities hooks are imported directly (not just via the shared pickers) by jw-challans-out list/form and line-item rows — docs/backlog.md:19-21
- BE: masters modules have NO inbound dependency from other BE modules' code — only wired centrally in app.ts/main.ts/config/tokens.ts (DI registration), confirmed by grep showing zero cross-module imports of vendor/transporter/job-worker/location/yarn-quality from any other fabtraq-be/src/modules/* directory
- shared: fabtraq-shared/src/registry/master/index.ts and schemas/master/index.ts barrel-export designs.registry.ts and fabric-designs.registry.ts alongside the 5 candidate modules — those two belong to a separate 'designs' domain and should NOT be pulled into a masters split/merge decision just because they share a directory
- fabtraq-be/tests/helpers/masters.ts is a shared BE test-fixture helper used by integration tests across other domains (JW challans, beams) for seeding vendor/transporter/job-worker/location/quality fixtures — contains the B-026 bug

**Known debt**
- B-026 (docs/backlog.md:900-914): fabtraq-be/tests/helpers/masters.ts:89 builds transporter fixtures with prefix 'TR-' instead of canonical 'TRP-'; latent because transporter.routes.test.ts creates its transporter via the API not the helper
- B-039 (docs/backlog.md:1115-1123, in progress 2026-08-26): beam-receipt-form.page.tsx uses a raw text input for transporterId instead of the shared TransporterSelect combobox; also flags that the field is incorrectly gated to beamOrigin==='sizing_jw' only
- B-040 (docs/backlog.md:1127-1148, open 2026-08-26): purchase-origin BeamReceipts have no vendorId FK at all — 'Sourced From' renders '—' for ~half of beams in test-DB sampling; fix adds nullable vendorId to BeamReceipt + drops dead sizingName field from beamResponseSchema/beamReceiptItemResponseSchema
- Vendor-as-template migration incomplete: transporter/job-worker/location/yarn-quality modules have not yet been migrated to the cast-free P5 registerEndpoint/typedClient pattern that vendor now uses as reference (docs/backlog.md:191,287)
- No TODO/FIXME/ponytail: comments found in any of the 5 BE modules, 5 FE features, or shared/schemas/master via direct grep — debt is tracked in backlog.md, not inline

### designs → `design-v2 (warp recipe/colourways) split from fabric-design (weft master)`

**Verdict:** split: "design" (BE+FE, ~7000 LOC incl. FE) and "fabric-design" (BE+FE, ~1200 LOC) are two unrelated masters sharing only a naming root — zero shared code, invariants, consumers, or mutability model (Design v2 is immutable-except-shade-sku with colourway/beam-drain complexity and its own PDF-ingest subsystem; FabricDesign is a plain job-worker-anatomy master consumed only by weaving-in). An expert agent for one gets no leverage from the other; keep them as two domains: `designs` (design v2 + pdf-parse) and `fabric-designs` (weft master, folded conceptually under weaving-in's domain since that's its only consumer).

**Size:** 3126 LOC. **Tests:** ["BE unit: design.service.test.ts (360 lines), design.module.test.ts (70), design-parse.service.test.ts (111), design-parse.errors.test.ts (83), design-pdf.upload.test.ts (72), pdf-parser.client.test.ts (152) = 6 files, ~848 lines","BE unit: fabric-design.service.test.ts (167 lines) = 1 file","BE integration (cross-cutting, not colocated): beam.service.test.ts, beam.mapper.test.ts, beam-receipt.service.test.ts, beam-receipt.mapper.test.ts exercise designId/colourwayId validation from the beam side","FE: no dedicated *.test.tsx found colocated under features/designs or features/fabric-designs (coverage relies on e2e)","e2e: 3 spec files, 874 lines total — design-v2.spec.ts (556, flows/), designs.spec.ts (267, masters/), fabric-designs.spec.ts (51, masters/)"]


**BE paths**
- fabtraq-be/src/modules/design/design.controller.ts (168)
- fabtraq-be/src/modules/design/design.service.ts (271)
- fabtraq-be/src/modules/design/design.service.test.ts (360)
- fabtraq-be/src/modules/design/design.repository.ts (220)
- fabtraq-be/src/modules/design/prisma-design.repository.ts (300)
- fabtraq-be/src/modules/design/design.mapper.ts (72)
- fabtraq-be/src/modules/design/design.routes.ts (71)
- fabtraq-be/src/modules/design/design.module.ts (57)
- fabtraq-be/src/modules/design/design.module.test.ts (70)
- fabtraq-be/src/modules/design/index.ts (20)
- fabtraq-be/src/modules/design/design-parse.service.ts (52)
- fabtraq-be/src/modules/design/design-parse.service.test.ts (111)
- fabtraq-be/src/modules/design/design-parse.errors.ts (99)
- fabtraq-be/src/modules/design/design-parse.errors.test.ts (83)
- fabtraq-be/src/modules/design/design-pdf.upload.ts (35)
- fabtraq-be/src/modules/design/design-pdf.upload.test.ts (72)
- fabtraq-be/src/modules/design/pdf-parser.client.ts (84)
- fabtraq-be/src/modules/design/pdf-parser.client.test.ts (152)
- fabtraq-be/src/modules/fabric-design/fabric-design.controller.ts (114)
- fabtraq-be/src/modules/fabric-design/fabric-design.service.ts (157)
- fabtraq-be/src/modules/fabric-design/fabric-design.service.test.ts (167)
- fabtraq-be/src/modules/fabric-design/fabric-design.repository.ts (116)
- fabtraq-be/src/modules/fabric-design/prisma-fabric-design.repository.ts (131)
- fabtraq-be/src/modules/fabric-design/fabric-design.mapper.ts (34)
- fabtraq-be/src/modules/fabric-design/fabric-design.routes.ts (60)
- fabtraq-be/src/modules/fabric-design/fabric-design.module.ts (36)
- fabtraq-be/src/modules/fabric-design/index.ts (14)

**FE paths**
- fabtraq-fe/src/features/designs/design-list.page.tsx (96)
- fabtraq-fe/src/features/designs/design-form.page.tsx (322)
- fabtraq-fe/src/features/designs/design-detail.page.tsx (467)
- fabtraq-fe/src/features/designs/hooks.ts (72)
- fabtraq-fe/src/features/designs/api.ts (57)
- fabtraq-fe/src/features/designs/columns.tsx (60)
- fabtraq-fe/src/features/designs/query-keys.ts (9)
- fabtraq-fe/src/features/designs/lib/unmapped-shades.ts (11)
- fabtraq-fe/src/features/designs/lib/design-form-groups.ts (112)
- fabtraq-fe/src/features/designs/lib/recipe-import.ts (140)
- fabtraq-fe/src/features/designs/components/AttributesEditSection.tsx (294)
- fabtraq-fe/src/features/designs/components/ImportRecipeDialog.tsx (674)
- fabtraq-fe/src/features/designs/components/ColourwayGrid.tsx (304)
- fabtraq-fe/src/features/designs/components/GroupsFieldArray.tsx (278)
- fabtraq-fe/src/features/fabric-designs/fabric-design-list.page.tsx (123)
- fabtraq-fe/src/features/fabric-designs/fabric-design-form.page.tsx (336)
- fabtraq-fe/src/features/fabric-designs/hooks.ts (47)
- fabtraq-fe/src/features/fabric-designs/api.ts (56)
- fabtraq-fe/src/features/fabric-designs/columns.tsx (81)
- fabtraq-fe/src/features/fabric-designs/query-keys.ts (11)

**Shared paths**
- fabtraq-shared/src/schemas/master/design.ts (338) — Design v2 (groups/colourways/shade-cells)
- fabtraq-shared/src/schemas/master/design-parse.ts (136) — PDF-parser wire contract for /designs/parse-pdf
- fabtraq-shared/src/registry/master/designs.registry.ts (95)
- fabtraq-shared/src/schemas/master/fabric-design.ts (90) — unrelated weft/fabric master
- fabtraq-shared/src/registry/master/fabric-designs.registry.ts (54)

**e2e specs**
- e2e/tests/flows/design-v2.spec.ts (556) — colourway/shade grid, PDF import, immutability, colourwayId beam validation
- e2e/tests/masters/designs.spec.ts (267)
- e2e/tests/masters/fabric-designs.spec.ts (51)

**Governing docs**
- fabtraq-shared/docs/superpowers/specs/2026-07-17-design-v2-colourways-beam-drain-design.md (also mirrored in be/fe) — locks Design v2 model: colour-ways = shade columns (D1), per-design shade→SKU map (D2), weight-ratio beam drain (D3), full sheet storage (D4), immutable recipe except shade-cell skuId (D9), no ledger changes (D10)
- fabtraq-be/docs/superpowers/plans/2026-07-17-design-v2-be.md — BE migration/implementation plan for the above (Prisma migration, colourwayId validation)
- fabtraq-fe/docs/superpowers/plans/2026-07-17-design-v2-fe.md / fabtraq-shared equivalent — FE/shared implementation plans
- fabtraq-be/docs/superpowers/specs/2026-07-08-b010-pdf-design-ingest-integration-design.md — PDF-parser proxy endpoint contract, error envelope (details.code)
- fabtraq-be/docs/superpowers/plans/2026-07-08-b010-pdf-ingest-be.md / fabtraq-fe .../2026-07-08-b010-pdf-ingest-fe.md — BE proxy + FE import dialog implementation
- fabtraq-fe/docs/superpowers/specs/2026-07-02-b010-fe-task7-composition-redesign.md — documents beam-receipt composition/design-prefill contract that consumes designs (cross-domain interface, not owned by designs)
- fabtraq-fe/docs/ui-prompts/40-screens/designs-*.md, fabric-designs-*.md — UI prompt specs for the two feature sets (visual/interaction contract only)
- fabtraq-be/docs/superpowers/specs/2026-08-12-weaving-in-design.md (WI spec) — governs fabric-design as a weft/job-worker-anatomy master consumed by weaving-in, unrelated to Design v2

**Invariants (see critic corrections)**
- fabtraq-be/src/modules/design/design.service.ts:39-41 — designs immutable after creation except a shade cell's skuId (D9), enforced via patchShadeCell only
- fabtraq-be/src/modules/design/design.service.ts:200-221 — patchShadeCell: new skuId must belong to the same quality as the cell's group (cross-entity validation against SKU master)
- fabtraq-shared/src/schemas/master/design.ts:128-198 (createDesignSchema.superRefine) — sole source of truth for create-time invariants: (1) grid completeness, (3) per-section weightKg is all-or-none, (4) shadeCells groupIndex/colourwayIndex must be in range and unique per (group,colourway) pair; service layer deliberately does not re-validate these (comment at design.service.ts:34-36)
- fabtraq-be/src/modules/beam-receipt/beam-receipt.service.ts:118-154 (validateColourways) — colourwayId set without designId on same item → 400; colourwayId must belong to the item's own designId, checked via one deduplicated repo lookup (design v2 §6.4, B3)
- fabtraq-shared/src/schemas/master/design.ts:66-67 — percentage stored verbatim, NOT gated on summing to 100 (deliberate, per spec §4, unlike weightKg all-or-none)
- fabtraq-be/src/modules/design/design-parse.errors.ts:1-14 — AppError.code is a closed union; parser-specific errors carry granular signal in details.code, not top-level code — FE must branch on details.code/httpStatus for this endpoint only
- fabtraq-be/src/modules/fabric-design/fabric-design.service.ts:24-27 — FabricDesign uses generic full-field PATCH (isActive is plain Boolean), unlike Design's separate status-patch + immutable-recipe model — the two masters follow different mutability patterns entirely

**Cross-domain deps**
- Design (v2) is read by: fabtraq-be/src/modules/beam/{beam.service.ts,beam.repository.ts,prisma-beam.repository.ts,beam.mapper.ts} and fabtraq-be/src/modules/beam-receipt/{beam-receipt.service.ts,beam-receipt.controller.ts,prisma-beam-receipt.repository.ts,beam-receipt.mapper.ts} — beam items carry designId/colourwayId as provenance + drain source (design v2 §6.4)
- Design (v2) FE consumed by: fabtraq-fe/src/features/beam-receipts/components/DesignPrefillDialog.tsx, .../map-form-to-input.ts, .../lib/copy-yarns.ts, fabtraq-fe/src/features/overview/lib/beam-drill.ts, fabtraq-fe/src/features/beams/hooks.test.tsx — beam-receipt 'design mode' prefill and overview drill-down
- Design depends outward on: SKU master (patchShadeCell validates skuId's quality via repo.findSkuQualityId), Quality master (group.qualityId), fabtraq-pdf-parser microservice (via pdf-parser.client.ts, external HTTP)
- FabricDesign is read only by: fabtraq-be/src/modules/weaving-in/{weaving-in.service.ts,weaving-in.repository.ts,prisma-weaving-in.repository.ts} and fabtraq-fe/src/features/weaving-ins/{weaving-in-detail.page.tsx,fabric-taka-register.page.tsx,components/TakaItemsGrid.tsx,map-form-to-input.ts} — completely disjoint from Design v2's consumers
- No code path imports both design and fabric-design modules together — zero shared code, shared invariants, or shared consumers between the two 'design' families

**Known debt**
- No TODO/FIXME/ponytail: comments found in design, fabric-design (BE+FE) modules or their shared schemas — grep clean
- Backlog entries reference 'design' only in unrelated contexts (endpoint-registry lint-rule comments, S6 planning docs) — no open backlog item is filed against the design or fabric-design modules specifically
- fabtraq-fe/docs/superpowers/specs/2026-07-19-nested-multi-lot-sources-design.md and beam-receipt-consolidated-pull docs note beam-receipt composition UI churn (not a designs-domain debt item, but the coupling point to watch since DesignPrefillDialog lives in beam-receipts, not designs)

### auth-audit → `auth-audit`

**Verdict:** split: keep BE `auth` (login/session/JWT, ~500 LOC across 13 files incl. tests) as its own module — it's a coherent, well-tested, security-sensitive unit with real invariants. But `audit` (BE write-only log, 4 files/321 LOC) and FE `not-found` (1 file/23 LOC, a generic 404 page unrelated to auth) do not belong bundled with it: audit is infrastructure every domain module calls into (cross-cutting, not "auth" per se — it has zero code dependency on the auth module itself), and not-found is pure routing UI with no auth/audit logic at all. An expert agent briefed on 'auth' would waste context on audit's 33 unrelated call sites and on a 23-line 404 page. Recommend three lighter agents: `auth` (BE auth/ + shared/http/auth.ts + FE features/auth + shared schemas/registry auth — the actual security-sensitive surface, ~1640 LOC), `audit-log` (BE shared/audit/ + FE features/audit stub, ~340 LOC, flag it as an unimplemented-read-path stub), and fold `not-found` into whatever "shell/routing" domain owns router.tsx and other shell pages (it has nothing domain-specific to review).

**Size:** 1963 LOC. **Tests:** "BE unit: auth.service.test.ts (179), password.service.test.ts (58), token.service.test.ts (88), shared/http/auth.test.ts (198), shared/audit/audit.service.test.ts (139) = 662 lines across 5 files, all colocated with source (no integration/*.test.ts found under modules/auth or shared/audit in this scan). FE: no auth/audit-specific *.test.tsx found in features/auth or features/audit during this pass (not explicitly searched beyond directory listing — recommend a follow-up `find -name '*.test.*'` before relying on this). e2e: 2 relevant specs (auth.setup.ts fixture, audit-log.spec.ts stub) + 2 tangential noauth smoke specs, described above."


**BE paths**
- fabtraq-be/src/modules/auth/auth.controller.ts (100)
- fabtraq-be/src/modules/auth/auth.mapper.ts (25)
- fabtraq-be/src/modules/auth/auth.module.ts (29)
- fabtraq-be/src/modules/auth/auth.repository.ts (56)
- fabtraq-be/src/modules/auth/auth.routes.ts (54)
- fabtraq-be/src/modules/auth/auth.service.ts (104)
- fabtraq-be/src/modules/auth/auth.service.test.ts (179)
- fabtraq-be/src/modules/auth/index.ts (2)
- fabtraq-be/src/modules/auth/password.service.ts (56)
- fabtraq-be/src/modules/auth/password.service.test.ts (58)
- fabtraq-be/src/modules/auth/prisma-user.repository.ts (73)
- fabtraq-be/src/modules/auth/token.service.ts (86)
- fabtraq-be/src/modules/auth/token.service.test.ts (88)
- fabtraq-be/src/shared/audit/audit.module.ts (40)
- fabtraq-be/src/shared/audit/audit.repository.ts (74)
- fabtraq-be/src/shared/audit/audit.service.ts (68)
- fabtraq-be/src/shared/audit/audit.service.test.ts (139)
- fabtraq-be/src/shared/http/auth.ts (101)
- fabtraq-be/src/shared/http/auth.test.ts (198)

**FE paths**
- fabtraq-fe/src/features/auth/api.ts (25)
- fabtraq-fe/src/features/auth/auth-context.tsx (78)
- fabtraq-fe/src/features/auth/forbidden.page.tsx (23)
- fabtraq-fe/src/features/auth/hooks.ts (47)
- fabtraq-fe/src/features/auth/login.page.tsx (112)
- fabtraq-fe/src/features/auth/query-keys.ts (3)
- fabtraq-fe/src/features/auth/require-auth.tsx (26)
- fabtraq-fe/src/features/auth/role-guard.tsx (33)
- fabtraq-fe/src/features/audit/audit.page.tsx (16, stub/read-only, no api.ts or hooks.ts in the folder)
- fabtraq-fe/src/features/not-found/not-found.page.tsx (23)

**Shared paths**
- fabtraq-shared/src/registry/auth/auth.registry.ts (30)
- fabtraq-shared/src/registry/auth/index.ts (1)
- fabtraq-shared/src/schemas/auth/login.ts (54)
- fabtraq-shared/src/schemas/auth/index.ts (1)

**e2e specs**
- e2e/tests/auth.setup.ts (26 lines) — Playwright auth fixture, logs in once and reuses storage state; shared by every other spec's project dependency, not domain-specific coverage of auth itself
- e2e/tests/audit-log.spec.ts (30 lines) — explicitly a STUB per its own header comment: asserts only that the /audit-log page shell renders the 'not yet implemented' EmptyState copy; no create→list assertion because no read endpoint exists
- e2e/tests/smoke/codes.noauth.spec.ts, e2e/tests/smoke/db.noauth.spec.ts — 'noauth' smoke specs run without the auth fixture, tangential to this domain (they test unauthenticated reachability of health/smoke endpoints, not the login flow itself)
- No e2e spec directly exercises login failure paths, logout, /auth/me, role-guard forbidden rendering, or CSRF — coverage gap.

**Governing docs**
- fabtraq-be/docs/backlog.md (mirrored byte-identical in fabtraq-fe/fabtraq-shared/e2e/root docs) — B-034 login self-loop bug (line ~1284-1286), B-046 auth token rotation debt (line ~1288-1295), B-014 UI-wide raw-UUID audit sweep COMPLETE (line ~722), audit-log-writes-not-atomic-with-domain-transaction debt note (line ~758), auth-rate-limit RATE_LIMIT_AUTH_MAX knob (line ~690-696)
- fabtraq-be/docs/backlog.md:172-221 — endpoint registry contract: TypedRequest<Def>+RegisterDeps composes requireAuth(def.auth!==false)→requireRole(...roles)→validate; OpenAPI serializes cookieAuth security scheme, omitted only for /auth/login
- fabtraq-fe/docs/ui-prompts/50-shell/auth-login.md, auth-forbidden.md, authlayout.md, auth-login-placeholder.md — UI-redesign prompts governing the login/forbidden screens (2026-08-23 shell wave, per MEMORY project_ui_redesign_shell_wave)
- fabtraq-fe/docs/ui-prompts/40-screens/audit-audit.md — UI prompt for the audit log page shell (masters+audit wave, 2026-08-23)
- No dedicated brainstorm/spec/plan doc exists for an 'auth' or 'audit' domain redesign — all auth/audit doc hits found were either the endpoint-registry contract doc (shared concern, not domain-specific) or generic word matches ('audit fields', 'auditFieldsSchema', 'unauth 403') inside unrelated feature specs; this domain has never had its own planning doc.

**Invariants (see critic corrections)**
- Uniform 'Invalid email or password.' error for both no-user and wrong-password cases, plus a constant-time bcrypt dummy-hash compare even when the user doesn't exist — prevents email enumeration and timing attacks. fabtraq-be/src/modules/auth/auth.service.ts:43,62-74
- JWT session stored ONLY as httpOnly cookie (`fabtraq_session`); shared contract deliberately excludes the token from the response body — client never reads it directly. fabtraq-shared/src/schemas/auth/login.ts:11-14; cookie set at fabtraq-be/src/modules/auth/auth.controller.ts:59-65 (sameSite:'strict', httpOnly, path:'/', maxAge from env.JWT_TTL_SECONDS)
- Double-submit CSRF: /auth/login is the ONLY `auth:false` registry endpoint and is also the only route that GENERATES the csrf token (it cannot validate one, since the user has no CSRF cookie yet). fabtraq-be/src/modules/auth/auth.routes.ts:20-24,42-44; fabtraq-shared/src/registry/auth/auth.registry.ts:9-16
- requireAuth must run before requireRole (role check assumes req.user is already populated) and before CSRF middleware for POST /logout, specifically so unauthenticated requests get 401 not 403. fabtraq-be/src/shared/http/auth.ts:80-83 (requireRole doc); fabtraq-be/src/modules/auth/auth.routes.ts:46-48
- JWT claims are validated with a type-guard against known USER_ROLES before being trusted (isJwtClaims) — malformed/foreign tokens are rejected as UnauthenticatedError, not silently coerced. fabtraq-be/src/shared/http/auth.ts:24-33,64-67
- getProfile re-checks `user.status === 'active'` on every /auth/me call, not just at login — a deactivated user's still-valid JWT is rejected. fabtraq-be/src/modules/auth/auth.service.ts:95-103
- Audit entries accept an optional Prisma transaction client so the log write can share the domain write's transaction — but this is opt-in per caller, and backlog.md notes it's NOT consistently atomic across all 33 call sites (pre-existing debt, not a guarantee). fabtraq-be/src/shared/audit/audit.repository.ts:34-37,47; fabtraq-be/docs/backlog.md:758
- IAuditRepository is write-only (`log()`), no read/list method exists anywhere in the BE — GET /audit-log is unimplemented; the FE audit page is a static stub. fabtraq-be/src/shared/audit/audit.repository.ts:39-48; fabtraq-fe/src/features/audit/audit.page.tsx:1-16
- AuditLogEntry/AuditAction types live in fabtraq-be only, deliberately NOT in fabtraq-shared, because shared types are reserved for HTTP wire DTOs and this is a server-side persistence concern. fabtraq-be/src/shared/audit/audit.repository.ts:10-13
- RoleGuard/RequireAuth both redirect anon users to `/login?from=<encoded current path>`; login.page.tsx presumably reads `from` to redirect back post-login — suspected root of B-034 (visiting /login directly self-loops). fabtraq-fe/src/features/auth/role-guard.tsx:23-26; fabtraq-fe/src/features/auth/require-auth.tsx:20-23; documented open bug fabtraq-be/docs/backlog.md:1284-1286

**Cross-domain deps**
- Every BE domain module (fabric-design, jw-challan-in/out, yarn-purchase, wastage, weaving-in, weaving-dispatch, place-stock, beam, beam-receipt, transporter, location, yarn-quality, vendor, design, job-worker — 33 files) injects TOKENS.AuditService and calls .record() after create/update/delete — audit is a hard dependency of nearly the whole BE, not an optional add-on.
- 23 BE module route files wire buildRequireAuth/requireRole from fabtraq-be/src/shared/http/auth.ts as router middleware — every protected endpoint in the app depends on this file.
- 24 FE files outside features/auth import useAuth/RequireAuth/RoleGuard (fabtraq-fe/src/app/router.tsx and per-feature route wrappers) — this is the FE authorization backbone.
- fabtraq-shared/src/registry/auth/auth.registry.ts defines the only `auth:false` endpoint (/auth/login) in the whole registry — every other endpoint.registry.ts across ~15 domains defaults to auth:true and composes with requireRole per fabtraq-be/docs/backlog.md:172-173.
- fabtraq-shared UserProfile/loginRequestSchema consumed by fabtraq-fe/src/features/auth/hooks.ts and api.ts; UserRole enum (fabtraq-shared/src/constants/role) consumed by RoleGuard and BE requireRole across all modules.
- AuditAction/AuditLogEntry types are Prisma-model-shaped and intentionally NOT in fabtraq-shared (fabtraq-be/src/shared/audit/audit.repository.ts:10-12) — audit is BE-internal, not part of the wire contract, unlike auth.

**Known debt**
- B-034 (backlog.md ~1284-1286): visiting /login directly under certain logged-out states self-loops instead of rendering the form — suspected interaction between the `?from=` preservation and login's own 'already at login' check. OPEN.
- B-046 (backlog.md ~1288-1295): fabtraq_session JWT is minted once at login and never rotated/refreshed — no sliding expiry; a leaked token stays valid for its full TTL. Scoped fix: BE auth middleware re-issue logic. OPEN, deferred to pre-Phase-1-UAT security pass.
- Audit-log write is not atomic with the domain transaction across the codebase as a pattern (backlog.md ~758) — opt-in `tx` param exists but isn't used everywhere.
- GET /audit-log (read endpoint) was never implemented — FE audit.page.tsx is a permanent EmptyState stub, confirmed current as of the e2e stub spec's own source-reading comment.
- No code-level TODO/FIXME/`ponytail:` comments found in any auth or audit source file (grep clean) — the debt lives only in backlog.md, not in-code markers.
- No e2e coverage for login-failure, logout, /auth/me, role-guard-forbidden, or CSRF flows — only a smoke-level login-once fixture and a shell-only audit stub spec exist.

### yarn-purchase → `yarn-purchase`

**Verdict:** keep — cohesive vertical slice (BE 2070 LOC + FE 2346 LOC + shared 260 LOC), single aggregate (purchase header + immutable items + placements), single e2e spec; the two FE cross-imports are just a shared picker component, not a merge signal

**Size:** 4676 LOC. **Tests:** "BE: 1 unit/integration test file, yarn-purchase.service.test.ts (680 lines) covering create/update/cancel/validateRefs paths. FE: 3 test files — PurchaseLineItemTable.test.tsx (53), PurchaseLineItemRow.test.tsx (224), QualitySkuSelect.test.tsx (260, shared picker's own tests live here). e2e: 1 spec, yarn-purchase.spec.ts (246 lines) covering the create-with-placements flow via seeded masters."


**BE paths**
- fabtraq-be/src/modules/yarn-purchase/yarn-purchase.service.ts (508)
- fabtraq-be/src/modules/yarn-purchase/yarn-purchase.service.test.ts (680)
- fabtraq-be/src/modules/yarn-purchase/prisma-yarn-purchase.repository.ts (295)
- fabtraq-be/src/modules/yarn-purchase/yarn-purchase.repository.ts (196, interface)
- fabtraq-be/src/modules/yarn-purchase/yarn-purchase.controller.ts (141)
- fabtraq-be/src/modules/yarn-purchase/yarn-purchase.routes.ts (79)
- fabtraq-be/src/modules/yarn-purchase/yarn-purchase.mapper.ts (131)
- fabtraq-be/src/modules/yarn-purchase/yarn-purchase.module.ts (38, DI wiring)
- fabtraq-be/src/modules/yarn-purchase/index.ts (2)

**FE paths**
- fabtraq-fe/src/features/yarn-purchases/yarn-purchase-form.page.tsx (507)
- fabtraq-fe/src/features/yarn-purchases/yarn-purchase-detail.page.tsx (293)
- fabtraq-fe/src/features/yarn-purchases/yarn-purchase-list.page.tsx (135)
- fabtraq-fe/src/features/yarn-purchases/columns.tsx (135)
- fabtraq-fe/src/features/yarn-purchases/hooks.ts (67)
- fabtraq-fe/src/features/yarn-purchases/api.ts (56)
- fabtraq-fe/src/features/yarn-purchases/query-keys.ts (15)
- fabtraq-fe/src/features/yarn-purchases/components/PurchaseLineItemTable.tsx (259)
- fabtraq-fe/src/features/yarn-purchases/components/PurchaseLineItemTable.test.tsx (53)
- fabtraq-fe/src/features/yarn-purchases/components/PurchaseLineItemRow.tsx (291)
- fabtraq-fe/src/features/yarn-purchases/components/PurchaseLineItemRow.test.tsx (224)
- fabtraq-fe/src/features/yarn-purchases/components/QualitySkuSelect.tsx (5, re-export shim)
- fabtraq-fe/src/features/yarn-purchases/components/QualitySkuSelect.test.tsx (260)
- fabtraq-fe/src/features/yarn-purchases/components/VendorSelect.tsx (38)
- fabtraq-fe/src/features/yarn-purchases/components/TransporterSelect.tsx (5, re-export shim)
- fabtraq-fe/src/features/yarn-purchases/components/LocationFloorSelect.tsx (3, re-export shim)

**Shared paths**
- fabtraq-shared/src/schemas/transaction/yarn-purchase.ts (186) — create/update/response/list-query schemas, item immutability comment at top
- fabtraq-shared/src/schemas/forms/yarn-purchase-item.ts (18)
- fabtraq-shared/src/registry/transaction/yarn-purchases.registry.ts (56) — 5 endpoints: list/get/create/update(PATCH header-only)/cancel, roles owner+storekeeper

**e2e specs**
- e2e/tests/flows/yarn-purchase.spec.ts (246 lines) — only spec directly named for the domain; uses seeded active vendor/quality/sku/location/floor masters, not domain-owned fixtures

**Governing docs**
- docs/backlog.md B-002 (mirrored in all 4 repos' docs/backlog.md) — server-side PDF rendering for T1 (yarn purchase print), deferred from S4, trigger = before Phase-1 UAT (S7)
- docs/backlog.md B-003 (same mirroring) — in-place line-item edit endpoint PATCH /yarn-purchases/:id/items to replace void-and-reenter MVP; deferred, would need IInventoryService.reversePurchaseItem + item-level immutability guard reusing L15 placement-edit-locking pattern
- fabtraq-fe/docs/ui-prompts/40-screens/yarn-purchases-*.md (list/detail/form + 4 component prompts) — UI-redesign prompt specs for each screen/component, executed 2026-08-23 per MEMORY project_ui_redesign_yarn_purchases.md
- docs/superpowers/plans/2026-05-08-yarn-sku-contract-alignment.md + specs/...-design.md — locks the qualityId/skuId item shape and SKU-must-belong-to-quality rule still enforced in validateRefs
- docs/plans/2026-07-27-sku-shade-*.md (shared/fe/e2e) — SKU-shade workstream that touches QualitySkuSelect used by yarn-purchase items
- docs/plans/2026-08-24-positive-quantities-*.md (shared/fe) — positiveQuantitySchema/positiveIntSchema now used for item quantity/boxes fields
- docs/brainstorms/2026-05-19-jw-domain-redesign.md — Sprint 5 'placement-centric' redesign referenced directly in the service.ts file-header comment ('Sprint 5 — placement-centric')

**Invariants (see critic corrections)**
- Items are immutable post-create: update() throws BusinessRuleError if 'items' in input, even though schema is .strict() and should already reject it (defense-in-depth) — yarn-purchase.service.ts:249-254
- Per-item lotNumbers are minted one-at-a-time via IInventoryService.mintLotNumber inside the create transaction specifically to avoid UNIQUE-constraint collisions under concurrent purchases (atomic UPDATE...RETURNING) — yarn-purchase.service.ts:117-140
- entryNo generation uses indianFinancialYearFor + repo.nextEntrySequence (per-FY atomic counter) then formatYarnPurchaseEntryNo — yarn-purchase.service.ts:112-115
- Placements can be empty at create time (pending placement, placed later via Place Stock queue) — shared/schemas/transaction/yarn-purchase.ts:66-68 comment + createYarnPurchaseItemSchema
- Cancel is blocked if any of the purchase's lots have been dispatched to JW: findDispatchedLotsByLotNumbers checked BEFORE any ledger reversal is written — yarn-purchase.service.ts:308-322
- Cancel must reverse BOTH transactionType='purchase' AND transactionType='placement' ledger rows — the latter covers bucket-to-floor moves/adjustments written later via the Place Stock queue (applyPlacementLedger/applyPlacementAdjustment) that would otherwise be missed; explicitly cited as S6 2026-07-10 design §3.4 — yarn-purchase.service.ts:324-340
- validateRefs enforces: vendor active, transporter active (if given), quality active, sku active AND sku.qualityId === item.qualityId, location active, floor active AND floor.locationId === placement.locationId — all inside the write transaction (tx) before any insert — yarn-purchase.service.ts:369-469
- Header totals (totalBoxes/totalQuantity/totalAmount) are computed in the application layer from resolved items, not via DB aggregation — consistent with the 'compute in app, not DB' project rule — yarn-purchase.service.ts:143-150
- cancelPurchase route has NO body-validation middleware (POST with no body) — noted explicitly in registry comment, yarn-purchases.registry.ts:51
- update schema (PATCH) covers header fields only: partyBillNumber, paymentRef, transporterId, deliveryMode, notes — never items

**Cross-domain deps**
- BE: yarn-purchase.service depends on IInventoryService (inventory module) for mintLotNumber, mintPlacements, applyPurchaseLedger, reverseLedger, findDispatchedLotsByLotNumbers, findPlacementLocks — all inventory bounded-context calls, none of yarn-purchase's own repo/DB access crosses into inventory tables directly
- BE: inventory.service.ts references sourceType/originType 'purchase' and 'yarn_purchase_item' when resolving stock_ledger origin (inventory.service.ts:359,365) and inventory.mapper.ts — inventory module knows about yarn-purchase as a ledger source type
- FE: QualitySkuSelect (fabtraq-fe/src/features/yarn-purchases/components/QualitySkuSelect.tsx) is imported by jw-challans-in/components/ReceivedLotsGrid.tsx and fabric-designs/fabric-design-form.page.tsx — a shared picker living in the yarn-purchases feature dir but reused outside it (candidate for promotion per L11-style shared-picker precedent, not yet moved)
- FE: router.tsx wires 4 routes (list/new/detail/edit) to yarn-purchases pages — standard app-shell integration, no special coupling
- Shared: createYarnPurchaseSchema reuses placementInputSchema/placementResponseSchema/placementStatusSchema from schemas/inventory/placement — placement domain is a hard shared dependency
- e2e: yarn-purchase.spec.ts seeds/derives vendor, yarn quality, sku, location, floor from existing DB seed rather than owning its own fixtures (violates 'e2e specs must own their fixtures' rule per MEMORY, flagged in the spec's own comment as an open TODO to lift into a shared helper)

**Known debt**
- B-002 (backlog.md) — yarn-purchase detail page (T1) print uses a window.print() stub, no server PDF; deferred from S4, trigger = before Phase-1 UAT
- B-003 (backlog.md) — no in-place item edit; void-and-reenter MVP only; deferred PATCH /yarn-purchases/:id/items design exists but unimplemented, requires IInventoryService.reversePurchaseItem (not yet on the interface)
- QualitySkuSelect/VendorSelect/TransporterSelect/LocationFloorSelect: three of the four component files under yarn-purchases/components are thin re-export shims (5, 5, 3 lines) pointing at shared/promoted components — dead weight left in this feature dir, candidate for cleanup/removal
- e2e spec's own top-of-file comment flags un-lifted fixture-resolution duplication ('E3 plan note: lift into a shared helper... rather than duplicating five queries per test') as owed work
- MEMORY project_ui_redesign_yarn_purchases.md: UI redesign wave done 2026-08-23 but live e2e re-run still owed, and uncommitted (QualitySkuSelect cmdk migration changed JW-In D2 prefill behavior, NaN-totals fix applied) — verify these landed since

### jw-challan-out → `jw-challan-out`

**Verdict:** keep — the BE module (~3190 loc incl. tests) is a coherent bounded unit with clean IInventoryService delegation and well-documented internal/public API split for the WeavingDispatch composition; FE feature (~1962 loc) is similarly scoped to one CRUD+detail+form surface with 2 components already correctly promoted to shared. Do not merge with jw-challan-in (they are deliberately separate bounded contexts joined only via IInventoryService/getOutItemRollup) or with weaving-dispatch (which composes this module rather than absorbing it). Do not split further — line-item, ledger, and placement concerns are already factored into IInventoryService.

**Size:** 5545 LOC. **Tests:** unit: jw-challan-out.service.test.ts (1210 lines, extensive coverage of create/list/getById/updateHeader/cancel/closeOutAsLoss + all guard paths) + jw-challan-out.mapper.test.ts (211 lines); weaving-dispatch.service.test.ts (825+ lines) covers the createIn/cancelIn/updateHeaderIn composition boundary from the caller side. integration: referenced in backlog as inventory-placement-ledger.service, place-stock-ledger-wiring.service, jw-challan-in-be8.routes (exercise the legacy pending/partially_placed pre-L23 path). e2e: jw-out.spec.ts (primary), out-item-conservation.spec.ts, jw-challan-visibility.spec.ts, weaving-dispatch.spec.ts, challan-pdf.spec.ts, plus indirect coverage in beams/beam-receipt/jw-in-*/party-lot-carry-forward/trace specs.


**BE paths**
- fabtraq-be/src/modules/jw-challan-out/jw-challan-out.controller.ts (181 lines)
- fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts (701 lines)
- fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.test.ts (1210 lines)
- fabtraq-be/src/modules/jw-challan-out/jw-challan-out.repository.ts (211 lines, interface)
- fabtraq-be/src/modules/jw-challan-out/prisma-jw-challan-out.repository.ts (394 lines, Prisma impl)
- fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.ts (137 lines)
- fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.test.ts (211 lines)
- fabtraq-be/src/modules/jw-challan-out/jw-challan-out.routes.ts (106 lines)
- fabtraq-be/src/modules/jw-challan-out/jw-challan-out.module.ts (37 lines)
- fabtraq-be/src/modules/jw-challan-out/index.ts (2 lines)

**FE paths**
- fabtraq-fe/src/features/jw-challans-out/jw-challan-out-list.page.tsx (196 lines)
- fabtraq-fe/src/features/jw-challans-out/jw-challan-out-detail.page.tsx (417 lines)
- fabtraq-fe/src/features/jw-challans-out/jw-challan-out-form.page.tsx (416 lines)
- fabtraq-fe/src/features/jw-challans-out/columns.tsx (141 lines)
- fabtraq-fe/src/features/jw-challans-out/hooks.ts (86 lines)
- fabtraq-fe/src/features/jw-challans-out/api.ts (72 lines)
- fabtraq-fe/src/features/jw-challans-out/query-keys.ts (15 lines)
- fabtraq-fe/src/features/jw-challans-out/components/ChallanOutLineItemRow.tsx (320 lines)
- fabtraq-fe/src/features/jw-challans-out/components/ChallanOutLineItemTable.tsx (141 lines)
- fabtraq-fe/src/features/jw-challans-out/components/CloseAsLossDialog.tsx (150 lines)
- fabtraq-fe/src/features/jw-challans-out/components/JobWorkTypeMultiSelect.tsx (3 lines, thin re-export of shared/components/JobWorkTypeMultiSelect — promoted 2026-08-22)
- fabtraq-fe/src/features/jw-challans-out/components/SourceLotPicker.tsx (5 lines, thin re-export of shared/components/SourceLotPicker — promoted 2026-08-22)

**Shared paths**
- fabtraq-shared/src/schemas/transaction/jw-challan-out.ts (324 lines) — CreateJwChallanOutInput/UpdateJwChallanOutInput/JwChallanOutResponse/CloseOutAsLoss* schemas; createJwChallanOutItemSchema carries the placement-conservation superRefine duplicated in the BE service.
- fabtraq-shared/src/schemas/transaction/eligible-out-item.ts (69 lines) — eligibleOutItemSchema + query schema for GET /jw-challans-in/eligible-out-items; describes out-items from the JW-In consumer's point of view (owned conceptually by the jw-challan-in/jw-challan-out boundary, physically filed under transaction/).

**e2e specs**
- e2e/tests/flows/jw-out.spec.ts — primary flow spec for this domain.
- e2e/tests/flows/out-item-conservation.spec.ts — B-035 consumption-union regression coverage.
- e2e/tests/flows/jw-challan-visibility.spec.ts — 2026-08-31 rollup/placementStatus visibility coverage.
- e2e/tests/flows/weaving-dispatch.spec.ts — exercises jw-challan-out via the weft half of weaving dispatch (createIn/cancelIn composition).
- e2e/tests/flows/challan-pdf.spec.ts — challan print path, touches JW-Out challan rendering.
- e2e/tests/flows/beams.spec.ts, beam-receipt.spec.ts, jw-in-source-details.spec.ts, jw-in-yarn.spec.ts, jw-in-dyed.spec.ts, party-lot-carry-forward.spec.ts, trace.spec.ts — downstream consumers of out-items that reference jwChallanOut/JWO- ids but aren't primarily this domain's spec.

**Governing docs**
- docs/superpowers/specs/2026-05-04-sprint-3-jw-challans-design.md — original Sprint 3 design that created JW-Challan-Out (T3A) + Processed Yarn In.
- docs/brainstorms/2026-05-19-jw-domain-redesign.md — L1-L23 canonical decision log; L14 defines Σ placements ≤ item.qty (amended by L23); this is the primary index of load-bearing decisions for the whole JW domain including out-challans.
- docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md — locks L23: for OUTBOUND items placements must equal netWeight exactly (no placement-pending), amending L14 which is inbound-only; origin bug JWO-2026-27-026.
- docs/plans/2026-08-20-jw-out-placement-conservation.md — implementation plan for L23 (BE + FE).
- docs/plans/2026-06-19-jw-out-lot-aggregation-floor-pull-design.md (B-009) — source-lot aggregation across floors + floor-aware pull placement for JW-Out picker.
- docs/brainstorms/2026-08-26-out-item-conservation.md (B-035, P0) — five separate hand-rolled consumption-counters found inconsistent; getOutItemRollup declared the single source of truth going forward.
- docs/plans/2026-08-26-out-item-conservation-be.md — BE plan implementing B-035 fix (route beam-receipt/JW-In/eligible-picker/close-as-loss all through getOutItemRollup).
- fabtraq-be/docs/superpowers/plans/2026-08-31-jw-challan-visibility.md + fabtraq-be/docs/superpowers/specs/2026-08-31-jw-challan-visibility-design.md — added the required `rollup` field on JwChallanOutResponse items, one placement-status vocabulary, seed-ledger fidelity.
- docs/plans/2026-08-24-positive-quantities-*.md (design/be/fe/shared/e2e) — added positive-quantity + cross-field weight guards after a zero-net-weight, zero-placement JWO-2026-27-015 row was created live.
- docs/plans/2026-07-22-sizing-jw-mixed-challan-*.md — dropped header challan_out_id, moved to per-beam provenance; sizing-JW OUT needs a warped-lot source (relevant constraint on out-item consumers, not this module directly).
- docs/backlog.md B-030/B-031/B-032/B-033/B-035 — open bugs specific to this domain (see knownDebt).

**Invariants (see critic corrections)**
- Conservation (outbound-only, L23): every item's placements must sum to exactly item.netWeight within CONSERVATION_TOLERANCE_KG=0.001 — fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts:36,563-581 (assertPlacementConservation). This amends L14 (inbound Σ≤qty, placement-pending allowed) which does NOT apply to out-items because unallocated outbound stock leaves the building with nothing recorded and the source lot still reads full balance (double-issue risk). Duplicated in the shared createJwChallanOutItemSchema superRefine for the two HTTP routes; the service-level check exists because WeavingDispatchService.create calls createIn() directly, bypassing the HTTP schema parse.
- Source-lot input-state guard: assertLotInputStates (service.ts:514-547) validates each lot's processedTypes (from the MOST RECENT stock_ledger row per lot, ordered by createdAt DESC) against isValidInputState(processedTypes, jobWorkTypes) from shared. Runs before the balance query (fail-fast). Returns the processedTypes map so applyChallanOutLedger doesn't re-query (R3 heuristic removal).
- Per-(lot, location, floor, unit) balance guard: assertLotBalances (service.ts:593-649) — WHERE in SQL, SUM in JS convention (no groupBy/$queryRaw/_sum), routed through IInventoryService.findLotLocationBalance per bounded-context rule I12a. Requested > available throws INSUFFICIENT_BALANCE_AT_FLOOR.
- Weaving boundary guard: create() (service.ts:67-71) rejects jobWorkTypes.includes('weaving') — weaving challans must go through WeavingDispatchService. The internal createIn/cancelIn/updateHeaderIn do NOT re-apply this guard (documented at service.ts:84-94, 352-358) — they exist specifically so WeavingDispatchService can compose them, bypassing the boundary by construction.
- Cancel guards: cannot cancel if already cancelled (service.ts:371-375); cannot cancel while any active (non-cancelled) JwChallanIn references the out-challan — countActiveReceipts (service.ts:377-387); cancellation is delegated to IInventoryService.reverseLedger (pure-append, no historical deletions) then repo.setStatus (service.ts:389-393).
- updateHeader immutability: cannot update a cancelled challan (service.ts:275-279); cannot update a challan managed by a weaving dispatch — must update the dispatch instead (service.ts:281-287). Only header fields are updatable (transporter, vehicle, valueOfGoods, notes) — line items are immutable post-create.
- rollup field is required, never defaulted: mapJwChallanOutRow's rollupMap param has no default (unlike lockMap which defaults to empty Map) — every call site must supply one; a missing per-item entry throws a ZodError at jwChallanOutResponseSchema.parse rather than silently reporting wrong pendingAtJW (jw-challan-out.mapper.ts:33-44, 2026-08-31 jw-challan-visibility spec).
- list() hoists getOutItemRollup ONCE for the whole page (fixed per-page cost) rather than per-row, deliberately NOT mirroring the per-row resolveLocksForOutRow pattern — service.ts:219-233.
- B-035 (out-item consumption single source of truth): getOutItemRollup is the ONLY correct union of consumedQty across JW-In sources + sizing beam receipts + weaving-in weft + write-offs; wastage is INCLUSIVE in consumedQty (out-item-conservation-be plan §3 — load-bearing, getting it backwards silently changes every balance). All other readers (beam-receipt guard, JW-In guard, eligible-out-items picker) must be repointed at it, not hand-roll their own sum.

**Cross-domain deps**
- Consumer: fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.ts composes JwChallanOutService.createIn/cancelIn/updateHeaderIn inside its own $transaction (weft half of a weaving dispatch IS a jw_challan_out row); the public create()/cancel()/updateHeader() wrappers reject jobWorkTypes=['weaving'] specifically so only WeavingDispatchService can construct one via the internal *In methods.
- Consumer: fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.ts reads jw-challan-out items as the source side of receipts (eligible-out-items picker, B-006/L2).
- Consumer: fabtraq-be/src/modules/beam-receipt/beam-receipt.service.ts consumes out-items as sizing sources; uses out-item rollup/consumption.
- Consumer: fabtraq-be/src/modules/stock-transfer/stock-transfer.service.ts touches jw-challan-out placements/lots.
- Depends on: IInventoryService (fabtraq-be/src/modules/inventory/i-inventory.service.ts, impl prisma-inventory.service.ts) for mintPlacements, applyChallanOutLedger, reverseLedger, closeOutAsLoss, getOutItemRollup, findLatestProcessedStatesByLot, findLotLocationBalance, findPlacementLocks — the service never touches Placement/StockLedger tables directly (bounded-context rule I12a).
- Shared schemas consumed: createJwChallanOutItemSchema (has its own superRefine duplicating assertPlacementConservation), isValidInputState, formatJwChallanOutNo, indianFinancialYearFor from @pashwashah04/fabtraq-shared.
- eligible-out-item.ts schema (fabtraq-shared) is consumed by jw-challan-in, not by jw-challan-out itself — it describes out-items FROM the receiver's point of view; still same bounded transaction pair.
- FE: fabtraq-fe/src/features/jw-challans-out imports promoted shared components JobWorkTypeMultiSelect and SourceLotPicker from fabtraq-fe/src/shared/components (Layer 2) — both re-exported as thin pass-throughs for back-compat.
- FE hooks/api call the BE jw-challans-out routes and also the shared eligible-out-items endpoint indirectly via jw-challans-in feature (not this feature).

**Known debt**
- B-030 (Open) — JWO-2026-27-026 was created pre-L23 with zero placements/zero ledger rows; could not be repaired in place (editPlacement 409s on jw_challan_out_item; Place Stock queue tops out at 50kg); fix is cancel-and-recreate; the row itself was destroyed by an e2e DB truncation on 2026-08-20 and survives only in a db-snapshot — moot unless that snapshot is restored.
- B-031 (Open, Low) — SourceLotPicker's onChange sets sourceLotNumber/availableFloors/clears placements but never sets items.N.unit, so the unit <Select> can diverge from the picked lot's actual denomination; BE catches it but UI allows a nonsensical intermediate state. fabtraq-fe ChallanOutLineItemRow.tsx.
- B-032 (Open, Low) — L23's two conservation guard messages wrap one word per line in the narrow Net Wt cell of the 10-column line-items table; a w-44 fix on the <td> had no effect (auto table layout). ConservationBar in the Placements column already states the same fact more legibly, so check-2's message is largely redundant.
- B-033 (Open, Low) — Totals row renders NaN for blank Bags/Gross Wt because the reducer sums undefined/NaN from valueAsNumber registrations instead of coalescing to 0. Pre-existing, not caused by L23.
- B-035 (In progress 2026-08-26, P0) — out-item consumption counted by five independent hand-rolled readers with partial views; getCumulativeConsumedByOutItems only counted JW-In sources, missing sizing beam receipts / weaving-in weft / write-offs, causing 22KG-from-10KG over-issue live in prod since 2026-08-21. Branches fix/out-item-conservation-{be,fe,e2e} off main; be plan says infra fix is to repoint readers at getOutItemRollup.
- Dead-branch-pending-removal debt: since L23, JW-Out items are always created fully_placed and never enter the Place Stock queue; several BE code paths (place-stock.service.ts queue listing + resolveSourceItemMeta challan-out cases, prisma-inventory.service.ts applyPlacementLedger dispatch legs) are now reachable only by pre-L23 rows, kept alive by 3 integration tests that seed pending rows directly via Prisma. Backlog says: remove once no pre-L23 pending/partially_placed out-items remain in any environment.

### jw-challan-in → `jw-challan-in`

**Verdict:** keep — BE (4085 LOC incl. tests, service.ts alone is 1025) and FE (3440 LOC) are each large-but-cohesive around one entity lifecycle (create/cancel of a JW-In receipt against JW-Out out-items); the module's real complexity is the shared conservation/consumption invariant, which is correctly factored to live mostly in IInventoryService rather than duplicated here — do not merge with jw-challan-in-beam (separate service/schema, separate creation path) or jw-challan-out (separate lifecycle, separate status vocabulary) even though all three share the out-item conservation invariant; instead the expert agent for this domain must also read jw-challan-in-beam.service.ts and getOutItemRollup as boundary context, since B-035/B-036 are cross-cutting bugs that live at the seam, not inside this module alone.

**Size:** 4085 LOC. **Tests:** ["BE: jw-challan-in.service.test.ts (1550 lines, unit, mocked repos/inventory) + jw-challan-in.mapper.test.ts (284 lines) — no dedicated integration test file found directly named for this module (backlog notes 3 integration tests elsewhere seed pending rows directly via Prisma for it: inventory-placement-ledger.service, place-stock-ledger-wiring.service, jw-challan-in-be8.routes — not enumerated above as they live outside modules/jw-challan-in/).", "FE: EligibleOutItemSourcePicker.test.tsx (221 lines, component-level); tests/integration/features/jw-challans-in/form.page.test.tsx referenced in backlog B-042 (flaky under coverage instrumentation) but not located under features/ itself — lives in fabtraq-fe/tests/integration/.", "shared: jw-challan-in.test.ts (614), jw-challan-in.retirement.test.ts (36), jw-challan-in-status.test.ts (15), forms/jw-challan-in-lot.test.ts (83) — 748 lines total schema-level test coverage, the heaviest test investment in the domain relative to code size.", "e2e: 4 spec files (jw-in-beam, jw-in-yarn, jw-in-source-details, jw-in-dyed) under e2e/tests/flows/ — yarn is the largest/most central flow per artifact naming (JW-challan cross-SKU sources, two-sided ledger delta, place-stock queue pending, gassed-in-stock scenarios); beam variant actually belongs to the separate jw-challan-in-beam BE module."]


**BE paths**
- fabtraq-be/src/modules/jw-challan-in/index.ts (2)
- fabtraq-be/src/modules/jw-challan-in/jw-challan-in.module.ts (49)
- fabtraq-be/src/modules/jw-challan-in/jw-challan-in.controller.ts (120)
- fabtraq-be/src/modules/jw-challan-in/jw-challan-in.routes.ts (136)
- fabtraq-be/src/modules/jw-challan-in/jw-challan-in.mapper.ts (137)
- fabtraq-be/src/modules/jw-challan-in/jw-challan-in.repository.ts (269, interface)
- fabtraq-be/src/modules/jw-challan-in/jw-challan-in.mapper.test.ts (284)
- fabtraq-be/src/modules/jw-challan-in/prisma-jw-challan-in.repository.ts (513)
- fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.ts (1025)
- fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.test.ts (1550)

**FE paths**
- fabtraq-fe/src/features/jw-challans-in/query-keys.ts (15)
- fabtraq-fe/src/features/jw-challans-in/lib/derive-agreed-sku.ts (25)
- fabtraq-fe/src/features/jw-challans-in/components/LotStateBadge.tsx (35)
- fabtraq-fe/src/features/jw-challans-in/lib/use-removal-epoch.ts (36)
- fabtraq-fe/src/features/jw-challans-in/api.ts (51)
- fabtraq-fe/src/features/jw-challans-in/components/WorkDoneChips.tsx (59)
- fabtraq-fe/src/features/jw-challans-in/hooks.ts (73)
- fabtraq-fe/src/features/jw-challans-in/jw-challan-in-list.page.tsx (85)
- fabtraq-fe/src/features/jw-challans-in/lib/remap-server-field-path.ts (91)
- fabtraq-fe/src/features/jw-challans-in/lib/derive-lot-state.ts (95)
- fabtraq-fe/src/features/jw-challans-in/components/PlaceStockSection.tsx (101)
- fabtraq-fe/src/features/jw-challans-in/columns.tsx (115)
- fabtraq-fe/src/features/jw-challans-in/lib/map-form-to-input.ts (145)
- fabtraq-fe/src/features/jw-challans-in/lib/lot-coverage.ts (153)
- fabtraq-fe/src/features/jw-challans-in/components/EligibleOutItemSourcePicker.tsx (197)
- fabtraq-fe/src/features/jw-challans-in/components/EligibleOutItemSourcePicker.test.tsx (221)
- fabtraq-fe/src/features/jw-challans-in/jw-challan-in-form.page.tsx (419)
- fabtraq-fe/src/features/jw-challans-in/components/SourcesAtJwTable.tsx (457)
- fabtraq-fe/src/features/jw-challans-in/components/ReceivedLotsGrid.tsx (522)
- fabtraq-fe/src/features/jw-challans-in/jw-challan-in-detail.page.tsx (536)
- NOTE: fabtraq-fe/src/features/jw-challans-in/components/.claude-flow/data/pending-insights.jsonl is stray tool-generated cruft, not source

**Shared paths**
- fabtraq-shared/src/schemas/transaction/jw-challan-in.ts (283) — core create/response/superRefine conservation schema, actual home of this domain's shared contract
- fabtraq-shared/src/schemas/forms/jw-challan-in-lot.ts (33) — FE-form-shaped lot schema
- fabtraq-shared/tests/schemas/transaction/jw-challan-in.test.ts (614)
- fabtraq-shared/tests/schemas/transaction/jw-challan-in.retirement.test.ts (36)
- fabtraq-shared/tests/schemas/jw-challan-in-status.test.ts (15)
- fabtraq-shared/tests/schemas/forms/jw-challan-in-lot.test.ts (83)
- ADJACENT-NOT-THIS-DOMAIN: fabtraq-shared/src/schemas/transaction/jw-challan-in-beam.ts (133) + jw-challan-in-beam.test.ts (274) is the SEPARATE beam-receipt-as-JW-in path (jw-challan-in-beam.service.ts on BE, not under the given jw-challan-in module) — flag for scope clarification, not enumerated as this domain's own file
- NOTE: given task's shared path 'schemas/transaction/jw-challan-in' does not exist as a directory; actual location is fabtraq-shared/src/schemas/transaction/jw-challan-in.ts (a file, sibling to jw-challan-in-beam.ts) plus fabtraq-shared/src/schemas/forms/jw-challan-in-lot.ts

**e2e specs**
- e2e/tests/flows/jw-in-beam.spec.ts
- e2e/tests/flows/jw-in-yarn.spec.ts
- e2e/tests/flows/jw-in-source-details.spec.ts
- e2e/tests/flows/jw-in-dyed.spec.ts

**Governing docs**
- fabtraq-be/docs/superpowers/specs/2026-08-31-jw-challan-visibility-design.md — MOST RECENT governing spec (locked 2026-08-31): out-item rollup on the wire, one placement-status vocabulary, receipt reconciliation, seed-through-real-writers; per session memory JWO/JWI-003 was arithmetically fine.
- fabtraq-be/docs/superpowers/specs/2026-08-20-party-lot-carry-forward-and-jw-in-status-design.md — locks JW-In status semantics + cancelled-parent placement guard + 125KG repair; shipped 2026-08-20.
- fabtraq-be/docs/superpowers/plans/2026-08-20-jw-in-status-and-cancelled-parent-guard.md — BE implementation plan for the above, shipped.
- docs/superpowers/specs/2026-07-23-jw-in-per-lot-sources-design.md — CANONICAL for current form shape: per-lot sources (any quality/SKU) + separated Place Stock section; review-round-2-clean.
- fabtraq-fe/docs/superpowers/plans/2026-07-23-jw-in-per-lot-sources-fe.md — FE+e2e plan operationalizing the per-lot-sources design.
- docs/superpowers/specs/2026-07-22-jw-in-consolidated-redesign-design.md — earlier consolidated-form + auto-derived processedTypes design, superseded in form-shape by the 2026-07-23 per-lot-sources spec but processedTypes derivation still governs.
- fabtraq-be/docs/superpowers/plans/2026-07-22-jw-in-derived-processed-types-be.md — BE plan: processedTypes = prior(sources) ∪ completed(completions), completed ⊆ declared, shadeNo rules.
- fabtraq-fe/docs/specs/2026-06-24-jw-in-non-dyed-multi-source-design.md — FE-only: lifted dyed-only gate so all processed types can combine multi-source (2026-06-25).
- docs/brainstorms/2026-05-19-jw-domain-redesign.md — root JW-domain brainstorm (L1-L16 locked per MEMORY); read before touching JW/Inventory/Placement code generally.
- docs/superpowers/specs/2026-05-04-sprint-3-jw-challans-design.md — original Sprint-3 design that first introduced JW Challan In (T3A).
- docs/brainstorms/2026-08-26-out-item-conservation.md — B-035/B-036 root-cause analysis for the shared consumption-authority bug that directly involves this module's conservation guard.
- fabtraq-be/docs/backlog.md and mirrors — B-035, B-036, B-044 entries below are load-bearing open defects specific to this module.

**Invariants (see critic corrections)**
- Conservation ceiling (create path): Σ(newConsumed + existing consumption from ALL consumers, cancellation-aware) ≤ outItem.netWeight + 0.001 tolerance, else throws BusinessRuleError CONSERVATION_VIOLATION — fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.ts:954-977.
- Per-lot-item conservation (shared schema, superRefine): |ΣconsumedQty − Σwastage − ΣstillAtJwQty − netWeight| ≤ 0.001 — fabtraq-shared/src/schemas/transaction/jw-challan-in.ts:171-193 (CONSERVATION_TOLERANCE_KG=0.001 at line 29).
- KNOWN-BROKEN INVARIANT (B-044, open 2026-08-27): stillAtJwQty is double-counted as consumed by BOTH the JW ledger debit (full consumedQty debited, not netted) and the conservation ceiling (jw-challan-in.service.ts:1000, no add-back of stillAtJwQty) — while getOutItemRollup's pendingAtJW formula (prisma-inventory.service.ts:888) correctly adds it back. This blocks legitimate follow-up receipts and puts stock off the ledger. No fix locked yet; operator workaround is to always enter stillAtJw=0.
- KNOWN-BROKEN INVARIANT (B-035, in progress on fix/out-item-conservation-* branches): getCumulativeConsumedByOutItems (prisma-jw-challan-in.repository.ts:491) counts ONLY JW-In sources, missing sizing-beam-receipt / weaving-in-weft / write-off consumers, so the create-path ceiling above under-counts and allows overshoot (live case: 22kg beam minted from 10kg dispatch). getOutItemRollup already computes the correct union; the fix repoints all five hand-rolled readers at it rather than building a second union.
- KNOWN-BROKEN INVARIANT (B-036, fixed alongside B-035): cancel() reverses ledger + flips status to 'cancelled' but does NOT delete JwChallanInYarnItemSource rows (jw-challan-in.service.ts:458-531); findOutWithReceipts (prisma-jw-challan-in.repository.ts:310-350) selects receipts with no status filter, so cancelled receipts' consumedQty keeps counting forever unless callers route through the (cancel-aware) getOutItemRollup instead of the hand-rolled parentMap.receipts walk.
- Cancellation is idempotency-guarded on the status column (authoritative per spec §2.4), not on ledger presence — jw-challan-in.service.ts:468-474 'CHALLAN_ALREADY_CANCELLED'.
- cancel() reverses TWO distinct ledger transactionType families — 'challan_in' AND 'placement' (the latter for later Place-Stock queue moves/adjustments that share the challan-in id as transactionId) — jw-challan-in.service.ts:476-492. Missing either reversal would leave stale ledger rows.
- getOutItemRollup is cancel-aware: it excludes source rows belonging to cancelled challan-in IDs by joining through the stock_ledger cancellation marker — this is what makes both the create-path ceiling and the parent-status recompute correct after a cancel (jw-challan-in.service.ts:504-511, :808-811).
- Parent JW-Challan-Out status derivation is a pure function of getOutItemRollup, recomputed for ALL distinct parent challanOutIds touched (not just the header link) on both create and cancel — 'fully_received' iff every out-item fullyReceived; else 'partially_received' if any consumed; else 'sent' — jw-challan-in.service.ts:759-800 (create) and :813-861 (cancel, CF-3 fix for cross-challan INs where challanOutId is null).
- No edit/update route exists — only create (:100 in routes.ts) and cancel (:115) — a mis-entered receipt can only be fixed by full cancel + re-entry (jw-challan-in.routes.ts; called out at backlog B-044).
- stock_ledger is the source of truth for physical location/quantity (standing cross-repo rule per project_b012_place_stock_ledger_sync in memory) — this module's ledger writes (applyChallanInYarnLedger, mintPlacements, writeCompletionAssociations) at jw-challan-in.service.ts:287-380 are the only mutation path into that ledger for this domain.
- Placements are minted inside the same runSerializable transaction as ledger writes and completion associations (jw-challan-in.service.ts:100-104 wraps create in runSerializable; :310 mintPlacements; :335 writeCompletionAssociations; :366 applyChallanInYarnLedger) — atomicity across DB row + ledger + placements is load-bearing.
- ReceivedLotsGrid.tsx:134-141 (FE) has two ponytail-marked simplifications: removeLot remounts every row via replace() rather than a targeted splice, and a re-pick-same-SKU effect has a known edge case — both flagged inline, not full fixes.

**Cross-domain deps**
- IInventoryService (fabtraq-be/src/modules/inventory/i-inventory.service.ts) — this service is the primary consumer: findLatestProcessedStatesByLot, findPartyLotsByLotNumbers, mintLotNumber, resolveSourceWastage, mintPlacements, writeCompletionAssociations, applyChallanInYarnLedger, reverseLedger, getOutItemRollup, getOutItemConsumption, findPlacementLocks — nearly every write and every conservation check routes through it.
- jw-challan-out module (parent side) — this service reads/writes JwChallanOut.status via outRepo.setStatus and reads parent.items for rollup; jw-challan-out's out-items are the upstream 'dispatched' side of every conservation equation here.
- jw-challan-in-beam (sibling BE service, jw-challan-in-beam.service.ts + fabtraq-shared jw-challan-in-beam.ts schema) — a SEPARATE beam-receipt-as-JW-in path outside the given task scope but consumes the SAME out-items and is one of the 'five readers' implicated in B-035's shared consumption bug; must be coordinated with, not ignored, when fixing conservation.
- Weaving-in (weft consumption) and write-offs — two more of the 'five readers' of out-item consumption per B-035, outside this module's files but sharing its out-item conservation invariant.
- prisma-inventory.service.ts:888 getOutItemRollup / pendingAtJW formula — the single authoritative aggregation this module's status derivation and (per B-035/B-036 fix direction) its own consumption checks should be fully repointed onto.
- FE: fabtraq-fe/src/features/jw-challans-out (EligibleOutItemSourcePicker sources out-items from there), fabtraq-fe/src/features/placements (Place Stock queue shares the same ledger transactionType='placement' reversed on cancel), fabtraq-fe/src/features/inventory (lot/location pickers).
- shared schemas reused: positiveQuantitySchema, quantitySchema (fabtraq-shared common numeric schemas), plus this module's own jw-challan-in.ts and forms/jw-challan-in-lot.ts.

**Known debt**
- B-035 (P0, in progress 2026-08-26 on fix/out-item-conservation-{be,fe,e2e}) — out-item consumption counted by 5 readers with partial views; getCumulativeConsumedByOutItems undercounts; fix is to repoint all readers at getOutItemRollup.
- B-036 (in progress alongside B-035) — cancelled JW-In receipts still consume their out-item because findOutWithReceipts has no status filter and cancel() doesn't delete source rows.
- B-044 (open 2026-08-27, High) — stillAtJwQty double-counted as consumed by both ledger debit and conservation ceiling; no UI edit path to recover a mis-entered row; fix direction not locked, deliberately deferred to land with B-035 (same root cause).
- ReceivedLotsGrid.tsx:134,139 — two inline ponytail: comments (remount-on-remove via replace(); re-pick-same-SKU edge case) marking known simplification ceilings, not bugs but debt to watch.
- docs/backlog.md:546 — historical 'Invalid date' submit bug tied to z.string().date() vs form format (status unclear from this pass, worth re-checking if touching date fields).
- e2e-artifacts/2026-08-23-full-run-post-ui-redesign test-result directories under e2e/ reference jw-in-* specs — 'live e2e re-run owed' is a recurring theme across nearly every 2026-08-22/23 UI-redesign memory entry for jw-challans-in; treat current e2e green status as stale until re-verified live.

### inventory → `inventory`

**Verdict:** split: keep inventory+place-stock+stock-transfer+overview as the core "inventory" expert module (they share the IInventoryService write-boundary and position-custody rules that must be read together), but carve lineage and wastage into a separate "provenance/reporting" expert module — they are read-only downstream consumers of the ledger (no IInventoryService dependency, no shared invariant with placement/ledger-write code), have their own governing design docs already forming a coherent unit, and bundling them just inflates one agent's context (10,909+2,463+631+310 = 14,313 core LOC vs 2,482+820=3,302 LOC of lineage+wastage that a reviewer of ledger-write correctness doesn't need to hold in head).

**Size:** 21606 LOC. **Tests:** BE: 22 test files across inventory (9 files ~4400 lines: bounded-context, ledger-writers, out-item-consumption x2, aggregated x2, summary, mapper, repository, position-custody, placement-invariant, characterization), place-stock (4 files, 1181 lines, but place-stock.service.ts itself has NO unit-test file per backlog.md — integration-only coverage), stock-transfer (0 dedicated test files found — check integration suite), overview (1 file, 141 lines), lineage (2 files, 910 lines), wastage (1 file, 199 lines). FE: placements has 2 test files (stale-placement, CurrentFloorsPanel), stock-transfers has 1 (TransferSourcePicker), overview has 5 (drill-url, hub-params, yarn-drill, beam-drill, StackedBar, PipelineBand), trace has 2 (lineage-layout 474 lines, LineageTree 286 lines), reports has 1 (hooks.test.tsx). e2e: 8 flow specs (inventory, inventory-hub, inventory-chart, placement, place-stock-transfer-sync, stock-transfer, trace, wastage-report).


**BE paths**
- fabtraq-be/src/modules/inventory/i-inventory.service.ts (797)
- fabtraq-be/src/modules/inventory/inventory.service.ts (417)
- fabtraq-be/src/modules/inventory/prisma-inventory.service.ts (2308)
- fabtraq-be/src/modules/inventory/inventory.repository.ts (223)
- fabtraq-be/src/modules/inventory/prisma-inventory.repository.ts (495)
- fabtraq-be/src/modules/inventory/inventory.mapper.ts (156)
- fabtraq-be/src/modules/inventory/inventory.controller.ts (122)
- fabtraq-be/src/modules/inventory/inventory.routes.ts (58)
- fabtraq-be/src/modules/inventory/inventory.module.ts (26)
- fabtraq-be/src/modules/inventory/inventory-summary.helpers.ts (159)
- fabtraq-be/src/modules/inventory/position-custody.ts (32)
- fabtraq-be/src/modules/inventory/index.ts (2)
- fabtraq-be/src/modules/inventory/*.test.ts (9 files, ~4400 lines total: inventory.service.test, prisma-inventory.service.test, prisma-inventory.repository.test, inventory-bounded-context.test, ledger-writers.test, inventory-summary.service.test, inventory-aggregated.service.test, inventory-aggregated-extended.service.test, out-item-consumption*.test, out-item-consuming-relations.test, get-out-item-rollup.characterization.test, placement-invariant.test, position-custody.test, inventory.mapper.test)
- fabtraq-be/src/modules/place-stock/place-stock.service.ts (1100)
- fabtraq-be/src/modules/place-stock/place-stock.routes.ts (165)
- fabtraq-be/src/modules/place-stock/place-stock.module.ts (17)
- fabtraq-be/src/modules/place-stock/*.test.ts (query/ledger/guards/service, ~1181 lines; NOTE: place-stock.service.ts itself has no dedicated unit-test file per backlog.md L654-665 — covered only by integration suites)
- fabtraq-be/src/modules/stock-transfer/stock-transfer.service.ts (182)
- fabtraq-be/src/modules/stock-transfer/stock-transfer.controller.ts (78)
- fabtraq-be/src/modules/stock-transfer/stock-transfer.repository.ts (93)
- fabtraq-be/src/modules/stock-transfer/prisma-stock-transfer.repository.ts (147)
- fabtraq-be/src/modules/stock-transfer/stock-transfer.mapper.ts (49)
- fabtraq-be/src/modules/stock-transfer/stock-transfer.routes.ts (54)
- fabtraq-be/src/modules/stock-transfer/stock-transfer.module.ts (28)
- fabtraq-be/src/modules/overview/overview.service.ts (91)
- fabtraq-be/src/modules/overview/overview.controller.ts (16)
- fabtraq-be/src/modules/overview/overview.routes.ts (45)
- fabtraq-be/src/modules/overview/overview.module.ts (17)
- fabtraq-be/src/modules/overview/overview.service.test.ts (141)
- fabtraq-be/src/modules/lineage/lineage.service.ts (410)
- fabtraq-be/src/modules/lineage/lineage.repository.ts (193)
- fabtraq-be/src/modules/lineage/prisma-lineage.repository.ts (311)
- fabtraq-be/src/modules/lineage/lineage.helpers.ts (401)
- fabtraq-be/src/modules/lineage/lineage.completion.ts (167)
- fabtraq-be/src/modules/lineage/lineage.controller.ts (25)
- fabtraq-be/src/modules/lineage/lineage.routes.ts (46)
- fabtraq-be/src/modules/lineage/lineage.module.ts (19)
- fabtraq-be/src/modules/lineage/lineage.service.test.ts + lineage.helpers.test.ts (910)
- fabtraq-be/src/modules/wastage/wastage.service.ts (234)
- fabtraq-be/src/modules/wastage/wastage.repository.ts (82)
- fabtraq-be/src/modules/wastage/prisma-wastage.repository.ts (191)
- fabtraq-be/src/modules/wastage/wastage.controller.ts (41)
- fabtraq-be/src/modules/wastage/wastage.routes.ts (56)
- fabtraq-be/src/modules/wastage/wastage.module.ts (17)
- fabtraq-be/src/modules/wastage/wastage.service.test.ts (199)

**FE paths**
- fabtraq-fe/src/features/inventory/inventory-lots.page.tsx (363)
- fabtraq-fe/src/features/inventory/inventory-positions.page.tsx (306)
- fabtraq-fe/src/features/inventory/columns.tsx (386)
- fabtraq-fe/src/features/inventory/hooks.ts (47)
- fabtraq-fe/src/features/inventory/api.ts (47)
- fabtraq-fe/src/features/inventory/query-keys.ts (15)
- fabtraq-fe/src/features/inventory/lib/custody.ts (34)
- fabtraq-fe/src/features/inventory/lib/placement-status.tsx (35)
- fabtraq-fe/src/features/inventory/lib/positions-url.ts (132)
- fabtraq-fe/src/features/inventory/lib/lot-labels.ts (71)
- fabtraq-fe/src/features/inventory/components/InventoryLotSelect.tsx (123)
- fabtraq-fe/src/features/placements/place-stock-editor.page.tsx (560)
- fabtraq-fe/src/features/placements/place-stock-queue.page.tsx (159)
- fabtraq-fe/src/features/placements/columns.tsx (109)
- fabtraq-fe/src/features/placements/hooks.ts (57)
- fabtraq-fe/src/features/placements/api.ts (42)
- fabtraq-fe/src/features/placements/query-keys.ts (7)
- fabtraq-fe/src/features/placements/lib/stale-placement.ts (25) + .test.ts (69)
- fabtraq-fe/src/features/placements/components/CurrentFloorsPanel.tsx (67) + .test.tsx (55)
- fabtraq-fe/src/features/stock-transfers/stock-transfer-form.page.tsx (510)
- fabtraq-fe/src/features/stock-transfers/stock-transfer-list.page.tsx (90)
- fabtraq-fe/src/features/stock-transfers/columns.tsx (71)
- fabtraq-fe/src/features/stock-transfers/hooks.ts (27)
- fabtraq-fe/src/features/stock-transfers/api.ts (27)
- fabtraq-fe/src/features/stock-transfers/query-keys.ts (9)
- fabtraq-fe/src/features/stock-transfers/components/TransferSourcePicker.tsx (62) + .test.tsx (123)
- fabtraq-fe/src/features/overview/inventory-hub.page.tsx (451)
- fabtraq-fe/src/features/overview/hooks.ts (25)
- fabtraq-fe/src/features/overview/api.ts (16)
- fabtraq-fe/src/features/overview/query-keys.ts (7)
- fabtraq-fe/src/features/overview/lib/{beam-drill,yarn-drill,hub-params,drill-url}.ts + tests (~1200)
- fabtraq-fe/src/features/overview/components/{StackedBar,PipelineBand,DrillBreadcrumb}.tsx + tests (~650)
- fabtraq-fe/src/features/trace/trace.page.tsx (88)
- fabtraq-fe/src/features/trace/lot-detail.page.tsx (133)
- fabtraq-fe/src/features/trace/hooks.ts (18) / api.ts (8) / query-keys.ts (4)
- fabtraq-fe/src/features/trace/lib/lineage-layout.ts (597) + .test.ts (474)
- fabtraq-fe/src/features/trace/components/LineageTree.tsx (391) + .test.tsx (286)
- fabtraq-fe/src/features/trace/components/LineageNodeCard.tsx (88)
- fabtraq-fe/src/features/reports/wastage-report.page.tsx (328)
- fabtraq-fe/src/features/reports/hooks.ts (34) + .test.tsx (96)
- fabtraq-fe/src/features/reports/api.ts (25) / query-keys.ts (7)
- fabtraq-fe/src/features/reports/lib/process-label.ts (9)
- fabtraq-fe/src/features/reports/components/ThresholdsEditor.tsx (134)

**Shared paths**
- fabtraq-shared/src/schemas/inventory/index.ts (284)
- fabtraq-shared/src/schemas/inventory/placement.ts (158)
- fabtraq-shared/src/schemas/inventory/wastage.ts (136)
- fabtraq-shared/src/schemas/inventory/lot-lineage.ts (110)
- fabtraq-shared/src/schemas/overview/index.ts (80)
- fabtraq-shared/src/schemas/transaction/stock-transfer.ts (114)
- fabtraq-shared/src/registry/inventory/inventory.registry.ts (93)
- fabtraq-shared/src/registry/inventory/lot-lineage.registry.ts (20)
- fabtraq-shared/src/registry/overview/overview.registry.ts (16)
- fabtraq-shared/src/registry/transaction/stock-transfers.registry.ts (38)
- fabtraq-shared/src/constants/wastage.ts (6)

**e2e specs**
- e2e/tests/flows/inventory.spec.ts
- e2e/tests/flows/inventory-hub.spec.ts
- e2e/tests/flows/inventory-chart.spec.ts
- e2e/tests/flows/placement.spec.ts
- e2e/tests/flows/place-stock-transfer-sync.spec.ts
- e2e/tests/flows/stock-transfer.spec.ts
- e2e/tests/flows/trace.spec.ts
- e2e/tests/flows/wastage-report.spec.ts

**Governing docs**
- fabtraq-be/docs/superpowers/specs/2026-07-13-place-stock-ledger-sync-design.md — LOCKS: stock_ledger is the single source of truth for current location; placements table is a put-away event record, not a location cache (B-012).
- fabtraq-be/docs/superpowers/specs/2026-07-10-unplaced-stock-visibility-design.md — LOCKS: awaiting-placement bucket + the place-stock silent-ledger fix (mintPlacements must always run, even for zero-placement rows).
- fabtraq-be/docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md — LOCKS: JW-Out out-item conservation (Σ placements === netWeight) via zod superRefine in shared jw-challan-out.ts, closing the unplaced over-issue bug.
- fabtraq-be/docs/superpowers/specs/2026-08-24-positive-quantities-design.md — LOCKS: positive-quantity guards across the material-flow schemas (positiveQuantitySchema).
- fabtraq-be/docs/superpowers/specs/2026-08-23-inventory-rewoven-design.md + brainstorms/2026-08-23-inventory-rewoven.md — LOCKS/PROPOSES: lineage/overview/wastage IA redesign; per MEMORY this is a brainstorm awaiting owner picks, not fully executed — treat as pending, not settled.
- fabtraq-be/docs/brainstorms/2026-05-19-jw-domain-redesign.md — LOCKS L1-L16 foundational JW/Inventory/Placement rules (e.g. position-custody, ledger semantics); MEMORY says always read before touching JW/Inventory/Placement code.
- ./docs/superpowers/specs/2026-07-22-stock-balance-overview-design.md (B-015) — LOCKS: overview/positions split, custody rule (located rows are floor positions, normalize jobWorkerId in ledger reads) — matches position-custody.ts implementation found in code.
- fabtraq-be/docs/plans/2026-06-19-jw-out-lot-aggregation-floor-pull-design.md (B-009) — LOCKS: GET /inventory/lots/aggregated (one row per lotNumber, repo/service split) + floor-aware pull placement.
- fabtraq-be/docs/plans/2026-07-08-stock-transfer-position-picker-design.md (+ -be/-fe plans) — LOCKS: floor-scoped position picker replacing free-text lot field on Stock Transfer form; INSUFFICIENT_BALANCE_AT_FLOOR guard.
- fabtraq-be/docs/inventory-query-plans.md — engineering notes on inventory read-query shapes/perf; check before changing list/listLots/aggregated query plans.
- fabtraq-be/docs/backlog.md — B-008 (SKU picker, CLOSED-superseded), B-009 (lot aggregation, shipped), B-011-area coverage-gap note (place-stock.service.ts untested + IInventoryService bypass debt), B-012 (place-stock/ledger sync, COMPLETE), B-015 (Stock Balance overview redesign).

**Invariants (see critic corrections)**
- Position-custody normalization: a stock_ledger row with locationId set IS a floor position; jobWorkerId only participates in position grouping when locationId is null. Every read-side accumulation (fetchPositions, /inventory, /inventory/summary, /inventory/lots, /inventory/lots/aggregated) MUST route through positionCustodyJobWorker() — fabtraq-be/src/modules/inventory/position-custody.ts:24-31. Violating this overstates in-house balances by everything ever dispatched from that floor (found live during B-015, e.g. 250kg purchase read back as 250kg instead of 110kg after 60+80kg challan-out debits).
- Challan-out placements are immutable once ledgered — every jw_challan_out_item placement is ledgered the instant it's created (addPlacements always calls applyPlacementLedger), so editPlacement throws ConflictError for sourceType==='jw_challan_out_item'; the only fix path is cancel-and-recreate the JW-Out challan. fabtraq-be/src/modules/place-stock/place-stock.service.ts:560-573.
- stock_ledger is the single source of truth for current location; the placements table is a put-away event record, not a location cache — a Stock Transfer moves stock purely via stock_ledger, leaving the original placement row pointing at its now-stale floor. fabtraq-be/src/modules/place-stock/place-stock.service.ts:667-669 (design: fabtraq-be/docs/superpowers/specs/2026-07-13-place-stock-ledger-sync-design.md).
- Ledger-balance guard on placement edit (design §3 item 6): editPlacement rejects when removing the old leg and adding the new one would drive the old floor's real on-hand balance negative beyond TOLERANCE, forcing use of a Stock Transfer instead — fabtraq-be/src/modules/place-stock/place-stock.service.ts:667-693 (INSUFFICIENT_BALANCE_AT_FLOOR).
- Outbound conservation: Σ placements must equal netWeight for a JW-Out out-item, enforced by a zod .superRefine() in the shared schema (CONSERVATION_TOLERANCE_KG), not in BE service code — fabtraq-shared/src/schemas/transaction/jw-challan-out.ts:58,84-90. This closed the JW-Out unplaced over-issue bug (2026-08-20).
- Gross ≥ net weight guard, same superRefine block — fabtraq-shared/src/schemas/transaction/jw-challan-out.ts:105-110.
- mintPlacements must run unconditionally, even producing zero placements, or placement status silently stays at the Prisma fully_placed default and the item is hidden from Place Stock — fabtraq-be/src/modules/place-stock/place-stock.service.ts:376-377 comment references the E2E #3 silent-ledger gap this closes.
- Cancelled source document guard: place-stock addPlacements/editPlacement both throw BusinessRuleError 'Cannot place stock: the source document is cancelled.' before writing — fabtraq-be/src/modules/place-stock/place-stock.service.ts:394 and :589.
- IInventoryService is the intended write-boundary for all ledger mutation across modules (jw-challan-in/out, weaving-in, beam-receipt, yarn-purchase, stock-transfer, place-stock all depend on TOKENS.IInventoryService) — but place-stock.service.ts still has 8 direct tx.placement.*/tx.stockLedger.* calls that bypass it, a known unresolved violation of its own bounded-context header (backlog.md, 'Bonus finding' entry near L661-665).

**Cross-domain deps**
- overview.service.ts imports InventoryService and WeavingInService and IBeamRepository directly — overview is a read-side aggregator over inventory+beam+weaving, not a peer.
- jw-challan-in, jw-challan-out, weaving-in, beam-receipt, yarn-purchase, stock-transfer, place-stock ALL depend on IInventoryService (TOKENS.IInventoryService) for ledger writes/reads — inventory is the shared write-boundary for the whole material-flow domain, not an isolated module.
- place-stock.service.ts still has 8 direct tx.placement.*/tx.stockLedger.* touchpoints that bypass IInventoryService, contradicting its own bounded-context header comment (backlog.md B-011-area note, ~L661-665) — pre-existing debt, not routed through the shared boundary yet.
- lineage and wastage read from stock_ledger/placement history built by inventory+place-stock but are structurally separate services (their own repos, no IInventoryService dependency found) — read-only downstream consumers of the ledger, not part of the write boundary.
- FE: placements feature (place-stock-editor/queue pages) is the UI for BE place-stock module; stock-transfers FE mirrors BE stock-transfer; trace FE consumes lineage; reports FE (wastage-report.page.tsx) consumes BE wastage; overview FE (inventory-hub.page.tsx) consumes BE overview.
- shared/schemas/inventory (placement.ts, wastage.ts, lot-lineage.ts) and shared/schemas/overview and shared/schemas/transaction/stock-transfer.ts are the wire contracts; shared/registry/inventory + registry/overview + registry/transaction/stock-transfers.registry.ts wire them into the endpoint registry (B-004 schema-first infra).

**Known debt**
- backlog.md (fabtraq-be, ~L654-666): place-stock.service.ts has no dedicated unit-test file (v8 coverage without all:true doesn't even list it); covered only by integration suites (place-stock-be10, place-stock-ledger-wiring). Also has 8 pre-existing direct tx.placement.*/tx.stockLedger.* touchpoints contradicting its own IInventoryService bounded-context rule — flagged 'refactor when next touching the file', not done.
- backlog.md B-008: CLOSED-superseded (stock-transfer SKU picker) — resolved, listed for history only.
- MEMORY project_inventory_rewoven_brainstorm: lineage/overview/wastage redesign plan published as an artifact 2026-08-23; stock_ledger origin-columns claim proven stale; still awaiting owner decisions (IA A/B, treatment 1/2/3, weft reversal) — not yet executed, do not assume it's shipped.
- No TODO/FIXME/ponytail: comments found via grep in BE inventory/place-stock/stock-transfer/overview/lineage/wastage modules or FE inventory/placements/stock-transfers/overview/trace/reports features — debt lives in backlog.md prose, not inline markers.

### beams → `beams`

**Verdict:** keep — beam (register/state-machine) and beam-receipt (inward transaction + ledger drain + cancel) are two BE modules and two FE features but form one cohesive domain: BeamReceipt is the only writer of Beam rows, beam-receipt.service.ts owns both, and nearly every open backlog item (B-037..B-041) and every governing doc treats them as a single 'beam register' concept. Splitting would separate a state machine from its sole producer. Size (~9.9k LOC incl. tests, ~4.3k BE + 4.7k FE + 0.8k shared source) is large but proportionate to a genuinely complex domain (3 inward paths, ledger conservation, cancellation reversal, colour-way composition) — an expert agent needs all of it in view simultaneously to avoid the exact class of bug (B-035, B-037, B-038) this domain has repeatedly produced. Do not fold jw-challan-in-beam.ts (legacy/dead schema) into scope; flag it for removal instead.

**Size:** 9912 LOC. **Tests:** ["BE unit: fabtraq-be/src/modules/beam/beam.mapper.test.ts (76 loc), beam.service.test.ts (294 loc), fabtraq-be/src/modules/beam-receipt/beam-receipt.mapper.test.ts (174 loc), beam-receipt.service.test.ts (961 loc, largest file in domain).","FE unit/integration: fabtraq-fe/src/features/beams/hooks.test.tsx (129 loc); no dedicated test file found under beam-receipts/ (relies on tests/integration/features/beam-receipts/form.page.test.tsx per backlog B-042 reference — outside the features/ tree, likely fabtraq-fe/tests/integration/).","e2e (Playwright): e2e/tests/flows/beams.spec.ts, beams-grouped.spec.ts, beam-receipt.spec.ts, jw-in-beam.spec.ts — 4 spec files.","Legacy/possibly-stale integration reference from backlog: fabtraq-be tests/integration/jw-challan-in-beam.routes.test.ts (unskipped in S5, covers old jw-challans-in-beam path) — verify still relevant vs superseded by beam-receipt module."]


**BE paths**
- fabtraq-be/src/modules/beam/index.ts (2)
- fabtraq-be/src/modules/beam/beam.module.ts (36)
- fabtraq-be/src/modules/beam/beam.mapper.ts (74)
- fabtraq-be/src/modules/beam/beam.mapper.test.ts (76)
- fabtraq-be/src/modules/beam/beam.routes.ts (83)
- fabtraq-be/src/modules/beam/beam.controller.ts (98)
- fabtraq-be/src/modules/beam/beam.repository.ts (157)
- fabtraq-be/src/modules/beam/prisma-beam.repository.ts (257)
- fabtraq-be/src/modules/beam/beam.service.ts (253)
- fabtraq-be/src/modules/beam/beam.service.test.ts (294)
- fabtraq-be/src/modules/beam-receipt/index.ts (12)
- fabtraq-be/src/modules/beam-receipt/beam-receipt.module.ts (54)
- fabtraq-be/src/modules/beam-receipt/beam-receipt.routes.ts (68)
- fabtraq-be/src/modules/beam-receipt/beam-receipt.mapper.ts (98)
- fabtraq-be/src/modules/beam-receipt/beam-receipt.mapper.test.ts (174)
- fabtraq-be/src/modules/beam-receipt/beam-receipt.repository.ts (238)
- fabtraq-be/src/modules/beam-receipt/prisma-beam-receipt.repository.ts (239)
- fabtraq-be/src/modules/beam-receipt/beam-receipt.controller.ts (300)
- fabtraq-be/src/modules/beam-receipt/beam-receipt.service.ts (888)
- fabtraq-be/src/modules/beam-receipt/beam-receipt.service.test.ts (961)
- fabtraq-be/prisma/schema.prisma:607 (BeamReceipt), :624 (BeamReceiptItem), :684 (Beam)

**FE paths**
- fabtraq-fe/src/features/beams/lib/remaining-meters.ts (11)
- fabtraq-fe/src/features/beams/query-keys.ts (11)
- fabtraq-fe/src/features/beams/lib/sourced-from.ts (19)
- fabtraq-fe/src/features/beams/api.ts (22)
- fabtraq-fe/src/features/beams/hooks.ts (47)
- fabtraq-fe/src/features/beams/hooks.test.tsx (129)
- fabtraq-fe/src/features/beams/beam-list.page.tsx (116)
- fabtraq-fe/src/features/beams/columns.tsx (118)
- fabtraq-fe/src/features/beams/beam-detail.page.tsx (356)
- fabtraq-fe/src/features/beam-receipts/query-keys.ts (12)
- fabtraq-fe/src/features/beam-receipts/lib/get-field-error.ts (15)
- fabtraq-fe/src/features/beam-receipts/lib/copy-yarns.ts (27)
- fabtraq-fe/src/features/beam-receipts/api.ts (46)
- fabtraq-fe/src/features/beam-receipts/beam-receipt-list.page.tsx (50)
- fabtraq-fe/src/features/beam-receipts/components/CompositionSourcePicker.tsx (57)
- fabtraq-fe/src/features/beam-receipts/hooks.ts (65)
- fabtraq-fe/src/features/beam-receipts/columns.tsx (72)
- fabtraq-fe/src/features/beam-receipts/lib/allocate-pulls.ts (103)
- fabtraq-fe/src/features/beam-receipts/lib/yarn-key.ts (107)
- fabtraq-fe/src/features/beam-receipts/components/CopyToAllPopover.tsx (142)
- fabtraq-fe/src/features/beam-receipts/components/EligibleOutItemPicker.tsx (158)
- fabtraq-fe/src/features/beam-receipts/components/AllocationPreview.tsx (191)
- fabtraq-fe/src/features/beam-receipts/map-form-to-input.ts (225)
- fabtraq-fe/src/features/beam-receipts/beam-receipt-detail.page.tsx (318)
- fabtraq-fe/src/features/beam-receipts/components/BeamYarnsTable.tsx (328)
- fabtraq-fe/src/features/beam-receipts/components/DesignPrefillDialog.tsx (362)
- fabtraq-fe/src/features/beam-receipts/beam-receipt-form.page.tsx (464)
- fabtraq-fe/src/features/beam-receipts/components/BeamItemsGrid.tsx (558)
- fabtraq-fe/src/features/beam-receipts/components/StockPullTable.tsx (600)

**Shared paths**
- fabtraq-shared/src/schemas/beam.ts (191)
- fabtraq-shared/src/schemas/transaction/beam-receipt.ts (333)
- fabtraq-shared/src/schemas/transaction/jw-challan-in-beam.ts (133, legacy/dead per B-005 note)
- fabtraq-shared/src/schemas/forms/beam-receipt-yarn.ts (33)
- fabtraq-shared/src/registry/inventory/beams.registry.ts (69) — listBeams, getBeamById, closeBeam, reopenBeam, listBeamsGrouped
- fabtraq-shared/src/registry/transaction/beam-receipts.registry.ts (62)

**e2e specs**
- e2e/tests/flows/beams.spec.ts
- e2e/tests/flows/beams-grouped.spec.ts
- e2e/tests/flows/beam-receipt.spec.ts
- e2e/tests/flows/jw-in-beam.spec.ts (adjacent — jw-challan-in beam-related, not pure beam-receipt path)

**Governing docs**
- docs/brainstorms/2026-06-24-beam-register-redesign.md — origin brainstorm for Beam Register v2 (B-010): locks BR-L1..L7 core model, dedicated BeamReceipt header, mix-qualities allowed, designs immutable.
- docs/superpowers/specs/2026-06-24-beam-register-v2-design.md — full design spec for B-010 (3 inward paths: purchase/in_house/sizing_jw; ends/reed; composition; §9 PDF-ingest stubbed).
- docs/superpowers/specs/2026-07-17-design-v2-colourways-beam-drain-design.md — full-sheet storage, colour-ways, shade→SKU mapping, weight-based beam drain; supersedes flat recipe design.
- docs/superpowers/specs/2026-07-23-jw-in-per-lot-sources-design.md — per-lot sources + separated placement for JW-In, touches beam sourcing inputs.
- docs/superpowers/specs/2026-07-30-beam-detail-page-design.md + docs/plans/2026-07-30-beam-detail.md — beam detail page from register: clickable rows, full attributes, receipt provenance.
- docs/brainstorms/2026-08-26-beam-cancel-gaps.md + docs/plans/2026-08-26-beam-cancel-gaps-{be,fe,shared,e2e}.md — B-037/B-038/B-039: beam-number reuse on cancel, invisible/dead cancellation guard, transporter picker.
- docs/brainstorms/2026-08-26-out-item-conservation.md + docs/plans/2026-08-26-out-item-conservation-{be,fe,e2e}.md — B-035 P0: out-item conservation single-source-of-truth, directly governs beam-receipt sizing-JW drain correctness.
- docs/superpowers/specs/2026-08-31-jw-challan-visibility-design.md — out-item rollup on the wire; touches recomputeOutChallanStatus used by beam-receipt create/cancel.
- docs/backlog.md — B-005 (superseded by B-010), B-010, B-018, B-037..B-041 (all open/in-progress beam-specific defects), B-042/B-043 (adjacent test-infra debt touching beam-receipt form tests).

**Invariants (see critic corrections)**
- Beam-number uniqueness enforced app-side over live (non-cancelled) beams only, not DB constraint — fabtraq-be/src/modules/beam-receipt/beam-receipt.service.ts:169-201 (assertBeamNumbersFree); DB @unique deliberately dropped (B-037) because cancelled receipts must release numbers for reuse and Prisma can't express a partial unique index.
- Orphan-item detection: a BeamReceiptItem with beamNumber set but no linked Beam row still occupies that number (observed true in seed 2026-08-26) — second query in assertBeamNumbersFree, beam-receipt.service.ts:188-198.
- Single predicate for 'is this receipt cancelled': isBeamReceiptCancelled(row) = every item's beam.status==='cancelled' AND items.length>0 — fabtraq-be/src/modules/beam-receipt/beam-receipt.mapper.ts:31-32. Same function backs both the response DTO's `cancelled` field (mapper.ts:43) and the service's already-cancelled guard (beam-receipt.service.ts:756), so they cannot disagree (fixed B-038).
- cancel() uses TWO guards, not one: isBeamReceiptCancelled(receipt) OR an existing stock_ledger row {transactionType:'beam_receipt', transactionId:id, notes:'cancellation'} — beam-receipt.service.ts:752-757. The ledger check exists because an orphaned item (no Beam row) pins isBeamReceiptCancelled to false permanently, and reverseLedger is NOT idempotent (re-reads every forward row each call) — a second cancel on such a receipt would double the reversal (B-013 class bug).
- On cancel, each linked Beam row is set status='cancelled' AND locationId/floorId cleared (fix #5) — beam-receipt.service.ts:760-771 — otherwise a cancelled beam still appears 'located' in inventory reads.
- Sizing-JW beam receipt drains the at-JW ledger position via applyBeamReceiptSizingLedger (NOT applyChallanInBeamLedger) so the ledger row is tagged transactionType='beam_receipt' — beam-receipt.service.ts:664-690 — this tag is exactly what the cancel-guard's ledger check and reverseLedger key on.
- jobWorkerId for the ledger drain comes from the OUT item's OWN challan, not a single header challan — beam-receipt.service.ts:679-681 (M1 fix, beam receipts may span multiple OUT challans).
- Cannot create a beam receipt item against a cancelled challan-out — beam-receipt.service.ts:550-553.
- challanOut status rollup (sent/partially_received/fully_received) is recomputed via inventory.getOutItemRollup after both create and cancel, for every distinct challan referenced by the receipt's items, sorted for deterministic serializable-retry — beam-receipt.service.ts:855-887 (recomputeOutChallanStatus), called at :718-721 (create) and :788-793 (cancel).
- Beam.status lifecycle is a 3-state machine received -> issued_to_weaver -> fabric_received (plus terminal cancelled reachable only via receipt cancel) — beam.service.ts close()/reopen()/transition() :202-249; close is owner+storekeeper, reopen is owner-only (enforced by registry roles, not service code).
- Beam register statusCounts intentionally buckets 3 of 5 BeamStatus values (cancelled beams excluded from the 3-bucket summary) — beam.service.ts:107-118 comment (A6).
- Designs are immutable once created (BR-L core model decision) — governs beam-receipts' colourwayId/designId validation at beam-receipt.service.ts:150-156 (colourway must belong to the referenced design).

**Cross-domain deps**
- beam-receipt.service.ts depends on IInventoryService (fabtraq-be/src/modules/inventory/i-inventory.service.ts) for applyBeamReceiptSizingLedger, reverseLedger, getOutItemRollup — the beam domain never writes stock_ledger rows directly.
- beam-receipt.service.ts reads/writes JwChallanOut and JwChallanOutItem (challanOut.status, jobWorkTypes, recomputeOutChallanStatus writes via outRepo.setStatus) — tight coupling to the jw-challans-out module.
- beam-receipt create validates against Design/DesignColourway rows (colourwayId->designId) — coupling to the Designs module.
- fabtraq-fe/src/features/beams/lib/sourced-from.ts imports ORIGIN_LABEL from @/shared/lib/beam-origin (cross-feature shared lib) and BeamOrigin type from fabtraq-shared.
- FE beams/api.ts and beam-receipts/api.ts both go through typedClient.call(...) against fabtraq-shared registry endpoints (beams.registry.ts, beam-receipts.registry.ts) — B-004 schema-first contract.
- fabtraq-shared/src/schemas/transaction/jw-challan-in-beam.ts is legacy — superseded by BeamReceipt (B-005/B-010); still present in shared, should be checked for live dead-code before any refactor.
- 'Sourced From' derivation (beam.mapper.ts + beam-receipt.mapper.ts) resolves party via out_item_id -> jw_challan_out_items -> jw_challans_out.job_worker_id (sizing_jw only); in_house/purchase have separate/no resolution (B-040 open gap).

**Known debt**
- B-037 (in progress 2026-08-26): cancelled beam holds its beam number forever — DB constraint drop + service-side enforcement; code shows assertBeamNumbersFree already implemented, verify migration + prisma-lineage.repository.ts findUnique({where:{beamNumber}}) also updated.
- B-038 (in progress 2026-08-26): beam-receipt cancellation invisible in DTO + dead guard for purchase receipts — code shows isBeamReceiptCancelled + cancelled field already implemented; verify hasReversalRows fully deleted from beam-receipt.repository.ts.
- B-039 (in progress, Low): transporterId rendered as free-text UUID Input instead of shared TransporterSelect combobox on beam-receipt-form.page.tsx; also flagged out-of-scope that the field is gated to sizing_jw only though the column isn't origin-specific.
- B-040 (Open, Medium): purchase-origin beam receipts have no vendor FK, so Sourced From renders '—' for ~half the register (measured in fabtraq_test, re-measure against dev/prod); fix adds nullable vendorId to BeamReceipt + extends both mappers; bundle with dropping dead `sizingName` field (deprecated in shared 1.25.0, removal is a 2.0.0 breaking change).
- B-041 (Open, Low): prisma/seed.ts:1435-1472 creates a sizing_jw beam receipt item with no outItemId — a state the live API schema forbids (sizingJwBeamItemSchema.outItemId required) — so mapper optional-chaining on beam relations is load-bearing, not defensive; deliberately not fixed to avoid destabilizing other e2e specs' seed assumptions.
- B-018 (candidate, 2026-07-29): applyBeamCompositionLedger trusts the DECLARED sku on a beam yarn slice with no BE-side lot-identity guard — found by sku-shade e2e E5.
- B-035 out-item conservation (P0, fixed but re-verify): 22KG produced from a 10KG dispatch across three beam receipts because jw_challan_out_items drawdown didn't count sizing beam receipts consistently; superRefine conservation guard added — confirm beam-receipt.service.ts still routes through the single consumption authority.
- B-042 (Open, Low): tests/integration/features/beam-receipts/form.page.test.tsx is among the flaky files under `npm run test:coverage` due to instrumentation timeout, not a real defect.
- No TODO/FIXME/ponytail: comments found directly in beam/beam-receipt BE/FE/shared source (grep clean) — debt is tracked entirely in docs/backlog.md rather than inline.

### weaving → `weaving`

**Verdict:** keep — weaving-dispatch (beam issue out + weft delivery out) and weaving-in (grey fabric receipt in + taka placement) are two temporal halves of one designed lifecycle (weaving-dispatch spec §7 explicitly deferred the return leg to what became weaving-in; fabric-taka-register explicitly 'closes the unbuilt half of WI-L1'); they share the Beam entity's status machine and the WI-L14 cancel-guard is only correct because an expert sees both sides at once. Splitting into two agents would silently reintroduce the WI-L14 class of bug at the boundary. ~10.9k LOC (BE 4.7k incl. fabric-taka files, FE 4.5k, shared 0.7k, e2e/tests 1.2k) is large but cohesive — do not merge with jw-challan-out/inventory either, since those are consumed via clean interfaces (IInventoryService, JwChallanOutService), not co-owned invariants.

**Size:** 10921 LOC. **Tests:** ["BE unit/integration: weaving-dispatch.service.test.ts (836 lines), weaving-in.service.test.ts (713), fabric-taka.service.test.ts (143), weaving-in.calculations.test.ts (57), weaving-in.mapper.test.ts (66), prisma-weaving-in.repository.test.ts (83), fabric-taka-search.test.ts (38), assert-location-floor-active.test.ts — 8 BE test files, ~1900+ lines","FE unit/integration: hooks.test.tsx (weaving-dispatches, 183 lines), hooks.test.tsx (weaving-ins, 237), fabric-taka-hooks.test.tsx (50) — 3 FE test files","E2E: weaving-dispatch.spec.ts (348), weaving-in.spec.ts (346), fabric-taka-register.spec.ts (469) — 3 live Playwright specs under e2e/tests/flows, ~1163 lines total"]


**BE paths**
- fabtraq-be/src/modules/weaving-dispatch/prisma-weaving-dispatch.repository.ts (254 lines)
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.routes.ts (52)
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.controller.ts (86)
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.mapper.ts (87)
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.ts (427)
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.module.ts (46)
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.repository.ts (141, interface)
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.test.ts (836)
- fabtraq-be/src/modules/weaving-in/weaving-in.module.ts (41)
- fabtraq-be/src/modules/weaving-in/weaving-in.mapper.ts (83)
- fabtraq-be/src/modules/weaving-in/weaving-in.mapper.test.ts (66)
- fabtraq-be/src/modules/weaving-in/weaving-in.service.ts (532)
- fabtraq-be/src/modules/weaving-in/weaving-in.service.test.ts (713)
- fabtraq-be/src/modules/weaving-in/weaving-in.routes.ts (62)
- fabtraq-be/src/modules/weaving-in/weaving-in.repository.ts (187, interface)
- fabtraq-be/src/modules/weaving-in/prisma-weaving-in.repository.ts (387)
- fabtraq-be/src/modules/weaving-in/prisma-weaving-in.repository.test.ts (83)
- fabtraq-be/src/modules/weaving-in/weaving-in.calculations.ts (34)
- fabtraq-be/src/modules/weaving-in/weaving-in.calculations.test.ts (57)
- fabtraq-be/src/modules/weaving-in/weaving-in.controller.ts (108)
- fabtraq-be/src/modules/weaving-in/assert-location-floor-active.ts + .test.ts
- fabtraq-be/src/modules/weaving-in/fabric-taka.controller.ts (46)
- fabtraq-be/src/modules/weaving-in/fabric-taka.mapper.ts (47)
- fabtraq-be/src/modules/weaving-in/fabric-taka.routes.ts (51)
- fabtraq-be/src/modules/weaving-in/fabric-taka.service.ts (115)
- fabtraq-be/src/modules/weaving-in/fabric-taka.service.test.ts (143)
- fabtraq-be/src/modules/weaving-in/fabric-taka-search.test.ts (38)
- fabtraq-be/src/modules/weaving-in/index.ts

**FE paths**
- fabtraq-fe/src/features/weaving-dispatches/weaving-dispatch-list.page.tsx (98)
- fabtraq-fe/src/features/weaving-dispatches/hooks.ts (73) + hooks.test.tsx (183)
- fabtraq-fe/src/features/weaving-dispatches/api.ts (42)
- fabtraq-fe/src/features/weaving-dispatches/columns.tsx (71)
- fabtraq-fe/src/features/weaving-dispatches/weaving-dispatch-detail.page.tsx (575)
- fabtraq-fe/src/features/weaving-dispatches/weaving-dispatch-form.page.tsx (334)
- fabtraq-fe/src/features/weaving-dispatches/query-keys.ts (11)
- fabtraq-fe/src/features/weaving-dispatches/components/BeamPickerTable.tsx (346)
- fabtraq-fe/src/features/weaving-dispatches/components/WeftLineItemTable.tsx (149)
- fabtraq-fe/src/features/weaving-dispatches/components/WeftLineItemRow.tsx (287)
- fabtraq-fe/src/features/weaving-ins/hooks.ts (125) + hooks.test.tsx (237)
- fabtraq-fe/src/features/weaving-ins/fabric-taka-hooks.test.tsx (50)
- fabtraq-fe/src/features/weaving-ins/fabric-taka-register.page.tsx (341)
- fabtraq-fe/src/features/weaving-ins/api.ts (80)
- fabtraq-fe/src/features/weaving-ins/fabric-taka-columns.tsx (201)
- fabtraq-fe/src/features/weaving-ins/columns.tsx (78)
- fabtraq-fe/src/features/weaving-ins/fabric-taka-detail.page.tsx (278)
- fabtraq-fe/src/features/weaving-ins/weaving-in-detail.page.tsx (302)
- fabtraq-fe/src/features/weaving-ins/weaving-in-form.page.tsx (315)
- fabtraq-fe/src/features/weaving-ins/weaving-in-list.page.tsx (92)
- fabtraq-fe/src/features/weaving-ins/query-keys.ts (27)
- fabtraq-fe/src/features/weaving-ins/map-form-to-input.ts (150)
- fabtraq-fe/src/features/weaving-ins/lib/get-field-error.ts (15)
- fabtraq-fe/src/features/weaving-ins/lib/suggest-weft-allocation.ts (29)
- fabtraq-fe/src/features/weaving-ins/lib/taka-label.ts (25)
- fabtraq-fe/src/features/weaving-ins/lib/weft-ceiling.ts (43)
- fabtraq-fe/src/features/weaving-ins/components/BeamOverridePopover.tsx (120)
- fabtraq-fe/src/features/weaving-ins/components/BeamTotalMetersPrompt.tsx (111)
- fabtraq-fe/src/features/weaving-ins/components/PlaceTakaDialog.tsx (125)
- fabtraq-fe/src/features/weaving-ins/components/WeavingInBeamPickerTable.tsx (250)
- fabtraq-fe/src/features/weaving-ins/components/WeftReconciliationPanel.tsx (218)
- fabtraq-fe/src/features/weaving-ins/components/TakaItemsGrid.tsx (355)

**Shared paths**
- fabtraq-shared/src/registry/transaction/weaving-dispatch.registry.ts (54) — 5 endpoints: GET list/:id, POST create, POST :id/cancel, PATCH :id/print-fields
- fabtraq-shared/src/registry/transaction/weaving-ins.registry.ts (97) — 8 endpoints incl. GET eligible-weft-positions, GET fabric-stock, GET/POST fabric-takas, POST fabric-takas/place
- fabtraq-shared/src/schemas/transaction/weaving-dispatch.ts (187)
- fabtraq-shared/src/schemas/transaction/weaving-in.ts (358)
- fabtraq-shared/src/schemas/transaction/weaving-weft-position.ts (45)

**e2e specs**
- e2e/tests/flows/weaving-dispatch.spec.ts (348 lines)
- e2e/tests/flows/weaving-in.spec.ts (346 lines)
- e2e/tests/flows/fabric-taka-register.spec.ts (469 lines) — placement half of weaving-in, lives under Weaving material stage in FE

**Governing docs**
- docs/brainstorms/2026-07-30-weaving-dispatch.md — WD-L1..L12 locked design for beam-issue (JWB-) + weft-delivery (JWO-) combined challan, finalized 2026-07-30
- docs/superpowers/specs/2026-07-30-weaving-dispatch-design.md — final design spec, repos touched shared/be/fe/e2e
- docs/plans/2026-07-30-weaving-dispatch-{be,fe,shared,e2e}.md — per-repo implementation plans; BE: one txn issues beams (no ledger) and/or creates JwChallanOut weft (full ledger), cancel = full reversal, print-fields-only edit while sent
- docs/brainstorms/2026-08-12-weaving-in.md — WI-L1..L16 locked, grey-fabric-receipt return leg deferred by weaving-dispatch spec §7
- docs/superpowers/specs/2026-08-12-weaving-in-design.md — final design spec for Weaving In
- docs/superpowers/plans/2026-08-13-weaving-in-context.md — cross-repo locked resolutions consolidating BE/FE/shared/e2e surveys
- docs/superpowers/plans/2026-08-13-weaving-in-{be,fe,shared,e2e}.md — per-repo plans
- docs/brainstorms/2026-08-14-fabric-taka-register.md — FTR-L1..L14, per-taka placement + register, follows Weaving In, closes unbuilt half of WI-L1
- docs/superpowers/specs/2026-08-14-fabric-taka-register-design.md (v2) — design spec for taka register + placement
- docs/superpowers/plans/2026-08-14-fabric-taka-register-context.md — cross-repo locked contract; per-repo plans -be/-fe/-shared
- fabtraq-be/docs/backlog.md B-024/B-025 — declared taka count/weight reconciliation gap; cutNotation filter/sort deferred grading feature (both open, weaving-in spec §7 territory)
- fabtraq-be/docs/superpowers/specs/2026-08-31-jw-challan-visibility-design.md — mentions weaving-weft read as one of several out-item rollup consumers (cross-domain, not weaving-owned)

**Invariants (see critic corrections)**
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.ts:242 — cancel refused if dispatch already cancelled
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.ts:258-263 — cancel blocked if any dispatched beam already has Weaving-In taka links (WI-L14): a beam that's had fabric physically drained off it must not silently revert to 'received'/re-issuable
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.ts:266-284 — beam restore on cancel is conditional updateMany on status='issued_to_weaver' per row (P0 fix, WI-L14 guard), not a blind revert
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.ts:328 — updatePrintFields only allowed while status==='sent'
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.ts:342 — beam row id (WeavingDispatchBeam.id) must belong to the dispatch being edited, translated via beamIdByRowId map, not trusted from the wire directly
- fabtraq-be/src/modules/weaving-in/weaving-in.service.ts:93 — cancel refused if already cancelled
- fabtraq-be/src/modules/weaving-in/weaving-in.service.ts:103-112 — cancel blocked (BEAM_ALREADY_CLOSED) if any linked beam status==='fabric_received' (WI-L13, reopen first)
- fabtraq-be/src/modules/weaving-in/weaving-in.service.ts:118-119 — cancel reverses ledger via inventory.reverseLedger reading persisted stock_ledger rows for (weaving_in,id) — no bespoke reversal math
- fabtraq-be/src/modules/weaving-in/weaving-in.service.ts:120-146 — FTR-L8: cancel must also unconditionally clear locationId/floorId on ALL takas of the receipt (read AFTER setStatus, not the pre-cancel snapshot, to avoid a race with a concurrent place()), so 'placed under cancelled receipt refused' and 'cancel a placed receipt' hold in both temporal orders
- fabtraq-be/src/modules/weaving-in/weaving-in.service.ts:318-330 — latest NON-CANCELLED dispatch row per beam wins for beamTotalMeters; a null on the most-recent row must never be backfilled from an older row's value — triggers BEAM_TOTAL_METERS_MISSING instead
- fabtraq-be/src/modules/weaving-in/weaving-in.service.ts:340-348 — per-taka Σ metersAttributed must equal taka.meters within TOLERANCE_METERS (TAKA_METERS_MISMATCH)
- fabtraq-be/src/modules/weaving-in/weaving-in.service.ts:354-373 — per-beam cumulative drain ceiling: existing + new drain ≤ beamTotalMeters × DRAIN_TOLERANCE_FACTOR (1.02) — BEAM_OVER_DRAINED
- fabtraq-be/src/modules/weaving-in/weaving-in.calculations.ts:11-32 — deriveWeftKg = Σtaka.weightKg − Σ(beam.netWeight × metersAttributed / beamTotalMeters); pure function, throws if a beamLinks id is missing from beamsById (caller's responsibility to guard negative result)
- fabtraq-be/src/modules/weaving-in/weaving-in.service.ts:404-437 — weft allocation re-fetches live weaving-weft positions inside the same transaction (not trusted from an earlier GET) for race safety; Σ weftSources must equal enteredWeftKg (WEFT_SOURCES_SUM_MISMATCH); each source.consumedQty must not exceed position.stillAtJwQty+TOLERANCE_KG (WEFT_SOURCE_OVER_CEILING)
- fabtraq-fe/src/features/weaving-ins/lib/weft-ceiling.ts:8-14 — FE ceiling check mirrors BE step 8 exactly and must never be stricter than the BE guard (comment states this explicitly) — a client block the server would accept is unacceptable
- fabtraq-fe/src/features/weaving-ins/lib/weft-ceiling.ts:24-36 — Save-disable gate deliberately ignores allocations with no matching on-screen position (documented reachable edge case: hand-edited Consume cell + weaver change stale state, caught by BE WEFT_SOURCE_NOT_OPEN instead)

**Cross-domain deps**
- weaving-dispatch.module.ts / .service.ts import JwChallanOutService (jw-challan-out module) — weft delivery leg reuses the existing JWO- challan-out ledger path
- weaving-dispatch.service.ts imports IWeavingInRepository (weaving-in module) to check anyBeamHasTakaLinks before allowing cancel — direct cross-module repo dependency, not via an interface boundary at the service layer
- weaving-in.service.ts / weaving-in.module.ts / weaving-in.controller.ts / weaving-in.routes.ts all depend on IInventoryService (inventory module): reverseLedger, getWeavingWeftPositions, applyWeavingInWeftLedger
- Beam entity (masters/beams domain) is the shared substrate both modules mutate: weaving-dispatch issues beams (status→issued_to_weaver) and weaving-in drains/closes them (status→fabric_received) — the WI-L14 guard above exists precisely because both domains write the same Beam rows
- weaving-dispatch response schema carries an additive weavingDispatchId field surfaced on jwChallanOutResponseSchema (shared) — jw-challan-out schema was extended for this domain
- FabricTaka (placement half, fabric-taka.* files + fabric-taka-register.page.tsx) touches the same Location/Floor placement machinery used across Inventory/Placements domain (assert-location-floor-active.ts)

**Known debt**
- fabtraq-*/docs/backlog.md B-024 — no declared taka-count/weight header field to reconcile against derived row-sum totals; open, logged 2026-08-14
- fabtraq-*/docs/backlog.md B-025 — cutNotation not filterable/sortable on the taka register; deferred grading-feature partial, open
- fabtraq-*/docs/backlog.md ~line 842-895 — Weaving-In BE review notes getWeavingWeftPositions / findActiveTakasForFabricStock behavior nuances (worth re-reading before touching those two reads)
- No TODO/FIXME/ponytail: comments found in any weaving-dispatch or weaving-in source file (BE, FE, or shared) — debt lives entirely in backlog.md, not inline

### challan-print → `challan-print`

**Verdict:** keep — the domain is already correctly scoped as a pure, self-contained rendering layer (types→paginate→format→templates→documents→render→hook, 24 source+test files, one narrow public surface `usePrintChallan`) with exactly the two callers the spec anticipates; its only real coupling is a read-only dependency on shared's challanJobWorkerRefSchema and on jw-challan-out/weaving-dispatch's BE hydration, which is correctly modeled as a cross-domain dependency rather than folded in — merging those hydration paths into challan-print would blur module ownership of the Prisma selects, and splitting challan-print further (e.g. beam-issue vs yarn-delivery as separate features) would break the single-consignee-schema invariant documented in format.ts

**Size:** 4434 LOC. **Tests:** "FE: 12 test files colocated with source under fabtraq-fe/src/features/challan-print/ (assets.test.ts 14, font-metrics.test.ts 78, render.test.tsx 172, paginate.test.ts 39, usePrintChallan.test.ts 210, companies.test.ts 15, templates/yarn-delivery.test.ts 27, templates/heading.test.ts 15, templates/beam-issue.test.ts 22, documents/yarn-delivery.test.ts 211, documents/format.test.ts 65, documents/beam-issue.test.ts 186 — total ~1054 test-file lines vs ~1130 source-file lines, roughly 1:1). E2E: 1 dedicated spec (challan-pdf.spec.ts, 159 lines, 1 test() block) plus incidental print-button coverage inside weaving-dispatch.spec.ts, weaving-in.spec.ts, jw-challan-visibility.spec.ts. No BE test files live in this domain proper — jw-challan-out/weaving-dispatch mapper tests (jw-challan-out.mapper.test.ts, weaving-dispatch.service.test.ts) belong to their own modules and only incidentally cover the hydration fields this domain consumes."


**BE paths**
- fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.ts (hydrates jobWorker consignee block + item qualityName, ~L57-66, L90)
- fabtraq-be/src/modules/jw-challan-out/prisma-jw-challan-out.repository.ts (JW_OUT_INCLUDE Prisma select, L29-54, widened for jobWorker address/gstin/stateCode + item quality name)
- fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.mapper.ts (hydrates dispatch-level jobWorker ref + designName, L28-38)
- fabtraq-be/src/modules/weaving-dispatch/prisma-weaving-dispatch.repository.ts (widened select feeding the mapper above)

**FE paths**
- fabtraq-fe/src/features/challan-print/usePrintChallan.ts (60 lines) — public hook: printBeamIssue/printYarnDelivery, re-entrancy guard, blob URL lifecycle
- fabtraq-fe/src/features/challan-print/render.tsx (567 lines) — the actual react-pdf JSX tree: geometry, watermark, page-of-page footer logic
- fabtraq-fe/src/features/challan-print/render.test.tsx (172 lines)
- fabtraq-fe/src/features/challan-print/pdf-entry.ts (7 lines) — lazy dynamic-import boundary for @react-pdf/renderer
- fabtraq-fe/src/features/challan-print/paginate.ts (26 lines) + paginate.test.ts (39 lines) — row-per-page + compression algorithm (spec §7)
- fabtraq-fe/src/features/challan-print/types.ts (65 lines) — the string-only ChallanDocument/ChallanPage/PartyBlock model
- fabtraq-fe/src/features/challan-print/fonts.ts (32 lines) — Liberation Sans TTF registration
- fabtraq-fe/src/features/challan-print/font-metrics.ts (150 lines) + font-metrics.test.ts (78 lines) — text-width measurement for pagination/wrapping
- fabtraq-fe/src/features/challan-print/companies.ts (17 lines) + companies.test.ts (15 lines) — Gosrani constants transcribed verbatim
- fabtraq-fe/src/features/challan-print/assets.ts (12 lines) + assets.test.ts (14 lines) — logo/wordmark data-URI loading
- fabtraq-fe/src/features/challan-print/assets/mark.jpg, assets/wordmark.jpg, assets/fonts/LiberationSans-{Bold,Regular}.ttf — binary assets
- fabtraq-fe/src/features/challan-print/templates/heading.ts (12 lines) + heading.test.ts (15 lines) — headingForJobWorkTypes()/PURPOSE_LABELS
- fabtraq-fe/src/features/challan-print/templates/yarn-delivery.ts (14 lines) + yarn-delivery.test.ts (27 lines)
- fabtraq-fe/src/features/challan-print/templates/beam-issue.ts (18 lines) + beam-issue.test.ts (22 lines)
- fabtraq-fe/src/features/challan-print/documents/format.ts (33 lines) + format.test.ts (65 lines) — weight3/money2/partyBlockFromJobWorker formatting rules
- fabtraq-fe/src/features/challan-print/documents/yarn-delivery.ts (49 lines) + yarn-delivery.test.ts (211 lines) — JwChallanOutResponse -> ChallanDocument mapper
- fabtraq-fe/src/features/challan-print/documents/beam-issue.ts (64 lines) + beam-issue.test.ts (186 lines) — WeavingDispatchResponse -> ChallanDocument mapper
- fabtraq-fe/src/features/challan-print/usePrintChallan.test.ts (210 lines)
- fabtraq-fe/src/features/challan-print/.claude-flow/data/pending-insights.jsonl — stray tool-generated file, not source (flag for cleanup, not code)

**Shared paths**
- fabtraq-shared/src/schemas/transaction/jw-challan-out.ts:258-267 (challanJobWorkerRefSchema definition) and :269-284 (jwChallanOutResponseSchema.jobWorker + items[].qualityName consumed by the yarn-delivery document mapper)
- fabtraq-shared/src/schemas/transaction/weaving-dispatch.ts:18-21 (re-imports challanJobWorkerRefSchema) and :157 (weavingDispatchResponseSchema.jobWorker) — consumed by the beam-issue document mapper; also carries beam designName consumed by templates/beam-issue.ts

**e2e specs**
- e2e/tests/flows/challan-pdf.spec.ts (159 lines, 1 test() block — likely a single end-to-end print-and-download-verify flow rather than multiple named cases)
- e2e/tests/flows/weaving-dispatch.spec.ts (references print, indirect coverage of beam-issue print entry point)
- e2e/tests/flows/weaving-in.spec.ts (references print, tangential)
- e2e/tests/flows/jw-challan-visibility.spec.ts (references print, tangential — likely just navigates through detail pages that have Print buttons)

**Governing docs**
- fabtraq-be/docs/specs/2026-08-21-challan-pdf-design.md (mirrored byte-for-byte in fabtraq-fe/fabtraq-shared/root docs/) — normative design: client-side @react-pdf/renderer, geometry (§6), pagination (§7), data model (§3), data gaps (§5); locks engine choice, scope (outbound only, inbound T3A/B/C explicitly excluded), fidelity rules (CANCELLED watermark, Page n of m only when >1 page, footer/signature only on last page)
- fabtraq-fe/docs/plans/2026-08-21-challan-pdf-fe.md — FE task plan: feature architecture (page→hook→pure renderer, no axios), company constants transcribed verbatim, coverage bar 80/75/80
- fabtraq-be/docs/plans/2026-08-21-challan-pdf-be.md — BE task plan: additive Prisma select widening + mapper threading, depends on shared 1.20.0 published first
- fabtraq-shared/docs/plans/2026-08-21-challan-pdf-shared.md — shared task plan: additive schema fields only (jobWorker consignee widen, item qualityName, beam designName), 1.19.1→1.20.0
- docs/backlog.md B-002 (mirrored in fabtraq-be/fabtraq-fe) — original deferred proposal for server-side PDF rendering (wkhtmltopdf/pdf-lib/Puppeteer); SUPERSEDED in outcome by the client-side @react-pdf/renderer approach the 2026-08-21 spec actually locked; B-002 remainder = T1 (yarn purchase) + T3 (JW-In) print + 4 UUID-fallback pages, per MEMORY.md project_challan_pdf_workstream
- fabtraq-fe/docs/ui-prompts/60-print/challan-print.md — UI-redesign-wave prompt touching this feature's presentation (part of the Tier-2/40-screens redesign passes, not the PDF design itself)

**Invariants (see critic corrections)**
- Watermark derivation: fabtraq-fe/src/features/challan-print/documents/yarn-delivery.ts:47 and documents/beam-issue.ts:62 — `watermark: status === 'cancelled' ? 'CANCELLED' : null` — the document is a PURE function of the challan/dispatch response's own status field; challan-print never re-derives cancellation from the ledger itself (that's the source module's job, per MEMORY.md 'cancelled derived from register not ledger' lesson living in beam/beam-cancel, not here)
- Blank-not-zero formatting rule: fabtraq-fe/src/features/challan-print/documents/format.ts weight3()/money2() — null renders '' never '0.000'/'0.00' because 'a printed zero is a factual claim about the ledger; blank is not' (format.ts comment, L6-7) — load-bearing for not misrepresenting missing data on a legal document
- Page-of-page suppression: fabtraq-fe/src/features/challan-print/render.tsx:214-218 — 'Page n of m' text renders only when pageCount > 1 (spec §7 integrity requirement) — single-page challans show no page marker
- Pagination compression: fabtraq-fe/src/features/challan-print/paginate.ts:5-10 rowsPerPageFor() — widens rows-per-page up to `max` for short challans so they fill the sheet, falls back to fixed `base` once itemCount exceeds max; paginate() L13-25 zero-pads the last page to a full grid (visual fidelity to the physical challan book, not an arbitrary layout choice)
- Print re-entrancy guard: fabtraq-fe/src/features/challan-print/usePrintChallan.ts L20-22 — printingRef (synchronous ref) guards double-click because React state only commits next render; without it two rapid clicks both read printing=false and open two PDF tabs/blob URLs
- Blob URL lifecycle: usePrintChallan.ts REVOKE_DELAY_MS=60_000 — object URL is revoked 60s after opening the print tab, not immediately (immediate revoke would race the new tab's load)
- Single shared consignee schema: fabtraq-shared/src/schemas/transaction/jw-challan-out.ts:258-267 challanJobWorkerRefSchema is defined once and imported into weaving-dispatch.ts:18-21 — beam-issue and yarn-delivery consignee blocks are built from the identical hydrated shape (documents/format.ts L21-22 comment makes this explicit) so the two document mappers cannot drift on what 'consignee' means
- Scope boundary is spec-locked, not incidental: 2026-08-21-challan-pdf-design.md §0 explicitly excludes inbound (T3A/B/C) printing — 'Gosrani never issues' the inbound challan format, so this domain's two document types (beam-issue, yarn-delivery) are exhaustive for outbound and should NOT be extended to inbound without a new design decision

**Cross-domain deps**
- jw-challan-out module: challan-print's usePrintChallan.printYarnDelivery consumes JwChallanOutResponse as-is; BE mapper/repository in that module own the jobWorker/qualityName hydration this domain depends on but does not itself contain
- weaving-dispatch module: printBeamIssue consumes WeavingDispatchResponse; same hydration dependency for beam-issue consignee + designName
- fabtraq-shared jw-challan-out.ts: challanJobWorkerRefSchema is the single source of the consignee shape, re-exported and reused by weaving-dispatch.ts (import at L18-21) — a schema change here is a breaking change for both BE modules and both FE document mappers
- fabtraq-shared stateNameForCode: used by both BE mappers to derive stateName from stateCode (kept in lockstep manually — not stored, always derived)
- callers: fabtraq-fe/src/features/weaving-dispatches/weaving-dispatch-detail.page.tsx and fabtraq-fe/src/features/jw-challans-out/jw-challan-out-detail.page.tsx are the only two invokers of usePrintChallan

**Known debt**
- No TODO/FIXME/ponytail: comments found inside fabtraq-fe/src/features/challan-print/** — the feature reads as intentionally finished, not stubbed
- B-002 remainder (per docs/backlog.md + MEMORY.md project_challan_pdf_workstream): T1 (Yarn Purchase) print and T3 (JW-Challan In) print were never built — only T2 (JW-Challan Out / yarn-delivery) and the weaving-dispatch beam-issue document exist; 4 pages still show raw UUIDs as a fallback instead of human labels
- Workstream is COMPLETE and shared 1.20.1 is published, but per MEMORY.md project_challan_pdf_workstream all 4 repos were 'PUSHED 2026-08-21' — however per project_prod_release_deploy this later merged to main and deployed, so this specific debt line is resolved; the T1/T3/UUID-fallback gap remains open regardless
- Stray non-source file inside the feature directory: fabtraq-fe/src/features/challan-print/.claude-flow/data/pending-insights.jsonl (6 lines) — tool-generated cruft checked into a source directory, should be gitignored/removed (read-only study, not fixing)

### shared-infra → `shared-infra`

**Verdict:** keep — this is a coherent cross-cutting infrastructure module (~6.3k LOC across 3 repos: BE http/config 2595, FE api 981, shared registry/primitives/errors/validation/constants/schemas-common+forms ~2698) with one clear owning concern (the B-004 schema-first contract-drift guarantee) and one clear governing spec lineage; splitting it (e.g. separating registry from validate/error-handler) would break the documented three-layer guarantee that spans all three, and merging it into any single business domain (JW/Inventory/Beams/etc.) would be wrong since every one of those domains depends on it symmetrically.

**Size:** 6274 LOC. **Tests:** ["Unit/integration (co-located *.test.ts, count via BE http dir): fabtraq-be/src/shared/http/{async-handler,auth,csrf,error-handler,register-endpoint,request-id,validate}.test.ts (7 files) + fabtraq-be/src/config/env.test.ts (1) = 8 direct unit-test files.", "fabtraq-fe/src/shared/api/typed-client.test.ts — typed-client unit tests (proof-of-no-cast-at-call-site usage per its own docstring).", "fabtraq-fe/tests/integration/contract/{inventory-msw-contract,designs-msw-contract,beam-receipts-msw-contract}.test.ts — FE MSW+schema contract tests exercising jsonValidated/msw-wrapper against live registry schemas.", "fabtraq-shared/tests/validation/msw-wrapper.test.ts — shared-level unit test for jsonValidated/parseOrThrow.", "No dedicated e2e/tests/flows/*.spec.ts targets shared-infra as its own domain (it is cross-cutting middleware/plumbing exercised incidentally by every flow spec, e.g. inventory.spec.ts, placement.spec.ts, jw-out.spec.ts, beams.spec.ts, weaving-in.spec.ts, yarn-purchase.spec.ts, beam-receipt.spec.ts, fabric-taka-register.spec.ts, jw-in-{beam,dyed,yarn}.spec.ts, out-item-conservation.spec.ts, wastage-report.spec.ts, party-lot-carry-forward.spec.ts — 14 specs grep-matched on 'registry|typedClient|contract|schema' but none scoped solely to shared-infra)."]


**BE paths**
- fabtraq-be/src/shared/http/register-endpoint.ts (205)
- fabtraq-be/src/shared/http/register-endpoint.test.ts
- fabtraq-be/src/shared/http/validate.ts (66)
- fabtraq-be/src/shared/http/validate.test.ts
- fabtraq-be/src/shared/http/error-handler.ts (151)
- fabtraq-be/src/shared/http/error-handler.test.ts
- fabtraq-be/src/shared/http/contract-validators.ts (349, wires applyContractValidators for all 45 registry endpoints)
- fabtraq-be/src/shared/http/async-handler.ts (37)
- fabtraq-be/src/shared/http/async-handler.test.ts
- fabtraq-be/src/shared/http/auth.ts (101, requireAuth/requireRole)
- fabtraq-be/src/shared/http/auth.test.ts
- fabtraq-be/src/shared/http/csrf.ts (108)
- fabtraq-be/src/shared/http/csrf.test.ts
- fabtraq-be/src/shared/http/request-id.ts (24)
- fabtraq-be/src/shared/http/request-id.test.ts
- fabtraq-be/src/shared/http/schemas.ts (3)
- fabtraq-be/src/config/env.ts (73, zod-validated process.env)
- fabtraq-be/src/config/env.test.ts
- fabtraq-be/src/config/container.ts (37, DI wiring)
- fabtraq-be/src/config/tokens.ts (172, DI token registry)
- fabtraq-be/src/app.ts (Express app assembly: applyContractValidators + module routers + error handler)
- fabtraq-be/src/main.ts (server entry, loadEnv call)
- fabtraq-be/src/shared/db/serializable.ts (isSerializationFailure, used by error-handler.ts:14)

**FE paths**
- fabtraq-fe/src/shared/api/typed-client.ts (287)
- fabtraq-fe/src/shared/api/typed-client.test.ts
- fabtraq-fe/src/shared/api/client.ts (54, axios instance)
- fabtraq-fe/src/shared/api/errors.ts (164, client-side AppError typing)
- fabtraq-fe/src/shared/api/csrf.ts (46)
- fabtraq-fe/src/shared/api/auth-store.ts (29)
- fabtraq-fe/src/shared/api/types.ts (13)
- fabtraq-fe/tests/msw/ (MSW server setup, dir found via find, not individually enumerated)
- fabtraq-fe/tests/integration/contract/inventory-msw-contract.test.ts
- fabtraq-fe/tests/integration/contract/designs-msw-contract.test.ts
- fabtraq-fe/tests/integration/contract/beam-receipts-msw-contract.test.ts

**Shared paths**
- fabtraq-shared/src/registry/index.ts (7)
- fabtraq-shared/src/registry/types.ts (79, EndpointDef/HttpMethod/PathParams)
- fabtraq-shared/src/registry/params.ts (10)
- fabtraq-shared/src/registry/transaction/{jw-challans-in,weaving-dispatch,weaving-ins,beam-receipts,jw-challans-out,stock-transfers,yarn-purchases}.registry.ts + index.ts (8 files, 407 lines)
- fabtraq-shared/src/registry/master/{job-workers,locations,designs,yarn-qualities,fabric-designs,transporters,vendors}.registry.ts + index.ts (8 files, 373 lines)
- fabtraq-shared/src/registry/overview/overview.registry.ts + index.ts (17 lines)
- fabtraq-shared/src/registry/inventory/{inventory,lot-lineage,placements,beams}.registry.ts + index.ts (5 files, 254 lines)
- fabtraq-shared/src/registry/auth/auth.registry.ts + index.ts (31 lines)
- fabtraq-shared/src/errors/app-error.ts (146, AppError hierarchy incl. ResponseShapeViolation)
- fabtraq-shared/src/errors/index.ts (1)
- fabtraq-shared/src/primitives/{code,entry-no,phone,gstin,lot-number,optional-text,optional-number,color,distribute,id,party-lot,money,job-work}.ts + index.ts (13 files, 895 lines)
- fabtraq-shared/src/validation/express-middleware.ts (55)
- fabtraq-shared/src/validation/parse-or-throw.ts (45)
- fabtraq-shared/src/validation/msw-wrapper.ts (28)
- fabtraq-shared/src/validation/index.ts (3)
- fabtraq-shared/src/constants/{job-work-types,status,role,wastage,unit,delivery-modes,states,yarn-category}.ts + index.ts (9 files, 189 lines)
- fabtraq-shared/src/schemas/index.ts
- fabtraq-shared/src/schemas/common.ts
- fabtraq-shared/src/schemas/beam.ts (found alongside common.ts, likely mis-scoped to this domain — flag for review, business schema not shared-infra plumbing)
- fabtraq-shared/src/schemas/forms/{sku-answer,beam-receipt-yarn,jw-challan-in-lot,yarn-purchase-item}.ts + index.ts (5 files, 129 lines)
- fabtraq-shared/tests/validation/msw-wrapper.test.ts

**e2e specs**
- e2e/tests/flows/inventory.spec.ts
- e2e/tests/flows/out-item-conservation.spec.ts
- e2e/tests/flows/wastage-report.spec.ts
- e2e/tests/flows/placement.spec.ts
- e2e/tests/flows/jw-in-beam.spec.ts
- e2e/tests/flows/yarn-purchase.spec.ts
- e2e/tests/flows/jw-out.spec.ts
- e2e/tests/flows/weaving-in.spec.ts
- e2e/tests/flows/jw-in-dyed.spec.ts
- e2e/tests/flows/beams.spec.ts
- e2e/tests/flows/party-lot-carry-forward.spec.ts
- e2e/tests/flows/beam-receipt.spec.ts
- e2e/tests/flows/jw-in-yarn.spec.ts
- e2e/tests/flows/fabric-taka-register.spec.ts

**Governing docs**
- fabtraq-shared/docs/specs/2026-06-12-b004-endpoint-registry-design.md — B-004 design: locks the EndpointDef shape, three-layer drift guarantee (compile-time + build-time OpenAPI + runtime parseOrThrow), P1-P6 phase breakdown.
- fabtraq-shared/docs/superpowers/plans/2026-06-12-b004-p1-endpoint-registry.md — P1 execution plan: 45 live endpoints ported into the registry additively as shared@1.1.0.
- fabtraq-fe/docs/superpowers/plans/2026-06-16-b004-p4-typed-client.md — P4 plan: typedClient.call(def,args) derivation rules, vendors feature as first migration increment.
- fabtraq-be/docs/specs/2026-05-06-contract-drift-prevention.md + fabtraq-fe/docs/specs/... + fabtraq-shared/docs/specs/... (byte-identical mirrors) — original Sprint-4-Phase-0 runtime-schema-validate design that B-004 supersedes/extends at compile-time; still governs parse-or-throw.ts/msw-wrapper.ts/contract-validators.ts runtime behavior.
- fabtraq-be/docs/plans/2026-05-06-contract-drift-prevention-{be,fe,shared}.md (mirrored across all 3 repos) — the original per-repo implementation plans for the runtime layer.
- docs/backlog.md lines 100-330 — B-004 status ledger: INFRASTRUCTURE COMPLETE (P1-P4+P6) as of 2026-06-16 correction, root-bug-found-and-fixed narrative (registry output-typing bug), current push/PR state.
- docs/superpowers/plans/2026-05-08-yarn-sku-contract-alignment.md + docs/superpowers/specs/2026-05-08-yarn-sku-contract-alignment-design.md — earlier, narrower contract-alignment work predating B-004; tangential but same schema-drift concern.

**Invariants (see critic corrections)**
- registerEndpoint segment-boundary prefix match, not bare startsWith: fabtraq-be/src/shared/http/register-endpoint.ts:189-200 — a bare prefix check would wrongly accept `/jw-challans-in-beam` under mountPrefix `/jw-challans-in`; must equal exactly or continue with '/'.
- registerEndpoint middleware composition order is fixed and load-bearing: requireAuth -> requireRole -> CSRF (mutating methods only) -> preValidation (e.g. multer) -> validate() -> asyncHandler: fabtraq-be/src/shared/http/register-endpoint.ts:122-181 (explicitly: preValidation runs after CSRF/auth so it never executes for unauthenticated/unauthorized requests).
- registerEndpoint fail-fast role guard: throws at startup if any def.roles string is not in deps.validRoles, catching registry/BE role-name drift before serving traffic: register-endpoint.ts:133-146.
- applyContractValidators(app) must be mounted BEFORE module routers on the same paths (Express applies validator middleware first, wrapping res.json before controllers run): fabtraq-be/src/shared/http/contract-validators.ts:73-79 docstring + fabtraq-be/src/app.ts wiring order.
- validateListOrDetail schema selection: only GET at exact root path ('/' or '') uses the list (Page<T>) schema; every other route (writes, detail GETs) uses the detail schema — contract-validators.ts:59-70.
- Error middleware maps ZodError by STRUCTURAL check (name==='ZodError' + issues array), not instanceof, because fabtraq-shared bundles its own zod copy that fails cross-package instanceof: fabtraq-be/src/shared/http/error-handler.ts:49-67.
- AppError -> HTTP status/body mapping precedence is fixed: AppError subclasses > ZodError(400) > http-errors-style CSRF/403 > MulterError(413/400) > Prisma P2002(409)/P2025(404)/serialization-failure(409) > InternalError(500): error-handler.ts:37-141.
- parseOrThrow returns z.output (post-transform/default), not input type, and is the single validator both BE runtime response-validation (contract-validators.ts) and FE MSW mock-fixture validation (msw-wrapper.ts jsonValidated) route through: fabtraq-shared/src/validation/parse-or-throw.ts:12-15,25-44.
- env.ts envBoolean custom transform exists specifically because z.coerce.boolean() treats any non-empty string (including the literal 'false') as true: fabtraq-be/src/config/env.ts:4-14 — a naive coerce.boolean() swap would silently invert COOKIE_SECURE.
- RATE_LIMIT_AUTH_MAX default of 100 is a locked production security baseline; only the e2e webServer env may raise it, never production: fabtraq-be/src/config/env.ts:37-46.
- typedClient.call confines exactly two casts to its implementation body (CallArgs indexable-shape cast, parseOrThrow-return-to-ResponseOf cast) so no call site ever needs a cast: fabtraq-fe/src/shared/api/typed-client.ts:1-13 module docstring.

**Cross-domain deps**
- Every BE module router imports registerEndpoint + its EndpointDef from the shared registry: modules/{wastage,fabric-design,jw-challan-out,beam,jw-challan-in,weaving-in,weaving-dispatch,lineage,place-stock,design,overview,stock-transfer,vendor,beam-receipt}/*.routes.ts (24 call sites) — shared-infra changes here are BE-repo-wide blast radius, not confined to one module.
- Every FE feature's api.ts (14 files under fabtraq-fe/src/features/*/api.ts) imports typedClient + registry EndpointDefs — same blast-radius property on the FE side.
- app.ts wires applyContractValidators(app) BEFORE mounting module routers (order is load-bearing, see contract-validators.ts:77-79 docstring) — any module router that gets reordered ahead of this breaks response validation silently.
- shared/errors/app-error.ts AppError hierarchy is imported directly by BE error-handler.ts and indirectly by every module's service layer (throws NotFoundError/ConflictError/etc.) and by FE shared/api/errors.ts for client-side error typing.
- shared/validation/parse-or-throw.ts is the single implementation backing BOTH validateResponse (BE contract-validators, live traffic) and jsonValidated (FE msw-wrapper.ts, test fixtures) — the 3-layer drift guarantee (compile-time typedClient/registerEndpoint, build-time OpenAPI, runtime parseOrThrow) collapses to one function.
- fabtraq-shared registry/* re-exports (registry/index.ts, transaction/index.ts, master/index.ts) are consumed by openapi generation (BE) referenced in backlog.md P3 — not found as a separate file in this pass, worth a follow-up read of fabtraq-be src for buildOpenApiDocument().

**Known debt**
- No TODO/FIXME/ponytail: comments found under the shared-infra file set (BE http/, config/; FE shared/api/; shared registry/, primitives/, errors/, validation/, constants/, schemas/common.ts, schemas/forms/) — the module reads as clean at time of this study, contrary to typical churn elsewhere in the codebase.
- docs/backlog.md B-004 section: P5 (migrate remaining FE features off raw client onto typedClient) is explicitly 'lazy/ongoing' — only vendors/api.ts was migrated as the P4 proof; 13 of 14 FE feature api.ts files still need auditing for full typedClient adoption vs. legacy client calls.
- docs/backlog.md: OpenAPI codegen (originally P3-adjacent, full FE codegen) was deferred to a post-Sprint-5 reassessment per MEMORY.md project_contract_drift_prevention.md — status of that reassessment not found in this pass, worth confirming it wasn't quietly dropped.
- MEMORY.md project_b004_schema_first_api.md flags P3/P4/P6 as 'unpushed' as of 2026-06-16 and shared needing a republish to 1.2.0 — per feedback_verify_git_not_backlog.md this status is known-stale and must be re-verified via git log/npm view before relying on it, not read from backlog text alone (out of scope for this read-only study).

### e2e-harness → `e2e-harness`

**Verdict:** split: keep {seed.ts, playwright.config.ts, fixtures/, support/, auth.setup.ts, smoke/} as the e2e-harness/infra domain (~2,650 LOC: 1805 BE seed + 766 fixtures/support + config + auth.setup) — that IS a coherent, reviewable single module (DB reset/seed contract, webServer boot, auth storageState, ledger-delta helper, code-gen). But do NOT fold tests/flows/*.spec.ts (11,217 LOC, 26 files) into this same expert-agent domain: each flow spec is a product-feature test that must be reviewed by the owning feature domain's expert (jw-in, jw-out, beams, inventory, weaving, etc.) alongside that feature's BE/FE code — a single e2e-harness agent reviewing all 26 flow specs has no way to judge correctness against feature-specific invariants it doesn't own. Route flow-spec changes to the relevant feature domain agents; keep this domain scoped to the infra/harness pieces plus a thin cross-cutting review pass (fixtures/support/config changes, and the recurring B-043/B-027 harness-level debt).

**Size:** 14647 LOC. **Tests:** ["26 flow specs, 11,217 lines under e2e/tests/flows/ (see e2eSpecs) — NOT infra, these are product-feature E2E tests that happen to share this harness's fixtures/support.", "e2e/tests/auth.setup.ts — the harness's own self-test (login flow, writes .auth/*.json), IS infra.", "No dedicated unit tests exist for fixtures/db.ts's whereFor() filter logic or fixtures/codes.ts's counter/collision-avoidance — these are trusted-by-use only, exercised indirectly by every flow spec that calls db.ledgerBalance/ledgerDelta.", "fabtraq-be/prisma/seed.ts has no direct unit test; it is validated only by the e2e suite running against its output (and by BE integration tests that seed via Prisma directly, per B-029)."]


**BE paths**
- fabtraq-be/prisma/seed.ts (1794 lines) — main() seeds users (owner/storekeeper/accountant), masters, DSN-001 design, register beams (Part-C), etc.
- fabtraq-be/prisma/seed-constants.ts (11 lines)
- fabtraq-be/package.json:26-27 — "db:reset": "prisma migrate reset --skip-seed --force", "db:seed": "tsx prisma/seed.ts"

**e2e specs**
- e2e/tests/flows/*.spec.ts — 26 files, 11217 lines total (beam-receipt.spec.ts 1442, jw-in-yarn.spec.ts 843, jw-in-dyed.spec.ts 645, place-stock-transfer-sync.spec.ts 623, placement.spec.ts 601, design-v2.spec.ts 556, inventory-chart.spec.ts 531, party-lot-carry-forward.spec.ts 509, trace.spec.ts 469, fabric-taka-register.spec.ts 469, beams.spec.ts 464, beams-grouped.spec.ts 407, out-item-conservation.spec.ts 403, inventory.spec.ts 396, wastage-report.spec.ts 379, weaving-dispatch.spec.ts 348, weaving-in.spec.ts 346, jw-out.spec.ts 343, yarn-purchase.spec.ts 246, jw-challan-visibility.spec.ts 218, sku-empty-quality.spec.ts 208, inventory-hub.spec.ts 196, jw-in-source-details.spec.ts 194, challan-pdf.spec.ts 159, stock-transfer.spec.ts 114, cancelled-parent-guard.spec.ts 95, jw-in-beam.spec.ts 13]
- e2e/tests/auth.setup.ts — login → storageState, drives the 'setup' Playwright project
- e2e/tests/smoke/, e2e/tests/masters/, e2e/tests/guards/, e2e/tests/visual/ — not enumerated in this pass (out of the requested flows/fixtures/config/helpers scope) but share the same fixtures/support harness

**Governing docs**
- docs/superpowers/specs/2026-07-08-e2e-playwright-suite-design.md — original design spec for the harness itself (webServer boot, db reset/seed flow, fixtures/db.ts contract, storageState auth)
- docs/superpowers/plans/2026-07-08-e2e-playwright-suite.md — implementation plan for the same
- e2e/README.md — canonical, extremely detailed operational doc: run commands, 3 gotchas (port ownership, DB wipe, auth rate-limit), worktree/isolated-DB invocation recipe with rationale per env var, design conventions (serial execution, delta ledger assertions, code-gen via fixtures/codes.ts, no absolute-number assertions on minted document numbers), directory layout, and a running 'Bugs surfaced' log (7 entries, 2 still Open)
- docs/backlog.md B-043 (lines ~1198-1224) — 'npm run e2e silently targets fabtraq_dev, and its two halves can disagree' — Open, Medium severity, the load-bearing known-debt item for this exact domain
- docs/backlog.md B-027 (lines ~917-940) — 'e2e suite has a low-rate, load-sensitive timeout flake' — Open, harness-level flakiness
- docs/backlog.md line ~1224 — separate note: `npm run e2e | tail` swallows the real exit code, a red run reads as green
- e2e/docs/backlog.md — mirrored copy of the umbrella backlog (byte-for-byte per feedback_prettier_skips_mirrored_docs), same B-043/B-027 entries apply

**Invariants (see critic corrections)**
- e2e/fixtures/env.ts:2-4 — DATABASE_URL defaults to `postgresql://fabtraq:fabtraq_dev@localhost:5432/fabtraq_dev` (the DEV database, not a test DB) when unset. This is the concrete mechanism behind B-043.
- e2e/package.json:4 — `npm run e2e` = `db:reset && db:seed` in `${E2E_BE_DIR:-../fabtraq-be}` THEN `playwright test`; this reseed step reads DATABASE_URL from the BE checkout's own .env, a SEPARATE resolution path from fixtures/env.ts's default above — the two can silently disagree (B-043).
- e2e/fixtures/db.ts:8-13 + whereFor() at :17-36 — LedgerKey filter semantics are load-bearing: `undefined` = no filter on that column, `null` = SQL `IS NULL`, a value = equality. Comment at db.ts:9-12 documents that at-job-worker ledger rows carry non-null job_worker_id with floorId/locationId = null, so callers must pass `null` (not omit the key) to scope to floor-only rows.
- e2e/playwright.config.ts:38-44 — `workers: 1, fullyParallel: false` — hard serial-execution requirement; README states this is because of 'shared mutable Postgres + aggregate ledger assertions', i.e. the suite is NOT safe to parallelize without redesigning ledger delta assertions.
- e2e/playwright.config.ts:85 — `RATE_LIMIT_AUTH_MAX: '2000'` injected into the BE webServer's env; without it the suite's 69+ serial tests each re-checking auth via `GET /auth/me` blow through the BE's real 100-req/15min production rate limit and get bounced to /login (masquerading as an auth bug) — comment at :77-84 documents this in detail.
- e2e/playwright.config.ts:87 — `CORS_ORIGIN: BASE_URL` must be derived from BASE_URL, not left at the BE's hardcoded default (`http://localhost:5173`), or every FE xhr including /auth/login is CORS-blocked (documented :77-84 and README 'Why each non-obvious variable is required').
- e2e/playwright.config.ts:95 — FE webServer command uses `--strictPort`; without it Vite silently bumps to the next free port and the suite would run against whatever unrelated app already occupies the target port instead of failing loudly (comment :91-94).
- e2e/README.md 'Never assert minted document numbers' — TXF/challan/entry are FY sequence counters; specs must capture-and-assert format only, never exact value (this is enforced convention, not code, but is load-bearing for every flow spec).
- e2e/README.md 'Delta ledger assertions, never absolute' — every transactional spec must read stock_ledger balance before+after and assert the delta, order-independent; matches the `ledgerDelta()` helper at e2e/fixtures/db.ts:63-70.
- e2e/fixtures/codes.ts:1-3 — run-scoped counter starts at 900 specifically to avoid colliding with seed-minted SKU-001..00N; comment notes this is defensive since the suite normally reseeds.

**Cross-domain deps**
- e2e/fixtures/copy.ts imports/mirrors @pashwashah04/fabtraq-shared's SKU_ANSWER_REQUIRED_MESSAGE-family constants by hand (comment: 'these constants are the drift-detection ... deliberate mirror', per docs/backlog.md:834-836) — no actual package import, a manually-synced string; drifts silently if shared changes wording.
- e2e/fixtures/db.ts talks directly to Postgres via `pg` (bypasses Prisma and the BE's HTTP API) against table `stock_ledger` — couples the harness to BE's DB schema/column names (quality_id, sku_id, lot_number, location_id, floor_id, job_worker_id) independent of any BE code path.
- playwright.config.ts webServer boots fabtraq-be (`npm --prefix ../fabtraq-be run dev`), fabtraq-fe (`npm --prefix ../fabtraq-fe run dev`), and fabtraq-pdf-parser (`npm --prefix ../fabtraq-pdf-parser run dev`) — harness owns lifecycle of 3 external repos/services.
- npm run e2e (e2e/package.json) shells out to `fabtraq-be`'s own db:reset/db:seed scripts — harness has no seed logic of its own for the full-suite path, it delegates entirely to BE's seed.ts.
- tests/flows/*.spec.ts (26 specs, 11217 lines) exercise nearly every BE/FE feature domain (yarn-purchase, jw-in/out, beams, placement, inventory, weaving, fabric-taka, wastage, trace) — this candidate's 'E2E: tests/flows' scope overlaps essentially all other product domains' test footprints, not a separable slice.

**Known debt**
- B-043 (docs/backlog.md, Open, Medium, logged 2026-08-26) — the e2e script's DB-reset target (via E2E_BE_DIR's .env) and fixtures/env.ts's DATABASE_URL default can point at different databases with nothing checking agreement; concrete incident: pointing only the server at fabtraq_test left fixtures reading fabtraq_dev, producing 81 passed/55 failed that looked like a real regression (128/8 once DATABASE_URL was aligned). Proposed fix: derive both from one source and fail fast on disagreement; consider defaulting to fabtraq_test with explicit opt-in for fabtraq_dev.
- B-043 addendum — `npm run e2e | tail` reports tail's exit code, not the suite's; a red run can read as green when piped.
- B-027 (docs/backlog.md, Open, logged 2026-08-14) — low-rate (~1-in-3 full runs) load-sensitive timeout flake, different spec each time, root-caused to machine resource contention (Vite/pdf-parser starved under low free memory), not a product regression; proposed fix is raising toast/visibility timeouts and/or a longer pdf-parser webServer readiness timeout.
- docs/backlog.md B-028 note — `e2e` package has no Prettier configuration at all (deliberately untouched during the repo-wide format pass because the shared docs tree can't converge across 4 repos + the e2e-only code isn't covered).
