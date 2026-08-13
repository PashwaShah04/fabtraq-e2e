# Fabric Taka Register — cross-repo locked contract

**Spec:** `docs/superpowers/specs/2026-08-14-fabric-taka-register-design.md` (v2)
**Brainstorm:** `docs/brainstorms/2026-08-14-fabric-taka-register.md` (FTR-L1…L14)

Every name below is **LOCKED**. Per-repo plans are written against this table, not against each
other. If an implementer finds the installed package disagrees, fix this table first (one-line
diff), then proceed — never silently adapt call sites around a mismatch.

## Repo order

`shared` → `be` → `fe` → `e2e`. BE and FE consume shared via a dev tarball until publish:
`npm i --no-save ../fabtraq-shared/pashwashah04-fabtraq-shared-1.16.0.tgz`, then
`rm -rf fabtraq-fe/node_modules/.vite` (stale dep-cache rule).

## Shared package (→ 1.16.0)

All additions go in the **existing** `src/schemas/transaction/weaving-in.ts` and
`src/registry/transaction/weaving-ins.registry.ts`. No new schema file.

| Name | Kind | Shape |
|---|---|---|
| `createFabricTakaSchema` | **MODIFY** (existing, `:46-57`) | Add a `.superRefine` making `locationId`/`floorId` **both-or-neither**. Issue path `['floorId']`, message `'Location and floor must be set together.'` Existing refinements unchanged. |
| `fabricTakaRegisterRowSchema` | NEW | `fabricTakaResponseSchema.omit({ beamLinks: true }).extend({ weavingInId: weavingInIdSchema, challanNo: z.string(), paperChallanNo: z.string().nullable(), date: z.string(), jobWorkerId: jobWorkerIdSchema, jobWorkerName: z.string() })` |
| `FabricTakaRegisterRow` | type | `z.infer<typeof fabricTakaRegisterRowSchema>` |
| `fabricTakaDetailSchema` | NEW | `fabricTakaRegisterRowSchema.extend({ beamLinks: z.array(weavingInTakaBeamResponseSchema) })` |
| `FabricTakaDetail` | type | `z.infer<...>` |
| `fabricTakaListQuerySchema` | NEW | `.object({ search: z.string().optional(), fabricDesignId: fabricDesignIdSchema.optional(), jobWorkerId: jobWorkerIdSchema.optional(), weavingInId: weavingInIdSchema.optional(), placement: z.enum(['placed','unplaced']).optional(), status: z.enum(['received','cancelled','all']).optional() }).merge(paginationQuerySchema.partial())` |
| `FabricTakaListQuery` | type | `z.infer<...>` |
| `placeFabricTakasSchema` | NEW | `.object({ takaIds: z.array(fabricTakaIdSchema).min(1,'Select at least one taka.').max(50,'Place at most 50 taka at a time.').refine(a => new Set(a).size === a.length, 'Duplicate taka ids.'), locationId: locationIdSchema, floorId: locationFloorIdSchema })` — both **required**, not optional |
| `PlaceFabricTakasInput` | type | `z.infer<...>` |
| `listFabricTakas` | registry | `GET /fabric-takas`, query `fabricTakaListQuerySchema`, response `pageOfSchema(fabricTakaRegisterRowSchema)`, auth-only (all three roles) |
| `getFabricTakaById` | registry | `GET /fabric-takas/:id`, `pathParamsSchema: uuidIdParamsSchema`, response `fabricTakaDetailSchema`, auth-only |
| `placeFabricTakas` | registry | `POST /fabric-takas/place`, body `placeFabricTakasSchema`, response `z.object({ placed: z.number().int() })`, roles `['owner','storekeeper']`, CSRF |

**Do NOT** add `logMany` to any audit interface. **Do NOT** add a weaver component to the `TK-`
serial — `weaving-in.mapper.ts:28` is unchanged.

## BE

- **No new repository.** Three methods go on the existing `IWeavingInRepository`
  (`weaving-in.repository.ts`) + `PrismaWeavingInRepository`: `listFabricTakas(params, tx?)`,
  `findFabricTakaById(id, tx?)`, `placeFabricTakas(takaIds, locationId, floorId, tx)`.
- **New:** `FabricTakaService` (`src/modules/weaving-in/fabric-taka.service.ts`) and
  `fabric-taka.routes.ts` with `MOUNT_PREFIX = '/fabric-takas'`, registered in `app.ts`.
- **Extract, do not create:** lift `weaving-in.mapper.ts:22-46`'s taka closure into
  `export const mapFabricTakaRow = (t: FabricTakaRow, fy: string): FabricTakaResponse`.
  `mapWeavingInRow` calls it; the register mapper spreads receipt context on top. Frame as
  extraction of existing code.
- **Shared guard helper:** `assertLocationFloorActive(locationId, floorId, tx)` — used by BOTH
  `WeavingInService.createTx` (§3.0) and `FabricTakaService.place` (§3.4 step 3).
- `WeavingInService.cancel` additionally nulls `locationId`/`floorId` + writes per-taka audit rows.
- Ordering: `[{ weavingIn: { date: 'desc' } }, { takaNo: 'desc' }, { id: 'asc' }]` — the `id` term
  is **required for correctness**.
- Audit: `AuditService.record('update', 'FabricTaka', id, old, new, { ...ctx, tx })`. Entity type
  string is exactly `'FabricTaka'`.
- Permissions row added to `tests/integration/permissions-matrix.routes.test.ts`.

## FE

- **No new feature folder.** Everything under `src/features/weaving-ins/`, extending its `api.ts`,
  `hooks.ts`, `query-keys.ts`. Routes are still `/fabric-takas` and `/fabric-takas/:id`.
- New files: `fabric-taka-register.page.tsx`, `fabric-taka-detail.page.tsx`,
  `fabric-taka-columns.tsx`, `components/PlaceTakaDialog.tsx`.
- Templates: `features/placements/place-stock-queue.page.tsx:16-107` (URL search + debounce +
  DataTable) and `features/inventory/inventory-lots.page.tsx:36-160` (multi-filter PARAM/buildQuery/
  setParams — heed its `:98-105` sequential-setSearchParams bug). **NOT** `beam-list.page.tsx`
  (no URL state → the deep link would be ignored).
- `PlaceTakaDialog` uses `shared/components/LocationFloorSelect.tsx` verbatim (4 props, omit
  `excludeFloorIds`). **Never** `AvailableFloorSelect`.
- Selection: `Set<FabricTakaId>` held in the page; native `<input type="checkbox">`
  (`job-worker-form.page.tsx:279-289` precedent) inside a column cell with `stopPropagation`.
  **`DataTable.tsx` is not modified.**
- Search box: `DataTable`'s own `search`/`onSearchChange` props. No new input.
- Roll identifier helper (FE, shared by both pages):
  `takaLabel(row) = row.paperSerialNo !== null ? \`${row.challanNo} / ${row.paperSerialNo}\` : \`${row.challanNo} / #${row.takaNo}\``.
- Weaving-in form header gains an optional `LocationFloorSelect`; its value maps onto **every**
  taka row in `mapFormToCreateWeavingInInput`.
- Fabric tab: rows link `/fabric-takas?fabricDesignId=<id>`; count column relabelled `Received`.
- Nav: `Inventory → Fabric Takas`, after `Lots`.

## e2e

- Add `/fabric-takas` to `tests/smoke/routes.spec.ts` ROUTES and to `tests/guards/role-guards.spec.ts`.
- New `tests/flows/fabric-taka-register.spec.ts`, seeded from the receipt flow already in
  `tests/flows/weaving-in.spec.ts`.
- **Ledger deltas, never absolutes** (README.md:77) — though this feature writes no ledger rows, the
  Fabric-tab placed/unplaced assertions must be **deltas** for the same repeat-run reason.
- Full `npm run e2e` resets + reseeds `fabtraq_dev`; single-spec runs do not.

## Global constraints (all repos)

- Node 22, strict TS, no `.js` import extensions, no `any`, no `console.*` in `src/`.
- Compute in app, never aggregate in DB.
- Registry-first (B-004) for every new endpoint.
- Conventional commits + `Co-Authored-By: RuFlo <ruv@ruv.net>`.
- Per-repo bar at every task boundary: `lint && typecheck && test && build`; BE DB tasks also run
  `test:integration` (**which truncates `fabtraq_dev` — re-seed after and say so**).
- Role-gated UI ships with both-branch tests in the same change.
