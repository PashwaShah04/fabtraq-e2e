# JW-In Status + Cancelled-Parent Placement Guard — Implementation Plan

**Status:** ✅ Shipped 2026-08-20 — see `docs/sprints/sprint-8.md` § *Status append — 2026-08-20*. Checkboxes below were not back-filled.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record JW-In cancellation as real state, block placing stock under any cancelled parent document, and repair the ledger damage already caused.

**Architecture:** Add a `status` column to `jw_challans_in` (backfilled from ledger reversal markers), then project each placement source item's parent-alive flag through the one resolver all placement paths already call, rejecting writes when the parent is dead. Finally, a one-off idempotent script reverses ledger rows written against already-cancelled parents.

**Tech Stack:** TypeScript strict, Express 5, Prisma 5 + PostgreSQL 16, zod via `@pashwashah04/fabtraq-shared`, tsyringe DI, vitest, React 19 + Vite + shadcn, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-party-lot-carry-forward-and-jw-in-status-design.md` (§2, §3, §4)

## Global Constraints

- Node 22 only. npm only. No `.js` extensions in TypeScript imports.
- No default exports. No `any`. No `console.*` outside CLI entry points.
- Repos: `fabtraq-shared` (contract), `fabtraq-be`, `fabtraq-fe`, `e2e`. Order: shared → be → fe → e2e.
- `@pashwashah04/fabtraq-shared` bumps to **1.18.0** (1.17.0 is already published). BE and FE install from the GitHub Packages registry.
- After any shared tarball install into FE: `rm -rf fabtraq-fe/node_modules/.vite`.
- Done-ness bar per repo: `npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build` all clean; coverage thresholds (BE statements/lines 80%, branches 75%, functions 80%) met.
- **`npm run test:integration` in fabtraq-be TRUNCATES `fabtraq_dev`**, the same database the dev server uses. Re-seed with `npm run db:seed` afterwards and warn the user before running it.
- E2E: `npx playwright test <spec>` does NOT reseed; `npm run e2e` DOES wipe the DB. Single-spec runs need ports 4000/5173/7300 free (`reuseExistingServer: false`).
- Commit locally after each task. Do not push until the whole workstream is done and the user says go.
- Every role-gated or status-gated UI element ships with both-branch tests in the same change.

---

## File Structure

**fabtraq-shared**
- Modify `src/schemas/transaction/jw-challan-in.ts` — add `jwChallanInStatusSchema`, add `status` to the response schema.
- Modify `src/schemas/inventory/place-stock.ts` — add `parentActive` to the item-detail schema.
- Create `tests/schemas/jw-challan-in-status.test.ts`.

**fabtraq-be**
- Modify `prisma/schema.prisma` — `JwChallanInStatus` enum + `status` column + index.
- Create `prisma/migrations/<ts>_jw_challan_in_status/migration.sql` — DDL + backfill.
- Modify `src/modules/jw-challan-in/jw-challan-in.repository.ts` — `status` on the row type, `setStatus` on the interface.
- Modify `src/modules/jw-challan-in/prisma-jw-challan-in.repository.ts` — select + project `status`, implement `setStatus`.
- Modify `src/modules/jw-challan-in/jw-challan-in.service.ts` — guard reads the column; `cancel()` writes it.
- Modify `src/modules/jw-challan-in/jw-challan-in.mapper.ts` — project `status`.
- Modify `src/modules/place-stock/place-stock.service.ts` — `parentActive` on `SourceItemMeta`, the three `findUnique` selects, `listQueue` filters, rejections in `addPlacements` + `editPlacement`.
- Create `scripts/repair-cancelled-parent-ledger.ts` — the one-off repair.
- Tests alongside each modified module.

**fabtraq-fe**
- Modify `src/features/jw-challans-in/columns.tsx` — status badge column.
- Modify `src/features/jw-challans-in/jw-challan-in-detail.page.tsx` — status badge, hide Cancel when cancelled.
- Modify MSW handlers for JW-In and place-stock to include the new fields.

**e2e**
- Modify `tests/flows/jw-in-yarn.spec.ts` — run the existing unrun zero-placement spec.
- Create `tests/flows/cancelled-parent-guard.spec.ts`.

---

### Task 1: Shared — JW-In status contract

**Files:**
- Modify: `fabtraq-shared/src/schemas/transaction/jw-challan-in.ts`
- Test: `fabtraq-shared/tests/schemas/jw-challan-in-status.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `jwChallanInStatusSchema: z.ZodEnum<['active','cancelled']>`, `type JwChallanInStatus = 'active' | 'cancelled'`, and `jwChallanInResponseSchema` gaining a required `status: JwChallanInStatus`.

- [ ] **Step 1: Write the failing test**

Create `fabtraq-shared/tests/schemas/jw-challan-in-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { jwChallanInStatusSchema } from '../../src/schemas/transaction/jw-challan-in';

describe('jwChallanInStatusSchema', () => {
  it('accepts active and cancelled', () => {
    expect(jwChallanInStatusSchema.parse('active')).toBe('active');
    expect(jwChallanInStatusSchema.parse('cancelled')).toBe('cancelled');
  });

  it('rejects any other value', () => {
    expect(() => jwChallanInStatusSchema.parse('sent')).toThrow();
    expect(() => jwChallanInStatusSchema.parse('')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fabtraq-shared && npx vitest run tests/schemas/jw-challan-in-status.test.ts`
Expected: FAIL — `jwChallanInStatusSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `fabtraq-shared/src/schemas/transaction/jw-challan-in.ts`, above `jwChallanInResponseSchema`:

```ts
/**
 * JW-In lifecycle. Deliberately two-valued (spec L6): a receipt is a completed
 * event, so there is no partial/pending state to model. Mirrors the RECORDED
 * cancellation that yarn_purchases and jw_challans_out already carry.
 */
export const jwChallanInStatusSchema = z.enum(['active', 'cancelled']);
export type JwChallanInStatus = z.infer<typeof jwChallanInStatusSchema>;
```

Then add to `jwChallanInResponseSchema`, immediately after `entryNo`:

```ts
  status: jwChallanInStatusSchema,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-shared && npm run test && npm run typecheck`
Expected: PASS. Existing JW-In schema tests that build a response object will now fail for a missing `status` — add `status: 'active'` to those fixtures; that is the contract change doing its job.

- [ ] **Step 5: Commit**

```bash
cd fabtraq-shared
git add src/schemas/transaction/jw-challan-in.ts tests/schemas/jw-challan-in-status.test.ts
git commit -m "feat(shared): add JwChallanInStatus to the JW-In response contract"
```

---

### Task 2: Shared — parentActive on the place-stock item detail

**Files:**
- Modify: `fabtraq-shared/src/schemas/inventory/place-stock.ts`
- Test: `fabtraq-shared/tests/schemas/place-stock-parent-active.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the place-stock item-detail response schema gains a required `parentActive: boolean`.

Before starting, locate the exact schema name:
`grep -n "export const.*Schema = z.object" fabtraq-shared/src/schemas/inventory/place-stock.ts`
The item-detail schema is the one carrying `placementStatus`, `placedQty`, and `placements`. Use its real name in place of `<ItemDetailSchema>` below.

- [ ] **Step 1: Write the failing test**

Create `fabtraq-shared/tests/schemas/place-stock-parent-active.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { placeStockItemDetailSchema } from '../../src/schemas/inventory/place-stock';

describe('placeStockItemDetailSchema.parentActive', () => {
  it('rejects a payload missing parentActive', () => {
    const withoutFlag = {
      sourceType: 'yarn_purchase_item',
      sourceItemId: '00000000-0000-0000-0000-000000000001',
      qty: 100,
      placedQty: 0,
      placementStatus: 'pending',
      qualityId: '00000000-0000-0000-0000-000000000002',
      lotNumber: 'LOT-260820-0001',
      skuId: null,
      unit: 'KG',
      placements: [],
    };
    expect(() => placeStockItemDetailSchema.parse(withoutFlag)).toThrow();
    expect(() =>
      placeStockItemDetailSchema.parse({ ...withoutFlag, parentActive: true }),
    ).not.toThrow();
  });
});
```

If the real schema name differs, rename the import and the two call sites. If required fields differ, run the parse once, read the zod error, and complete the fixture from it — do not weaken the schema to fit the fixture.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fabtraq-shared && npx vitest run tests/schemas/place-stock-parent-active.test.ts`
Expected: FAIL — the payload without `parentActive` parses successfully.

- [ ] **Step 3: Add the field**

In the item-detail schema object:

```ts
  /**
   * False when this item's parent document (purchase / JW-Out / JW-In) is
   * cancelled. The editor renders read-only in that case; the BE rejects writes
   * regardless (spec §3.3).
   */
  parentActive: z.boolean(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-shared && npm run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Bump, build, commit, publish**

```bash
cd fabtraq-shared
npm version minor --no-git-tag-version   # -> 1.18.0
npm run verify
git add -A
git commit -m "feat(shared): add parentActive to place-stock item detail; bump 1.18.0"
npm publish
```

Verify: `npm view @pashwashah04/fabtraq-shared version` prints `1.18.0`.

---

### Task 3: BE — JW-In status column and backfill migration

**Files:**
- Modify: `fabtraq-be/prisma/schema.prisma`
- Create: `fabtraq-be/prisma/migrations/<timestamp>_jw_challan_in_status/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `JwChallanInStatus` Prisma enum and `JwChallanIn.status` field, available to the Prisma client as `status: 'active' | 'cancelled'`.

- [ ] **Step 1: Add the enum and column**

In `fabtraq-be/prisma/schema.prisma`, beside the other status enums:

```prisma
enum JwChallanInStatus {
  active
  cancelled
}
```

In `model JwChallanIn`, after `entryNo`:

```prisma
  status JwChallanInStatus @default(active)
```

And in that model's index block:

```prisma
  @@index([status])
```

- [ ] **Step 2: Generate the migration WITHOUT applying it**

```bash
cd fabtraq-be
npx prisma migrate dev --name jw_challan_in_status --create-only
```

This writes the DDL but does not run it, so the backfill can be appended first.

- [ ] **Step 3: Append the backfill to the generated migration.sql**

Open the new `prisma/migrations/<timestamp>_jw_challan_in_status/migration.sql` and append:

```sql
-- Backfill (spec L9). Existing cancelled receipts must not read as active.
-- This is the ONE place the ledger cancellation marker establishes challan
-- state; after this migration the column is authoritative.
UPDATE "jw_challans_in" SET "status" = 'cancelled'
WHERE "id" IN (
  SELECT DISTINCT "transaction_id" FROM "stock_ledger"
  WHERE "transaction_type" = 'challan_in' AND "notes" = 'cancellation'
);
```

- [ ] **Step 4: Record the pre-migration expectation, then apply**

```bash
cd fabtraq-be
docker exec fabtraq-postgres psql -U fabtraq -d fabtraq_dev -c \
  "SELECT count(DISTINCT transaction_id) AS should_be_cancelled FROM stock_ledger
   WHERE transaction_type='challan_in' AND notes='cancellation';"
npx prisma migrate dev
npx prisma generate
```

Note the `should_be_cancelled` number before applying.

- [ ] **Step 5: Verify the backfill matched exactly**

```bash
docker exec fabtraq-postgres psql -U fabtraq -d fabtraq_dev -c \
  "SELECT status, count(*) FROM jw_challans_in GROUP BY status;"
```

Expected: the `cancelled` count equals the `should_be_cancelled` number from Step 4. If it does not, stop and investigate before continuing — a mismatch means the marker query is wrong.

- [ ] **Step 6: Commit**

```bash
cd fabtraq-be
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(be): add jw_challans_in.status with ledger-derived backfill"
```

---

### Task 4: BE — JW-In cancel writes and reads the status column

**Files:**
- Modify: `fabtraq-be/src/modules/jw-challan-in/jw-challan-in.repository.ts`
- Modify: `fabtraq-be/src/modules/jw-challan-in/prisma-jw-challan-in.repository.ts`
- Modify: `fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.ts`
- Modify: `fabtraq-be/src/modules/jw-challan-in/jw-challan-in.mapper.ts`
- Test: `fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.test.ts`

**Interfaces:**
- Consumes: `JwChallanInStatus` from `@pashwashah04/fabtraq-shared` (Task 1); the Prisma `status` field (Task 3).
- Produces: `IJwChallanInRepository.setStatus(id: string, status: JwChallanInStatus, tx: Prisma.TransactionClient): Promise<void>`; `JwChallanInRow.status: JwChallanInStatus`; `JwChallanInResponse.status` populated by the mapper.

- [ ] **Step 1: Write the failing tests**

Add to `fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.test.ts`, inside the cancel describe block (create one if absent, mirroring the create block's setup):

```ts
it('sets status to cancelled and reverses both ledger types', async () => {
  const row = makeJwChallanInRow();
  vi.mocked(repo.findById).mockResolvedValue({ ...row, status: 'active' });

  await service.cancel(CHALLAN_IN_ID, makeCtx());

  expect(repo.setStatus).toHaveBeenCalledWith(
    CHALLAN_IN_ID,
    'cancelled',
    expect.anything(),
  );
  expect(inventory.reverseLedger).toHaveBeenCalledWith(
    expect.objectContaining({ transactionType: 'challan_in' }),
  );
  expect(inventory.reverseLedger).toHaveBeenCalledWith(
    expect.objectContaining({ transactionType: 'placement' }),
  );
});

it('rejects a second cancel by reading the status column, not the ledger', async () => {
  const row = makeJwChallanInRow();
  vi.mocked(repo.findById).mockResolvedValue({ ...row, status: 'cancelled' });

  await expect(service.cancel(CHALLAN_IN_ID, makeCtx())).rejects.toThrow(
    /already cancelled/i,
  );
  // The column is authoritative — the old ledger-marker probe must not run.
  expect(repo.hasReversalRows).not.toHaveBeenCalled();
  expect(inventory.reverseLedger).not.toHaveBeenCalled();
});
```

Add `setStatus: vi.fn()` to the repo mock factory (`makeRepo`) and `status: 'active'` to `makeJwChallanInRow`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd fabtraq-be && npx vitest run src/modules/jw-challan-in/jw-challan-in.service.test.ts`
Expected: FAIL — `repo.setStatus` is not a function / `hasReversalRows` was called.

- [ ] **Step 3: Implement**

In `jw-challan-in.repository.ts`, add to `JwChallanInRow`:

```ts
  readonly status: JwChallanInStatus;
```

and to `IJwChallanInRepository`:

```ts
  setStatus(id: string, status: JwChallanInStatus, tx: Prisma.TransactionClient): Promise<void>;
```

Import `JwChallanInStatus` from `@pashwashah04/fabtraq-shared`.

In `prisma-jw-challan-in.repository.ts`: add `status: true` to the header `select` in every query that builds a `JwChallanInRow`, project `status: row.status` in `toDomainRow`, and implement:

```ts
  async setStatus(
    id: string,
    status: JwChallanInStatus,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.jwChallanIn.update({ where: { id }, data: { status } });
  }
```

In `jw-challan-in.service.ts` `cancel()`, replace the `hasReversalRows` guard (step 2 of that method):

```ts
      // 2. Already-cancelled guard — the status column is authoritative
      //    (spec §2.4). Ledger reversal rows remain the stock mechanism.
      if (row.status === 'cancelled') {
        throw new BusinessRuleError('Challan is already cancelled.', {
          details: { code: 'CHALLAN_ALREADY_CANCELLED' },
        });
      }
```

and after the two `reverseLedger` calls, before the parent-status recompute:

```ts
      // 3c. Record the cancellation as state, not merely as ledger reversals.
      await this.repo.setStatus(id, 'cancelled', tx);
```

In `jw-challan-in.mapper.ts`, add to the returned object:

```ts
    status: row.status,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-be && npm run test && npm run typecheck && npm run lint`
Expected: PASS. Mapper tests asserting the full response shape will need `status` added to their expectations.

- [ ] **Step 5: Regenerate OpenAPI and commit**

```bash
cd fabtraq-be
npm run openapi:emit
git add src/modules/jw-challan-in openapi.json prisma
git commit -m "feat(be): record JW-In cancellation as status; guard reads the column"
```

If `openapi:emit` writes to a different path, add whatever it produced — the CI drift gate fails otherwise.

---

### Task 5: BE — parentActive on the placement resolver, and the write guards

**Files:**
- Modify: `fabtraq-be/src/modules/place-stock/place-stock.service.ts`
- Test: `fabtraq-be/src/modules/place-stock/place-stock.service.test.ts`

**Interfaces:**
- Consumes: `jw_challans_in.status` (Task 3); `yarn_purchases.status`, `jw_challans_out.status` (already present).
- Produces: `SourceItemMeta.parentActive: boolean`; `addPlacements` and `editPlacement` throw `BusinessRuleError` with `details.code === 'PARENT_CANCELLED'`; `getPlaceStockItem` returns `parentActive`.

The parent-alive rule, from spec §3.2:

| sourceType | parent relation | alive when |
|---|---|---|
| `yarn_purchase_item` | `purchase` | `status === 'active'` |
| `jw_challan_out_item` | `challanOut` | `status !== 'cancelled'` |
| `jw_challan_in_yarn_item` | `challanIn` | `status === 'active'` |

- [ ] **Step 1: Write the failing tests**

Add to `fabtraq-be/src/modules/place-stock/place-stock.service.test.ts`:

```ts
describe('cancelled-parent guard', () => {
  it.each([
    ['yarn_purchase_item', 'purchase', { status: 'inactive' }],
    ['jw_challan_out_item', 'challanOut', { status: 'cancelled' }],
    ['jw_challan_in_yarn_item', 'challanIn', { status: 'cancelled' }],
  ] as const)(
    'rejects addPlacements for a cancelled %s',
    async (sourceType, relation, parent) => {
      mockSourceItem(sourceType, { [relation]: parent });

      await expect(
        service.addPlacements(
          {
            sourceType,
            sourceItemId: SOURCE_ITEM_ID,
            placements: [
              { locationId: LOCATION_ID, floorId: FLOOR_ID, quantity: 10, unit: 'KG' },
            ],
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ details: { code: 'PARENT_CANCELLED' } });

      expect(inventory.mintPlacements).not.toHaveBeenCalled();
      expect(inventory.applyPlacementLedger).not.toHaveBeenCalled();
    },
  );

  it('allows addPlacements when the parent is active', async () => {
    mockSourceItem('yarn_purchase_item', { purchase: { status: 'active' } });

    await service.addPlacements(
      {
        sourceType: 'yarn_purchase_item',
        sourceItemId: SOURCE_ITEM_ID,
        placements: [
          { locationId: LOCATION_ID, floorId: FLOOR_ID, quantity: 10, unit: 'KG' },
        ],
      },
      makeCtx(),
    );

    expect(inventory.mintPlacements).toHaveBeenCalledOnce();
  });
});
```

`SOURCE_ITEM_ID`, `LOCATION_ID`, and `FLOOR_ID` are the file's existing fixture constants — reuse them; if absent, declare them as fixed UUIDs at the top of the describe block. `mockSourceItem(sourceType, parentOverride)` is a helper you add to this file: it stubs the corresponding `prisma.<model>.findUnique` to return a valid row merged with `parentOverride`. Follow the existing prisma mock factory in the file; if the file has no such factory, model it on `makePrismaClient` in `jw-challan-in.service.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd fabtraq-be && npx vitest run src/modules/place-stock/place-stock.service.test.ts`
Expected: FAIL — placements are minted instead of rejected.

- [ ] **Step 3: Implement**

In `place-stock.service.ts`, add to `interface SourceItemMeta`:

```ts
  /** False when the parent document is cancelled (spec §3.3). */
  readonly parentActive: boolean;
```

In `resolveSourceItemMeta`, extend each branch's `select` with the parent relation and project the flag. For `yarn_purchase_item`:

```ts
            purchase: { select: { status: true } },
```
```ts
          parentActive: row.purchase.status === 'active',
```

For `jw_challan_out_item`:

```ts
            challanOut: { select: { status: true } },
```
```ts
          parentActive: row.challanOut.status !== 'cancelled',
```

For `jw_challan_in_yarn_item`:

```ts
            challanIn: { select: { status: true } },
```
```ts
          parentActive: row.challanIn.status === 'active',
```

In `addPlacements`, immediately after the existing `if (meta === null) throw new NotFoundError(...)`:

```ts
      // Spec §3.3: the parent document must still be alive. This is the real
      // guard — listQueue's filter is only presentation, and a stale tab or a
      // replayed request bypasses it.
      if (!meta.parentActive) {
        throw new BusinessRuleError(
          'Cannot place stock: the source document is cancelled.',
          { details: { code: 'PARENT_CANCELLED' } },
        );
      }
```

Add the identical block to `editPlacement` after its own `meta === null` check.

In `getPlaceStockItem`'s returned object, add `parentActive: meta.parentActive`.

In `listQueue`, add the parent filter to each source type's `findMany` AND its paired `count` — all six `where` clauses:

```ts
        where: { placementStatus: { in: statuses }, purchase: { status: 'active' }, ...searchWhere },
```
```ts
        where: { placementStatus: { in: statuses }, challanOut: { status: { not: 'cancelled' } } },
```
```ts
        where: { placementStatus: { in: statuses }, challanIn: { status: 'active' } },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-be && npm run test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd fabtraq-be
npm run openapi:emit
git add src/modules/place-stock openapi.json
git commit -m "feat(be): reject placement under a cancelled parent document"
```

---

### Task 6: BE — integration test against a real database

**Files:**
- Create: `fabtraq-be/tests/integration/cancelled-parent-guard.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–5.
- Produces: nothing consumed by later tasks.

**WARNING:** this task runs `npm run test:integration`, which truncates `fabtraq_dev` — the same database the dev server uses and the one holding the damaged rows Task 8 repairs. **Run Task 8 before this task, or capture the damaged rows first.** Re-seed with `npm run db:seed` afterwards and tell the user.

- [ ] **Step 1: Write the failing test**

Create `fabtraq-be/tests/integration/cancelled-parent-guard.test.ts`, following the setup of the nearest existing integration test (supertest against `app.ts`, login helper, db reset):

```ts
it('a cancelled purchase leaves the queue and rejects placement', async () => {
  const purchase = await createPurchaseWithoutPlacements(agent, { quantity: 50 });
  const itemId = purchase.items[0].id;

  const queuedBefore = await agent.get('/place-stock/queue');
  expect(queuedBefore.body.items.map((i: { sourceItemId: string }) => i.sourceItemId))
    .toContain(itemId);

  await agent.post(`/yarn-purchases/${purchase.id}/cancel`).set(csrf).expect(200);

  const queuedAfter = await agent.get('/place-stock/queue');
  expect(queuedAfter.body.items.map((i: { sourceItemId: string }) => i.sourceItemId))
    .not.toContain(itemId);

  const ledgerBefore = await countLedgerRows(itemId);

  const res = await agent
    .post('/placements')
    .set(csrf)
    .send({
      sourceType: 'yarn_purchase_item',
      sourceItemId: itemId,
      placements: [{ locationId, floorId, quantity: 50, unit: 'KG' }],
    });

  expect(res.status).toBe(422);
  expect(res.body.details.code).toBe('PARENT_CANCELLED');
  expect(await countLedgerRows(itemId)).toBe(ledgerBefore);
});
```

`countLedgerRows` is a local helper querying `stock_ledger` by `transaction_item_id`. Assert against `stock_ledger` directly, never against `/inventory` — the standing rule from B-012.

Verify the placement route path and the expected HTTP status against `src/modules/place-stock/*.routes.ts` before writing; adjust if they differ.

- [ ] **Step 2: Run to verify it fails**

Warn the user, then:
Run: `cd fabtraq-be && npm run test:integration -- cancelled-parent-guard`
Expected: FAIL if run before Task 5; PASS after. Run it once against the pre-Task-5 code (`git stash`) to confirm the test genuinely catches the bug, then unstash.

- [ ] **Step 3: Re-seed and confirm green**

```bash
cd fabtraq-be
npm run db:seed
npm run test:integration -- cancelled-parent-guard
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd fabtraq-be
git add tests/integration/cancelled-parent-guard.test.ts
git commit -m "test(be): integration coverage for the cancelled-parent placement guard"
```

Tell the user the dev database was reset and re-seeded.

---

### Task 7: FE — cancelled state on the JW-In pages and the placement editor

**Files:**
- Modify: `fabtraq-fe/src/features/jw-challans-in/columns.tsx`
- Modify: `fabtraq-fe/src/features/jw-challans-in/jw-challan-in-detail.page.tsx`
- Modify: the JW-In and place-stock MSW handlers
- Modify: `fabtraq-fe/src/features/placements/` — the place-stock editor page (locate with
  `grep -rln "place-stock/" fabtraq-fe/src/features --include=*.tsx`)
- Test: `fabtraq-fe/tests/unit/features/jw-challans-in/jw-challan-in-detail.test.tsx`
- Test: the place-stock editor's existing unit test file

**Interfaces:**
- Consumes: `JwChallanInResponse.status` (Task 1); `parentActive` on the place-stock item detail (Task 2).
- Produces: nothing consumed by later tasks.

First install the new shared build:

```bash
cd fabtraq-fe
npm install @pashwashah04/fabtraq-shared@1.18.0
rm -rf node_modules/.vite
```

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows a Cancelled badge and hides the cancel button for a cancelled receipt', () => {
  renderDetail({ ...makeChallan(), status: 'cancelled' });

  expect(screen.getByText('Cancelled')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel receipt' })).not.toBeInTheDocument();
});

it('shows the cancel button for an active receipt', () => {
  renderDetail({ ...makeChallan(), status: 'active' });

  expect(screen.getByRole('button', { name: 'Cancel receipt' })).toBeInTheDocument();
});
```

Both branches, same change — the standing rule for status-gated UI.

- [ ] **Step 2: Run to verify they fail**

Run: `cd fabtraq-fe && npx vitest run tests/unit/features/jw-challans-in`
Expected: FAIL — the badge is absent and the button renders in both cases.

- [ ] **Step 3: Implement**

In `jw-challan-in-detail.page.tsx`, mirror the JW-Out pattern. Above the component:

```tsx
const STATUS_LABEL: Record<JwChallanInResponse['status'], string> = {
  active: 'Active',
  cancelled: 'Cancelled',
};
const STATUS_VARIANT: Record<JwChallanInResponse['status'], 'secondary' | 'destructive'> = {
  active: 'secondary',
  cancelled: 'destructive',
};
```

In the `PageHeader`, change `actions` to:

```tsx
        actions={
          canEdit && challan.status === 'active' ? (
            <Button
              disabled={cancelMutation.isPending}
              size="sm"
              variant="destructive"
              onClick={() => { setConfirmOpen(true); }}
            >
              Cancel receipt
            </Button>
          ) : null
        }
```

and render the badge beside the title:

```tsx
      <Badge variant={STATUS_VARIANT[challan.status]}>{STATUS_LABEL[challan.status]}</Badge>
```

In `columns.tsx`, add a status column copying the shape of `features/jw-challans-out/columns.tsx:92-98`.

Update the JW-In MSW handlers to include `status: 'active'`. Because MSW responses are schema-validated, a handler missing it fails its own test rather than drifting.

- [ ] **Step 4: Run to verify they pass**

Run: `cd fabtraq-fe && npm run test && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the placement editor**

The BE now rejects writes under a cancelled parent (Task 5). The editor must not
offer a form that is guaranteed to 422 — spec §3.3.

```tsx
it('renders the placement editor read-only when the parent is cancelled', () => {
  renderPlaceStockEditor(makeItemDetail({ parentActive: false }));

  expect(screen.getByText(/source document is cancelled/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add placement' })).not.toBeInTheDocument();
});

it('renders the editor normally when the parent is active', () => {
  renderPlaceStockEditor(makeItemDetail({ parentActive: true }));

  expect(screen.getByRole('button', { name: 'Add placement' })).toBeInTheDocument();
});
```

Both branches, same change — the standing rule for status-gated UI.

- [ ] **Step 6: Run to verify they fail**

Run: `cd fabtraq-fe && npx vitest run tests/unit/features/placements`
Expected: FAIL — the Add placement button renders in both cases.

- [ ] **Step 7: Implement the read-only branch**

In the place-stock editor page, above the placement form:

```tsx
  if (!item.parentActive) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Cannot place stock</AlertTitle>
        <AlertDescription>
          The source document is cancelled. This stock cannot be placed.
        </AlertDescription>
      </Alert>
    );
  }
```

Place it after the item summary strip so the user still sees which lot they
opened. Follow whatever Alert component the codebase already uses — check
`grep -rn "AlertTitle" fabtraq-fe/src --include=*.tsx | head -3`; if there is no
Alert primitive, use the same bordered-callout markup the nearest page uses for
an error state rather than introducing a component.

Add `parentActive: true` to the place-stock MSW handlers.

- [ ] **Step 8: Run to verify they pass**

Run: `cd fabtraq-fe && npm run test && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd fabtraq-fe
git add src/features tests package.json package-lock.json
git commit -m "feat(fe): surface JW-In status and block the editor for a cancelled parent"
```

---

### Task 8: BE — repair the existing ledger damage

**Files:**
- Create: `fabtraq-be/scripts/repair-cancelled-parent-ledger.ts`

**Interfaces:**
- Consumes: Task 5 (the guard must be live so the repair is not immediately re-broken).
- Produces: nothing consumed by later tasks.

Run this task BEFORE Task 6, or Task 6's database reset destroys the damaged rows.

Spec §4 defines two damage populations. §4.0 is load-bearing: JW-Out placement rows are tagged `challan_out`, not `placement`.

- [ ] **Step 1: Snapshot the damage**

```bash
docker exec fabtraq-postgres psql -U fabtraq -d fabtraq_dev -c \
"COPY (SELECT * FROM stock_ledger ORDER BY created_at) TO STDOUT WITH CSV HEADER" \
  > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/790d5d5c-dd80-4cc9-9e35-bd37d60cc749/scratchpad/ledger-before.csv
```

Record the expected end state — for the two known lots, First Floor returns to 0 and Ground Floor returns to 0:

```bash
docker exec fabtraq-postgres psql -U fabtraq -d fabtraq_dev -c \
"SELECT lot_number, location_id, floor_id, sum(in_quantity - out_quantity) AS bal
 FROM stock_ledger WHERE lot_number IN ('LOT-260820-0003','LOT-260820-0004')
 GROUP BY 1,2,3 ORDER BY 1;"
```

- [ ] **Step 2: Write the script**

Create `fabtraq-be/scripts/repair-cancelled-parent-ledger.ts`:

```ts
/**
 * One-off, idempotent repair for spec §4 — ledger rows written against an
 * already-cancelled parent document.
 *
 * Population A (purchase / JW-In): rows tagged 'placement' whose parent is
 *   cancelled. Reversed wholesale — a cancelled parent should own no live
 *   placement rows at all.
 * Population B (JW-Out): rows tagged 'challan_out' created AFTER that
 *   challan's own cancellation rows. The pre-cancellation rows are already
 *   correctly reversed and MUST NOT be touched.
 *
 * B-013 rule: orphans are selected explicitly, never by absence of a
 * cancellation marker. Re-running finds nothing to do.
 *
 * Usage: npx tsx scripts/repair-cancelled-parent-ledger.ts [--apply]
 * Without --apply it reports what it would do and writes nothing.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const cancelledPurchases = await prisma.yarnPurchase.findMany({
    where: { status: 'inactive' },
    select: { id: true, entryNo: true },
  });
  const cancelledChallansIn = await prisma.jwChallanIn.findMany({
    where: { status: 'cancelled' },
    select: { id: true, entryNo: true },
  });
  const cancelledChallansOut = await prisma.jwChallanOut.findMany({
    where: { status: 'cancelled' },
    select: { id: true, challanNo: true },
  });

  const inboundIds = [
    ...cancelledPurchases.map((r) => r.id),
    ...cancelledChallansIn.map((r) => r.id),
  ];

  // Population A — live 'placement' rows under a cancelled inbound parent.
  const popA = inboundIds.length === 0 ? [] : await prisma.stockLedger.findMany({
    where: {
      transactionType: 'placement',
      transactionId: { in: inboundIds },
      OR: [{ notes: null }, { notes: { not: 'cancellation' } }],
    },
  });

  // Population B — 'challan_out' rows created after that challan's own
  // cancellation rows.
  const popB: typeof popA = [];
  for (const co of cancelledChallansOut) {
    const marker = await prisma.stockLedger.findFirst({
      where: { transactionType: 'challan_out', transactionId: co.id, notes: 'cancellation' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (marker === null) continue;
    const after = await prisma.stockLedger.findMany({
      where: {
        transactionType: 'challan_out',
        transactionId: co.id,
        createdAt: { gt: marker.createdAt },
        OR: [{ notes: null }, { notes: { not: 'cancellation' } }],
      },
    });
    popB.push(...after);
  }

  const orphans = [...popA, ...popB];
  console.warn(`Population A (inbound 'placement'): ${popA.length} row(s)`);
  console.warn(`Population B (outbound 'challan_out' post-cancel): ${popB.length} row(s)`);

  for (const row of orphans) {
    console.warn(
      `  ${row.lotNumber ?? '(no lot)'} ${row.transactionType} ` +
        `in=${row.inQuantity.toString()} out=${row.outQuantity.toString()} ` +
        `loc=${row.locationId ?? 'bucket'} floor=${row.floorId ?? '-'}`,
    );
  }

  if (!APPLY) {
    console.warn('\nDry run. Re-run with --apply to write counter-entries.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const row of orphans) {
      await tx.stockLedger.create({
        data: {
          date: row.date,
          transactionType: row.transactionType,
          transactionId: row.transactionId,
          transactionItemId: row.transactionItemId,
          qualityId: row.qualityId,
          skuId: row.skuId,
          lotNumber: row.lotNumber,
          // Mirror image: swap the legs.
          inQuantity: row.outQuantity,
          outQuantity: row.inQuantity,
          balanceAfter: row.balanceAfter,
          locationId: row.locationId,
          floorId: row.floorId,
          jobWorkerId: row.jobWorkerId,
          processedTypes: row.processedTypes,
          unit: row.unit,
          notes: 'cancellation',
        },
      });
    }
  });

  console.warn(`\nWrote ${orphans.length} counter-entr${orphans.length === 1 ? 'y' : 'ies'}.`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
```

- [ ] **Step 3: Dry run and read every line**

```bash
cd fabtraq-be
npx tsx scripts/repair-cancelled-parent-ledger.ts
```

Expected on the current database: Population A = 4 rows (the two move-pairs for `LOT-260820-0003` and `LOT-260820-0004`), Population B = 0 rows. **If Population A is not 4, stop and investigate — do not apply.**

- [ ] **Step 4: Apply and verify the floors return to zero**

```bash
cd fabtraq-be
npx tsx scripts/repair-cancelled-parent-ledger.ts --apply
docker exec fabtraq-postgres psql -U fabtraq -d fabtraq_dev -c \
"SELECT lot_number, location_id, floor_id, sum(in_quantity - out_quantity) AS bal
 FROM stock_ledger WHERE lot_number IN ('LOT-260820-0003','LOT-260820-0004')
 GROUP BY 1,2,3 ORDER BY 1;"
```

Expected: every position for both lots is `0.000` — no positive floor balance, no negative bucket.

Then confirm through the live API that the phantom stock is gone:

```bash
curl -s -b c.txt 'localhost:4000/inventory/lots?limit=100' | grep -c 'LOT-260820-000[34]'
```
Expected: `0`.

- [ ] **Step 5: Prove idempotency**

```bash
cd fabtraq-be && npx tsx scripts/repair-cancelled-parent-ledger.ts
```
Expected: Population A = 0, Population B = 0.

Note: this relies on the counter-entries carrying `notes='cancellation'`, which the selection excludes. That is a marker-based exclusion of rows the script itself wrote, not the B-013 anti-pattern of inferring liveness from marker absence — the orphan set is still bounded by explicit parent-id and timestamp predicates.

- [ ] **Step 6: Commit**

```bash
cd fabtraq-be
git add scripts/repair-cancelled-parent-ledger.ts
git commit -m "fix(be): repair ledger rows written against cancelled parent documents"
```

---

### Task 9: E2E — cancelled-parent guard, and run the outstanding spec

**Files:**
- Create: `e2e/tests/flows/cancelled-parent-guard.spec.ts`
- Modify: none (`tests/flows/jw-in-yarn.spec.ts` already carries the unrun spec)

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces: nothing.

Ports 4000/5173/7300 must be free (`reuseExistingServer: false`). Ask the user before stopping their dev servers. `npx playwright test <spec>` does not reseed; `npm run e2e` wipes the database.

- [ ] **Step 1: Write the spec**

Create `e2e/tests/flows/cancelled-parent-guard.spec.ts`. Own your fixtures — create a dedicated purchase rather than reusing "first active" anything:

```ts
import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { expectToast } from '../../support/assert';

test(
  'a cancelled purchase leaves the place-stock queue and cannot be placed',
  async ({ page, db }) => {
    const Q = 30;
    // Create a purchase with ZERO placements so it enters the queue as pending
    // (createJwPurchaseUnplaced mirrors placement.spec.ts's inline creation —
    // copy that block rather than importing, so this spec owns its fixture).
    const { purchaseId, lotNumber, itemId } = await createPurchaseUnplaced(page, db, Q);

    await gotoAndExpect(page, '/place-stock');
    await expect(page.getByRole('row', { name: lotNumber })).toBeVisible();

    await gotoAndExpect(page, `/yarn-purchases/${purchaseId}`);
    await page.getByRole('button', { name: /cancel purchase/i }).click();
    await page.getByRole('button', { name: /^cancel purchase$/i }).click();
    await expectToast(page, /cancelled/i);

    // Gone from the queue.
    await gotoAndExpect(page, '/place-stock');
    await expect(page.getByRole('row', { name: lotNumber })).toHaveCount(0);

    // And the ledger never moves — asserted against stock_ledger, not /inventory.
    const balances = await db.query<{ bal: string }>(
      `SELECT sum(in_quantity - out_quantity)::text AS bal FROM stock_ledger
       WHERE transaction_item_id = $1 AND floor_id IS NOT NULL`,
      [itemId],
    );
    expect(Number(balances[0]?.bal ?? '0')).toBeCloseTo(0, 3);
  },
);
```

Confirm the cancel-button labels against `fabtraq-fe/src/features/yarn-purchases/yarn-purchase-detail.page.tsx` before running, and the `db.query` helper signature against `e2e/fixtures/`.

- [ ] **Step 2: Run it and the outstanding JW-In spec**

With the user's permission, stop the dev servers, then:

```bash
cd e2e
npx playwright test tests/flows/cancelled-parent-guard.spec.ts tests/flows/jw-in-yarn.spec.ts
```

Expected: all PASS, including `'a JW-In receipt saved without placements lands in the place-stock queue as pending'`, which has never been executed.

- [ ] **Step 3: Full suite**

```bash
cd e2e && npm run e2e
```

This resets and reseeds the database — that is expected and safe now that Task 8 has run. Expected: all green.

- [ ] **Step 4: Visual verification**

Screenshot the JW-In detail page for a cancelled receipt (badge visible, no Cancel button) and the Place Stock queue. Read them as a first-time user would. Green tests prove nothing about how it looks.

- [ ] **Step 5: Commit**

```bash
cd e2e
git add tests/flows/cancelled-parent-guard.spec.ts
git commit -m "test(e2e): cancelled parent leaves the queue and cannot be placed"
```

---

## Completion

Before declaring done, verify every gate:

- [ ] `npm run verify` green in fabtraq-shared, fabtraq-be, fabtraq-fe
- [ ] `npm run e2e` green
- [ ] `stock_ledger` shows zero balance for `LOT-260820-0003` and `LOT-260820-0004` at every position
- [ ] `/inventory/lots` no longer returns either lot
- [ ] Repair script re-run reports 0 rows in both populations
- [ ] shared 1.18.0 published; BE and FE resolve it from the registry
- [ ] OpenAPI regenerated and committed; CI drift gate green
- [ ] Placement editor renders read-only for a cancelled parent (both branches tested)
- [ ] Screenshots reviewed
- [ ] Spec mirrored into each repo's `docs/sprints/`
- [ ] Nothing pushed until the user says go
