# JW-Out Placement Conservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible to save a JW-Out challan whose net weight is not fully allocated to floors that actually hold the stock.

**Architecture:** Three checks (see spec §3). Check 2 (`Σ placements === netWeight`) is the load-bearing one and is enforced twice — once in the `fabtraq-shared` zod schema (covers both HTTP routes and both FE forms in a single edit) and once as a service guard in `JwChallanOutService` (covers the internal `createIn` caller and unit-test inputs that never touch zod). Check 1 (`netWeight ≤ lot's on-floor balance`) is FE-only fast feedback — it is mathematically implied on the backend by checks 2 + 3. Check 3 already exists and is untouched.

**Tech Stack:** zod (shared schemas), TypeScript strict, Express 5 + Prisma 5 (BE), React 18 + react-hook-form + zodResolver (FE), vitest everywhere, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md` — read it before Task 1.

## Global Constraints

- Node 22 only. npm only. No new dependencies.
- No `any`, no `.js` import extensions, no default exports, no `console.*`.
- `fabtraq-shared` version: **1.16.0 → 1.17.0**. Published to GitHub Packages; BE and FE install from the registry, not a tarball. Minor, not major, matching the repo's precedent for wire-tightening changes (1.8.0 dropped `challan_out_id` end-to-end). Consumers are **only** `fabtraq-be` and `fabtraq-fe` (both pin `^1.16.0`); `e2e`, `fabtraq-pdf-parser` and `fabtraq-deploy` do not depend on it, so they need no install step.
- Conservation tolerance is **0.001**, matching `CONSERVATION_TOLERANCE_KG` in `jw-challan-in.ts:30` and `TOLERANCE_KG` in `ConservationBar.tsx:1`. Define it as a file-local `const` per the existing per-file convention (`weaving-in.ts:34` does the same) — do NOT export a cross-file constant.
- Zod issue path for check 2 is **`['netWeight']`**, never `['placements']`. Both FE rows already render a `FieldError` on `netWeight`; nothing renders array-level placement errors.
- No Prisma migration. No response-shape change. Request validation only.
- Commit after each task. **Do not push** — pushes are batched at the end on the user's go.
- `npm run test:integration` in `fabtraq-be` **truncates the live `fabtraq_dev` database** the dev server uses. Re-seed after running it and tell the user.

---

### Task 1: Shared — conservation refine on the JW-Out item

**Files:**
- Modify: `fabtraq-shared/src/schemas/transaction/jw-challan-out.ts:56-71`
- Modify: `fabtraq-shared/tests/schemas/transaction/jw-challan-out.test.ts:89-103`
- Modify: `fabtraq-shared/package.json` (version)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createJwChallanOutItemSchema` becomes a `ZodEffects<ZodObject<...>>` rather than a `ZodObject`. `CreateJwChallanOutItemInput` (the inferred type) is **unchanged**. Both existing consumers wrap it in `z.array(...)` (`jw-challan-out.ts:85`, `weaving-dispatch.ts:43`) so no `.extend()`/`.omit()`/`.partial()` call breaks. Do not add one.

- [ ] **Step 1: Invert the test that asserts the old behaviour**

Replace the existing test at `tests/schemas/transaction/jw-challan-out.test.ts:89-103` (currently `'accepts empty placements on item (created pending; placed later via place-stock queue — L11/L14)'`) with:

```ts
  it('rejects empty placements on item — outbound must be fully allocated (2026-08-20 spec, amends L14)', () => {
    const result = createJwChallanOutSchema.safeParse({
      ...VALID_BODY,
      items: [
        {
          qualityId: QUALITY_ID,
          sourceLotNumber: 'LOT-260301-0001',
          netWeight: 100,
          unit: 'KG',
          placements: [],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['items', 0, 'netWeight']);
    expect(result.error.issues[0]?.message).toContain('add up to the net weight');
  });

  it('rejects placements that under-allocate the net weight', () => {
    const result = createJwChallanOutSchema.safeParse({
      ...VALID_BODY,
      items: [
        {
          qualityId: QUALITY_ID,
          sourceLotNumber: 'LOT-260301-0001',
          netWeight: 100,
          unit: 'KG',
          placements: [{ ...VALID_PLACEMENT, quantity: 60 }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects placements that over-allocate the net weight', () => {
    const result = createJwChallanOutSchema.safeParse({
      ...VALID_BODY,
      items: [
        {
          qualityId: QUALITY_ID,
          sourceLotNumber: 'LOT-260301-0001',
          netWeight: 100,
          unit: 'KG',
          placements: [{ ...VALID_PLACEMENT, quantity: 140 }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts placements split across floors that sum to the net weight', () => {
    const parsed = createJwChallanOutSchema.parse({
      ...VALID_BODY,
      items: [
        {
          qualityId: QUALITY_ID,
          sourceLotNumber: 'LOT-260301-0001',
          netWeight: 100,
          unit: 'KG',
          placements: [
            { ...VALID_PLACEMENT, quantity: 70 },
            { ...VALID_PLACEMENT, floorId: FLOOR_ID_2, quantity: 30 },
          ],
        },
      ],
    });
    expect(parsed.items[0]?.placements).toHaveLength(2);
  });

  it('accepts a sum inside the 0.001 tolerance', () => {
    const parsed = createJwChallanOutSchema.parse({
      ...VALID_BODY,
      items: [
        {
          qualityId: QUALITY_ID,
          sourceLotNumber: 'LOT-260301-0001',
          netWeight: 100,
          unit: 'KG',
          placements: [{ ...VALID_PLACEMENT, quantity: 99.9995 }],
        },
      ],
    });
    expect(parsed.items[0]?.netWeight).toBe(100);
  });
```

The split-floor test needs a second floor id. Add it beside the existing id constants near the top of the file (after `const FLOOR_ID = ...` on line 15):

```ts
const FLOOR_ID_2 = '00000000-0000-0000-0000-000000000021';
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd fabtraq-shared && npx vitest run tests/schemas/transaction/jw-challan-out.test.ts
```

Expected: the four new rejection/acceptance tests fail. Specifically, the two `rejects…` tests fail with `expected true to be false` because the schema currently accepts everything.

- [ ] **Step 3: Add the refine**

In `src/schemas/transaction/jw-challan-out.ts`, add the tolerance constant immediately above `createJwChallanOutItemSchema` (i.e. just after the `// ─── Create body ───` banner on line 56):

```ts
/** Float-sum equality tolerance for the placement-conservation superRefine below. */
const CONSERVATION_TOLERANCE_KG = 0.001;
```

Then replace the trailing `});` of `createJwChallanOutItemSchema` (line 70) and the comment block on lines 67-68 so the schema reads:

```ts
export const createJwChallanOutItemSchema = z
  .object({
    qualityId: yarnQualityIdSchema,
    skuId: yarnSkuIdSchema.optional(),
    sourceLotNumber: lotNumberSchema,
    bagCount: optionalFiniteNumber().pipe(z.number().int().min(0).optional()),
    cones: optionalFiniteNumber().pipe(z.number().int().min(0).optional()),
    grossWeight: optionalFiniteNumber().pipe(quantitySchema.optional()),
    netWeight: quantitySchema,
    unit: unitSchema,
    /**
     * Outbound placements are the floors the stock is PULLED FROM, so they are
     * mandatory and must account for the whole net weight — see the superRefine
     * below. This is the outbound half of L14: inbound items (yarn-purchase,
     * JW-In) still allow `Σ ≤ qty` because their unplaced remainder is ledgered
     * into the awaiting-placement bucket. Outbound has no such bucket, so an
     * unallocated quantity would leave the building without moving any stock.
     * Amends L14; see docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md.
     */
    placements: placementInputSchema.array(),
  })
  .superRefine((item, ctx) => {
    const placed = item.placements.reduce((acc, p) => acc + p.quantity, 0);
    if (Math.abs(placed - item.netWeight) > CONSERVATION_TOLERANCE_KG) {
      ctx.addIssue({
        code: 'custom',
        path: ['netWeight'],
        message: `Placements must add up to the net weight — ${placed} of ${item.netWeight} ${item.unit} allocated.`,
      });
    }
  });
```

- [ ] **Step 4: Run the full shared suite**

```bash
cd fabtraq-shared && npm run test
```

Expected: PASS, including `tests/schemas/transaction/weaving-dispatch.test.ts` (its weft fixture at line 24-26 already conserves: `netWeight: 50`, one placement of `50`).

- [ ] **Step 5: Lint, typecheck, build**

```bash
cd fabtraq-shared && npm run lint && npm run typecheck && npm run build
```

Expected: all clean. If `typecheck` reports a missing `.extend()`/`.omit()` on `createJwChallanOutItemSchema`, STOP — an unexpected consumer exists that the spec's §3.3 survey missed; report it before continuing.

- [ ] **Step 6: Bump the version**

In `fabtraq-shared/package.json` change `"version": "1.16.0"` to `"version": "1.17.0"`.

- [ ] **Step 7: Commit**

```bash
cd fabtraq-shared && git add src/schemas/transaction/jw-challan-out.ts tests/schemas/transaction/jw-challan-out.test.ts package.json
git commit -m "feat: require JW-Out placements to conserve net weight

Outbound placements are pull-side, so an unallocated quantity dispatches
stock without moving any. Amends L14 for outbound only; inbound keeps the
awaiting-placement bucket.

Refs docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md"
```

- [ ] **Step 8: Publish**

```bash
cd fabtraq-shared && npm publish
npm view @pashwashah04/fabtraq-shared version
```

Expected: prints `1.17.0`. Do not proceed to Task 2 until it does.

---

### Task 2: BE — service-layer conservation guard

**Files:**
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts` (add private method; call it from `createIn`)
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.test.ts`
- Modify: `fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.test.ts:213-220`
- Modify: `fabtraq-be/package.json` (shared dependency version)

**Interfaces:**
- Consumes: `createJwChallanOutItemSchema` from Task 1 (via the installed 1.17.0 package). The service guard duplicates the schema's invariant on purpose — it is the caller-proof half.
- Produces: a `BusinessRuleError` with `details.code === 'PLACEMENT_NOT_CONSERVED'`, surfaced by the global error middleware as HTTP 422. Note that in practice the route never reaches it — Task 1's schema rejects the same payload with a 400 at the validate middleware first. The guard exists for `createIn`'s internal caller, so only the unit tests in this task exercise it directly.

- [ ] **Step 1: Install shared 1.17.0**

```bash
cd fabtraq-be && npm install @pashwashah04/fabtraq-shared@1.17.0
```

- [ ] **Step 2: Write the failing tests**

Add to `src/modules/jw-challan-out/jw-challan-out.service.test.ts`, inside the `describe('JwChallanOutService.create', ...)` block. Note these build the input **by hand** rather than through `createJwChallanOutSchema.parse` — the whole point is to prove the service rejects inputs zod never saw:

```ts
  // -------------------------------------------------------------------------
  // Placement conservation (2026-08-20 spec) — guards the internal createIn
  // caller (WeavingDispatchService) and any input that bypassed zod.
  // -------------------------------------------------------------------------

  it('throws PLACEMENT_NOT_CONSERVED when an item has no placements', async () => {
    const input = {
      ...makeValidInput(),
      items: [
        {
          qualityId: QUALITY_ID,
          sourceLotNumber: LOT_A,
          netWeight: 100,
          unit: 'KG' as const,
          placements: [],
        },
      ],
    } as unknown as CreateJwChallanOutInput;

    service = new JwChallanOutService(repo, prisma, auditService, inventory);

    await expect(service.create(input, makeCtx())).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof BusinessRuleError)) return false;
      const details = err.details as { code?: string } | undefined;
      return details?.code === 'PLACEMENT_NOT_CONSERVED';
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('throws PLACEMENT_NOT_CONSERVED when placements under-allocate the net weight', async () => {
    const input = {
      ...makeValidInput(),
      items: [
        {
          qualityId: QUALITY_ID,
          sourceLotNumber: LOT_A,
          netWeight: 100,
          unit: 'KG' as const,
          placements: [{ locationId: LOCATION_ID, floorId: FLOOR_ID, quantity: 60, unit: 'KG' }],
        },
      ],
    } as unknown as CreateJwChallanOutInput;

    service = new JwChallanOutService(repo, prisma, auditService, inventory);

    await expect(service.create(input, makeCtx())).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof BusinessRuleError)) return false;
      const details = err.details as { code?: string } | undefined;
      return details?.code === 'PLACEMENT_NOT_CONSERVED';
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('runs the conservation guard before any balance query (fail fast)', async () => {
    const input = {
      ...makeValidInput(),
      items: [
        {
          qualityId: QUALITY_ID,
          sourceLotNumber: LOT_A,
          netWeight: 100,
          unit: 'KG' as const,
          placements: [],
        },
      ],
    } as unknown as CreateJwChallanOutInput;

    service = new JwChallanOutService(repo, prisma, auditService, inventory);

    await expect(service.create(input, makeCtx())).rejects.toThrow(BusinessRuleError);
    expect(inventory.findLotLocationBalance).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run them to verify they fail**

```bash
cd fabtraq-be && npx vitest run src/modules/jw-challan-out/jw-challan-out.service.test.ts
```

Expected: the three new tests fail. The first two fail because `service.create` resolves instead of rejecting; the third fails because `findLotLocationBalance` was never called for a *different* reason (there are no placements to loop over) — it may pass accidentally at this step. That is fine; it becomes meaningful once the guard exists.

- [ ] **Step 4: Add the guard**

In `src/modules/jw-challan-out/jw-challan-out.service.ts`, add a file-local constant just below the imports (after line 33, before the `/** Application service … */` docblock):

```ts
/** Float-sum equality tolerance for the placement-conservation guard. */
const CONSERVATION_TOLERANCE_KG = 0.001;
```

Add this private method to the class, immediately above `assertLotBalances` (before line 539):

```ts
  /**
   * Guards that every item's placements account for its FULL net weight
   * (2026-08-20 spec §3.2). Outbound placements are pull-side: an item whose
   * placements do not add up dispatches stock that leaves no ledger trace and
   * never reduces the source lot, so the lot can be issued twice.
   *
   * Duplicated deliberately from the `createJwChallanOutItemSchema` superRefine
   * in @pashwashah04/fabtraq-shared. The schema covers the two HTTP routes; this
   * covers `createIn`'s internal caller (WeavingDispatchService.create) and any
   * input constructed without parsing.
   *
   * Runs BEFORE assertLotBalances so a malformed item fails without incurring
   * the per-floor balance queries.
   */
  private assertPlacementConservation(input: CreateJwChallanOutInput): void {
    for (const item of input.items) {
      const placed = item.placements.reduce((acc, pl) => acc + pl.quantity, 0);
      if (Math.abs(placed - item.netWeight) > CONSERVATION_TOLERANCE_KG) {
        throw new BusinessRuleError(
          `Placements for lot ${item.sourceLotNumber} must add up to the net weight: ${placed} of ${item.netWeight} ${item.unit} allocated.`,
          {
            details: {
              code: 'PLACEMENT_NOT_CONSERVED',
              lotNumber: item.sourceLotNumber,
              netWeight: item.netWeight,
              placed,
              unit: item.unit,
            },
          },
        );
      }
    }
  }
```

Then call it in `createIn`. Replace the step-3 comment and call (lines 107-108) with:

```ts
    // 3. Guard: every item's placements must account for its full net weight.
    //    Runs before the balance queries — see assertPlacementConservation.
    this.assertPlacementConservation(input);

    // 3b. Validate balance per source lot at each pulled floor.
    await this.assertLotBalances(input, tx);
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd fabtraq-be && npx vitest run src/modules/jw-challan-out/jw-challan-out.service.test.ts
```

Expected: PASS. All pre-existing tests in this file already conserve (verified: the fixtures at lines 148-162, 302-315, 332-350, 368-386, 444-462, 495-510, 531-542, 577-590, 612-623 each have `netWeight` equal to their placement sum), so none should break. If one does, do NOT relax the guard — fix the fixture to conserve.

- [ ] **Step 6: Fix the weaving-dispatch test fixture**

`src/modules/weaving-dispatch/weaving-dispatch.service.test.ts:213-220` builds a weft item with `netWeight: 50` and `placements: []`. It currently passes only because `jwChallanOutService.createIn` is mocked there, so it never reaches the guard — but it encodes an input that is now impossible. Make it honest:

```ts
        items: [
          {
            qualityId: 'q-1',
            sourceLotNumber: 'LOT-260301-0001',
            netWeight: 50,
            unit: 'KG',
            placements: [
              { locationId: LOCATION_ID, floorId: FLOOR_ID, quantity: 50, unit: 'KG' },
            ],
          },
        ],
```

If `LOCATION_ID` / `FLOOR_ID` are not already defined in that file, add them beside the other id constants:

```ts
const LOCATION_ID = '00000000-0000-0000-0000-000000000010';
const FLOOR_ID = '00000000-0000-0000-0000-000000000020';
```

- [ ] **Step 7: Run the full BE unit suite**

```bash
cd fabtraq-be && npm run test
```

Expected: PASS. This does not touch the database.

- [ ] **Step 8: Lint, typecheck, build**

```bash
cd fabtraq-be && npm run lint && npm run typecheck && npm run build
```

- [ ] **Step 9: Commit**

```bash
cd fabtraq-be && git add src/modules/jw-challan-out/jw-challan-out.service.ts src/modules/jw-challan-out/jw-challan-out.service.test.ts src/modules/weaving-dispatch/weaving-dispatch.service.test.ts package.json package-lock.json
git commit -m "feat: guard JW-Out placement conservation in the service layer

Covers WeavingDispatchService.create, which composes createIn directly and
so never passes through the route's zod validation.

Refs docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md"
```

---

### Task 3: BE — integration test for the HTTP boundary

**Files:**
- Modify: `fabtraq-be/tests/integration/jw-challan-out.routes.test.ts` — add beside the existing `'returns 400 on zod validation error (missing required field)'` test at line 417, reusing that describe block's `agent`, `csrfToken`, and seeded `jobWorkerId`/`qualityId`/`lotNumber` from the happy-path create test at line 269.

**Interfaces:**
- Consumes: `details.code === 'PLACEMENT_NOT_CONSERVED'` from Task 2, and the shared schema's `['items', 0, 'netWeight']` issue path from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Follow the file's existing pattern for authenticating and seeding (reuse its login helper and whatever quality/job-worker/lot fixtures the neighbouring create tests use — do not invent new ones). Add:

```ts
  it('rejects a create whose item placements do not add up to the net weight', async () => {
    const res = await agent
      .post('/jw-challans-out')
      .set('X-CSRF-Token', csrfToken)
      .send({
        date: '2026-08-20T00:00:00.000Z',
        jobWorkerId,
        jobWorkTypes: ['twisting'],
        items: [
          {
            qualityId,
            sourceLotNumber: lotNumber,
            netWeight: 100,
            unit: 'KG',
            placements: [],
          },
        ],
      });

    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd fabtraq-be && npm run test:integration -- jw-challan-out.routes
```

Expected: FAIL with `expected 201 to be 400`.

**WARNING:** this command truncates `fabtraq_dev`, the database the dev server uses. Expect to re-seed at Step 4.

- [ ] **Step 3: Confirm it passes**

No new implementation is needed — Task 1's schema already rejects this at the validate middleware. Re-run:

```bash
cd fabtraq-be && npm run test:integration -- jw-challan-out.routes
```

Expected: PASS.

- [ ] **Step 4: Re-seed the dev database and warn the user**

```bash
cd fabtraq-be && npm run prisma:seed
```

Then tell the user in chat: "Ran BE integration tests — `fabtraq_dev` was truncated and re-seeded. Any test data you had in the UI is gone."

- [ ] **Step 5: Commit**

```bash
cd fabtraq-be && git add tests/integration
git commit -m "test: assert 400 when JW-Out placements do not conserve net weight"
```

---

### Task 4: FE — check 1, cap the weight by the lot's on-floor balance

**Files:**
- Modify: `fabtraq-fe/src/features/jw-challans-out/components/ChallanOutLineItemRow.tsx:186-191`
- Modify: `fabtraq-fe/src/features/weaving-dispatches/components/WeftLineItemRow.tsx:173-178`
- Create: `fabtraq-fe/tests/integration/features/jw-challans-out/lot-balance-cap.test.tsx`
- Modify: `fabtraq-fe/package.json` (shared dependency version)

**Interfaces:**
- Consumes: the `availableFloors` state already present in both rows — `AvailableFloor[]` with shape `{ locationId, locationName, floorId, floorName, available: number }` (`AvailableFloorSelect.tsx:12-18`), populated from `SourceLotPicker`'s `lot.placements[].balance`.
- Produces: nothing later tasks depend on.

**Design note — this error is display-only, and that is deliberate.** It is not registered as a react-hook-form error and does not itself block submit. It matches the existing precedent in `PlacementFieldArray.tsx:170-176`, where `computePlacementRowGuard`'s over-pull error is also display-only with the backend authoritative. Saving is still impossible: to submit, check 2 forces the placements to sum to the over-large weight, and those placements cannot be drawn from floors that do not hold the stock (check 3, backend). Do not fight react-hook-form to turn this into a blocking error — a manual `setError` is wiped by the next `zodResolver` pass.

- [ ] **Step 1: Install shared 1.17.0 and clear the Vite dep cache**

```bash
cd fabtraq-fe && npm install @pashwashah04/fabtraq-shared@1.17.0 && rm -rf node_modules/.vite
```

The cache clear is required — Vite otherwise serves the previously bundled copy of the shared schema and the new refine silently will not run in the dev server.

- [ ] **Step 2: Write the failing test**

`availableFloors` is component-internal state, set only by `SourceLotPicker`'s `onChange`. Do not add a test-only prop to inject it — drive the real picker against the MSW fixture instead. `tests/msw/handlers/inventory.ts:380-413` already exposes `mockAggregatedLotMultiFloor`: lot `LOT-260115-0003`, quality `Cotton 40s`, SKU `White`, with **500 KG on Ground Floor + 500 KG on First Floor = 1000 KG** on floors. That is the fixture this test uses.

Create `tests/integration/features/jw-challans-out/lot-balance-cap.test.tsx`. Copy the render harness (QueryClient wrapper, router, jsdom Radix polyfills) from the neighbouring `form.page.test.tsx` — do not invent a new one.

**The lot picker is doubly gated — you must satisfy both gates or the lot never appears.** `InventoryLotSelect.tsx:69,104` disables the select until `qualityId !== ''` AND the `ready` prop is true, and `SourceLotPicker` passes `ready` from "job work types chosen" (L18). So each test must select the **job work type** and the **quality** before the lot. `mockAggregatedLotMultiFloor` carries `qualityName: 'Cotton 40s'` — that is the quality to pick. Skipping it makes the first test fail with "lot not found", which looks exactly like the feature not working; do not misdiagnose it.

```tsx
describe('JW-Out form — lot balance cap (check 1, 2026-08-20 spec §3.1)', () => {
  it('warns when the net weight exceeds the lot total across floors', async () => {
    renderForm();

    await selectJobWorkType('twisting');   // L18 readiness gate
    await selectQuality('Cotton 40s');     // qualityId gate
    await selectSourceLot('LOT-260115-0003');

    const netWeight = await screen.findByRole('spinbutton', { name: /net weight/i });
    await userEvent.clear(netWeight);
    await userEvent.type(netWeight, '1500');

    // 500 + 500 from mockAggregatedLotMultiFloor.
    expect(await screen.findByText(/only 1000 KG available in this lot/i)).toBeInTheDocument();
  });

  it('shows no warning when the net weight is within the lot total', async () => {
    renderForm();

    await selectJobWorkType('twisting');
    await selectQuality('Cotton 40s');
    await selectSourceLot('LOT-260115-0003');

    const netWeight = await screen.findByRole('spinbutton', { name: /net weight/i });
    await userEvent.clear(netWeight);
    await userEvent.type(netWeight, '800');

    await waitFor(() => {
      expect(screen.queryByText(/available in this lot/i)).not.toBeInTheDocument();
    });
  });
});
```

`selectJobWorkType`, `selectQuality` and `selectSourceLot` are local helpers you write in this file: they open the `JobWorkTypeMultiSelect`, the quality select, and the combobox labelled `Source lot for line 1` respectively, and pick by visible label. Before asserting on the lot's option text, read `src/shared/lib/lot-labels.ts` — lot labels come from that canonical vocabulary and always lead with the lot number, so a substring match on `LOT-260115-0003` is the safe selector. The file also needs the jsdom Radix polyfills (`hasPointerCapture`, `scrollIntoView`, `releasePointerCapture`) at module scope — copy them from `floor-pull.test.tsx:19-22` or every select interaction will throw.

- [ ] **Step 3: Run it to verify it fails**

```bash
cd fabtraq-fe && npx vitest run tests/integration/features/jw-challans-out/lot-balance-cap.test.tsx
```

Expected: the first test FAILS (no such warning text is rendered); the second passes vacuously.

- [ ] **Step 4: Implement the cap**

In `ChallanOutLineItemRow.tsx`, add below the existing `netWeight` watch (line 63):

```tsx
  // Check 1 (2026-08-20 spec §3.1) — fast feedback at the weight field. The
  // FE already holds every floor balance for the picked lot, so this costs no
  // request. Display-only by design: checks 2 + 3 do the actual blocking.
  const lotFloorBalance =
    availableFloors === undefined
      ? undefined
      : availableFloors.reduce((sum, f) => sum + f.available, 0);
  const overLotBalance =
    lotFloorBalance !== undefined &&
    typeof netWeight === 'number' &&
    Number.isFinite(netWeight) &&
    netWeight > lotFloorBalance + 0.001;
```

Then replace the `FieldError` on line 190 with:

```tsx
        <FieldError
          message={
            overLotBalance === true && lotFloorBalance !== undefined
              ? `Only ${lotFloorBalance} ${unit} available in this lot`
              : itemErrors?.netWeight?.message
          }
        />
```

`unit` is already in scope in both rows (it drives the unit `<Select>` — `ChallanOutLineItemRow.tsx:194`), so no new watch is needed.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd fabtraq-fe && npx vitest run tests/integration/features/jw-challans-out/lot-balance-cap.test.tsx
```

Expected: PASS (both cases).

- [ ] **Step 6: Apply the identical change to the weft row**

`WeftLineItemRow.tsx` has the same `availableFloors` state (line 45), the same `netWeight` watch (line 51), and the same `FieldError` (line 177). Make the same edit there, with field paths prefixed `weft.items.${index}.…`.

The duplicated block is ~8 lines across two files. Leave it duplicated — the two rows already duplicate the lot-picker, placement-array, and netWeight wiring wholesale, and extracting a shared hook for this one derived value would be the only shared abstraction between them. If a third caller ever appears, extract then.

Add `tests/integration/features/weaving-dispatches/weft-lot-balance-cap.test.tsx` mirroring Step 2's two cases against the same `LOT-260115-0003` fixture, using the weaving-dispatch form's own render harness from the neighbouring tests in that folder.

- [ ] **Step 7: Run the full FE suite**

```bash
cd fabtraq-fe && npm run test
```

- [ ] **Step 8: Lint, typecheck, build**

```bash
cd fabtraq-fe && npm run lint && npm run typecheck && npm run build
```

- [ ] **Step 9: Commit**

```bash
cd fabtraq-fe && git add src/features/jw-challans-out src/features/weaving-dispatches tests/integration/features/jw-challans-out tests/integration/features/weaving-dispatches package.json package-lock.json
git commit -m "feat: warn when JW-Out net weight exceeds the lot's on-floor balance

Check 1 of the 2026-08-20 conservation spec — fast feedback at the weight
field using balances the form already holds. Display-only; checks 2 and 3
block the save.

Refs docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md"
```

---

### Task 5: FE — integration test that check 2 blocks the save

**Files:**
- Modify: `fabtraq-fe/tests/integration/features/jw-challans-out/form.page.test.tsx` — add beside the existing `'submits successfully with all optional fields blank (no dirty fields in body)'` test at line 154, reusing that test's render harness and submit-spy.

**Interfaces:**
- Consumes: the shared refine from Task 1, surfaced through `zodResolver` at `items.N.netWeight`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Follow the file's existing setup (MSW server, memory router, `QueryClientProvider`). Add:

```tsx
  it('blocks submit and flags the weight field when placements are not added', async () => {
    renderForm();

    // Fill the header + one line item, but add no placements.
    await fillValidHeader();
    await userEvent.type(screen.getByLabelText(/net weight/i), '100');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/add up to the net weight/i)).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });
```

`fillValidHeader` and `createSpy` should reuse whatever the neighbouring happy-path test in this file already defines; do not add parallel helpers.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd fabtraq-fe && npx vitest run tests/integration/features/jw-challans-out/form.page.test.tsx
```

Expected: FAIL — the form currently submits.

- [ ] **Step 3: Confirm it passes**

No implementation needed; Task 1's refine already produces this. Re-run the command from Step 2. Expected: PASS.

If the message does not appear, the cause is almost certainly a stale bundled copy of the shared package — re-run `rm -rf node_modules/.vite` and reinstall `@pashwashah04/fabtraq-shared@1.17.0`.

- [ ] **Step 4: Commit**

```bash
cd fabtraq-fe && git add tests/integration
git commit -m "test: assert JW-Out form blocks submit when placements are missing"
```

---

### Task 6: E2E — refuse the original over-balance scenario

**Files:**
- Modify: `e2e/tests/flows/jw-out.spec.ts`

**Interfaces:**
- Consumes: the running FE + BE + `fabtraq-pdf-parser` stack that `playwright.config.ts` boots.
- Produces: nothing later tasks depend on.

**Fixture rule:** this spec must own its fixtures — create its own purchase/lot rather than reusing "the first active lot", per the e2e convention. `e2e/support/sentinel-purchase.ts` mints a dedicated lot through the real purchase flow; reuse it, do not hand-roll. Its exact signature is `createSentinelPurchase(page: Page, db: Db, quantity: number)` returning `{ qualityId, location: {id,name}, floor: {id,name}, lotNumber, purchaseId }` — note it takes `db` as the second positional argument and returns no `qualityName`, so resolve the quality's display name from `db` the way the existing tests in `jw-out.spec.ts` do.

- [ ] **Step 1: Write the failing test**

Add to `e2e/tests/flows/jw-out.spec.ts`, modelled on the existing happy-path test in that file (it selects a lot around line 120 and clicks "Add placement" at line 130 — read it first and match its helper names exactly rather than introducing new ones):

```ts
test('refuses a JW-Out whose net weight exceeds the lot balance', async ({ page }) => {
  // Own fixture: a lot holding exactly 50 KG, created through the real
  // purchase flow so the ledger reflects it.
  const sentinel = await createSentinelPurchase(page, db, 50);

  // The lot picker is gated on BOTH job-work-types (L18) and quality —
  // resolve the quality name from the id the helper returns.
  const quality = await db.queryOne<{ name: string }>(
    `SELECT name FROM yarn_qualities WHERE id = $1`,
    [sentinel.qualityId],
  );

  await page.goto('/jw-challans-out/new');
  await selectJobWorkTypes(page, ['twisting']);
  await selectQuality(page, quality.name);
  await selectSourceLot(page, sentinel.lotNumber);

  // Ask for 100 from a lot holding 50.
  await fillByLabel(page, 'Net weight for line 1', '100');

  // Check 1 fires immediately, before any placement is added.
  await expect(page.getByText(/only 50 KG available in this lot/i)).toBeVisible();

  // Allocate all 50 that exist — the item still does not conserve.
  await clickButton(page, 'Add placement');
  await fillByLabel(page, 'placement quantity 1', '50');

  await clickButton(page, 'Save');

  // Check 2 blocks it at the weight field; nothing is created.
  await expect(page.getByText(/add up to the net weight/i)).toBeVisible();
  await expect(page).toHaveURL(/\/jw-challans-out\/new/);
});
```

The weight input's aria-label is `Net weight for line ${index + 1}` (`ChallanOutLineItemRow.tsx:183`) — lowercase `w`, so `getByLabel` is case-sensitive here.

- [ ] **Step 2: Run the spec**

Stop the dev servers first — a single-spec run boots its own.

```bash
cd e2e && npx playwright test tests/flows/jw-out.spec.ts
```

Expected: PASS once Tasks 1-4 are in. If check 1's text does not appear, verify the FE was rebuilt against shared 1.17.0.

- [ ] **Step 3: Run the full e2e suite**

```bash
cd e2e && npm run e2e
```

Expected: all green. **This wipes `fabtraq_dev`** — re-seed afterwards (`cd fabtraq-be && npm run prisma:seed`) and tell the user.

- [ ] **Step 4: Commit**

```bash
cd e2e && git add tests/flows/jw-out.spec.ts
git commit -m "test: e2e refusal of over-balance JW-Out (JWO-2026-27-026 regression)"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/brainstorms/2026-05-19-jw-domain-redesign.md` in **`fabtraq-shared`, `fabtraq-be`, `fabtraq-fe`** (append L23 — this file is not mirrored into `e2e`)
- Modify: `docs/backlog.md` in **all four repos** (append B-029 and B-030)
- Copy: the spec and this plan into `docs/superpowers/specs/` and `docs/superpowers/plans/` of all four repos

**CRITICAL — the repo copies are the real ones.** `/home/pashwas/Desktop/Pathshala/gosrani-software/docs/` is **not a git repository** and its copies are stale (its `backlog.md` is from 2026-08-14; the tracked ones are from 2026-08-20). Never commit there and never treat it as the source of truth. The four per-repo `docs/backlog.md` files are currently **byte-identical** (`md5 b52c57a453ef97a33ac8eae90c55a8a2`) and the three per-repo brainstorm copies are byte-identical too — they must still be byte-identical when you finish. Write the edit once, then copy the file to the other repos rather than hand-editing each, and verify with `md5sum` before committing.

**Interfaces:**
- Consumes: the spec at `docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md`.
- Produces: nothing.

- [ ] **Step 1: Record the L14 amendment**

Append to `fabtraq-shared/docs/brainstorms/2026-05-19-jw-domain-redesign.md`, following the formatting of the existing `L##` entries:

```markdown
### L23 — L14's `Σ ≤ qty` is inbound-only (amends L14, 2026-08-20)

- **Trigger:** `JWO-2026-27-026` dispatched 100 kg of a lot holding 50 kg and wrote zero ledger rows, because both the balance guard and the ledger writer iterate `item.placements` and the item had none.
- **Decision:** outbound (JW-Out, and the weaving-dispatch weft half that composes it) requires `Σ placements === netWeight` (±0.001) at save time. Inbound (yarn-purchase, JW-In) is **unchanged** — its unplaced remainder is ledgered into the awaiting-placement bucket per the 2026-07-10 spec, so partial placement is safe there. Outbound has no such bucket.
- **Consequence:** the L11 accountant/storekeeper split no longer applies to JW-Out. Out-items are always created `fully_placed`, so the `jw_challan_out_item` branch of the Place Stock queue is dead for new data (left in place for pre-existing rows — see backlog).
- **Full design:** `docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md`.
```

Then mirror it:

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software
for r in fabtraq-be fabtraq-fe; do
  cp fabtraq-shared/docs/brainstorms/2026-05-19-jw-domain-redesign.md $r/docs/brainstorms/
done
md5sum */docs/brainstorms/2026-05-19-jw-domain-redesign.md
```

Expected: three identical hashes (`e2e` has no copy of this file — do not create one).

- [ ] **Step 2: Add the backlog entries**

Append to `fabtraq-shared/docs/backlog.md`. The file's entry format is a `##` heading followed by bold `**Status:**` / `**Severity:**` lines and prose — match it exactly (read the `## B-028` entry at line 938 first):

```markdown
## B-029 — Retire the dead `jw_challan_out_item` Place-Stock branch

**Status:** Open. Created 2026-08-20 alongside L23.
**Severity:** Low — dead code, not a defect. Removing it is riskier than leaving it.

Since L23 (2026-08-20) JW-Out items are always created `fully_placed`, so they never enter the Place Stock queue. These paths in `fabtraq-be/src/modules/place-stock/place-stock.service.ts` are now reachable only by rows created before that change:

| Path                                            | Lines               |
| ----------------------------------------------- | ------------------- |
| Queue listing (`jw_challan_out_item` branch)     | :185-191, :231-241  |
| `resolveSourceItemMeta` challan-out cases        | :902, :958, :1037   |
| `applyPlacementLedger` challan-out dispatch legs | prisma-inventory.service.ts:1955 |

Remove once no pre-L23 `pending`/`partially_placed` out-items remain in any environment.

## B-030 — Re-enter `JWO-2026-27-026`

**Status:** Open. User-owned manual fix-up.
**Severity:** Medium — the lot it drew on still reads its full pre-challan balance, so it can be issued twice.

`JWO-2026-27-026` dispatched 100 kg of `LOT-260819-0028` (50 kg on floor) with zero placements, so it wrote zero `stock_ledger` rows. It is the defect that prompted L23. It cannot be repaired in place — `editPlacement` 409s on `jw_challan_out_item`, and topping it up through the Place Stock queue stops at 50 kg. Cancel it and recreate with a real placement. No migration or backfill (L8 convention).
```

Then mirror to all four repos and verify:

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software
for r in fabtraq-be fabtraq-fe e2e; do cp fabtraq-shared/docs/backlog.md $r/docs/; done
md5sum */docs/backlog.md
```

Expected: four identical hashes.

- [ ] **Step 3: Copy the spec and plan into every repo**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software
for r in fabtraq-shared fabtraq-be fabtraq-fe e2e; do
  mkdir -p $r/docs/superpowers/specs $r/docs/superpowers/plans
  cp docs/superpowers/specs/2026-08-20-jw-out-placement-conservation-design.md $r/docs/superpowers/specs/
  cp docs/superpowers/plans/2026-08-20-jw-out-placement-conservation.md $r/docs/superpowers/plans/
done
```

- [ ] **Step 4: Commit in each repo separately**

There is no root repository — each of the four is its own. Commit in each:

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software
for r in fabtraq-shared fabtraq-be fabtraq-fe e2e; do
  git -C $r add docs/
  git -C $r commit -m "docs: L23 amends L14 to inbound-only; JW-Out conservation spec + plan

Adds B-029 (dead place-stock branch) and B-030 (re-enter JWO-2026-27-026)."
done
```

`e2e` has no brainstorms copy, so its commit carries only the backlog, spec, and plan. That is expected.

---

## Final verification (run before reporting done)

Not a task — a gate. All of it must pass, and the last item is the one that actually matters.

- [ ] `cd fabtraq-shared && npm run lint && npm run typecheck && npm run test && npm run build`
- [ ] `cd fabtraq-be && npm run lint && npm run typecheck && npm run test && npm run build`
- [ ] `cd fabtraq-be && npm run test:integration` (then `npm run db:reset && npm run db:seed` — NOT `prisma:seed`, which does not exist — then warn the user)
- [ ] `cd fabtraq-fe && npm run lint && npm run typecheck && npm run test && npm run build`
- [ ] `cd e2e && npm run e2e` (then re-seed, then warn the user)
- [ ] Coverage thresholds still met in BE (80/75/80) and FE (80/75/80).
- [ ] `npm view @pashwashah04/fabtraq-shared version` prints `1.17.0`.
- [ ] **Re-run the original symptom by hand, in the browser.** `LOT-260819-0028` will be **gone** — the BE integration run and the e2e run each truncate `fabtraq_dev`. So reproduce the shape rather than the row: with the dev servers up and the DB freshly seeded, create a yarn purchase of **50 kg** and place it on one floor, then open the JW-Out form, pick that lot, and type `100` as the net weight. Confirm (a) the "Only 50 KG available in this lot" warning appears the moment you type, before touching the placement section, and (b) saving is refused with the conservation message. Screenshot both. Green tests are not evidence that the UI works — the bug being fixed here is precisely a guard that looked present and did nothing.
- [ ] Nothing pushed. Report the commit list and wait for the user's go.
