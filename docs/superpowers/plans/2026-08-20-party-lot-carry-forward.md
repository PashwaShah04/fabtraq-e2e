# Party-Lot Carry-Forward Implementation Plan

**Status:** ✅ Shipped 2026-08-20 — see `docs/sprints/sprint-8.md` § *Status append — 2026-08-20*. Checkboxes below were not back-filled.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the vendor's party lot number forward through every job-work hop, so it stays visible on returned yarn until that yarn becomes a beam.

**Architecture:** Approach A — denormalized per generation. Each JW-In yarn item and each beam composition source stores its OWN resolved party lot, combined from its immediate sources. Because every generation stores its own value, resolution is always a single hop regardless of chain depth — no recursion, no graph walk.

**Tech Stack:** TypeScript strict, Express 5, Prisma 5 + PostgreSQL 16, zod via `@pashwashah04/fabtraq-shared`, tsyringe DI, vitest, React 19 + Vite + shadcn, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-party-lot-carry-forward-and-jw-in-status-design.md` (§5)

## Global Constraints

- Node 22 only. npm only. No `.js` extensions in TypeScript imports.
- No default exports. No `any`. No `console.*` outside CLI entry points.
- Repos in order: `fabtraq-shared` → `fabtraq-be` → `fabtraq-fe` → `e2e`.
- **No backfill** (spec L3). The 16 existing JW-In yarn items stay `NULL` and render `—`.
- Combining rule (spec L5): drop null/empty/whitespace, trim, dedup, **sort**, join with `' / '`, return `null` when nothing survives. **No cap.**
- Party lot is **strictly derived and read-only** (spec L2). No form field, no override, no API accepts it as input.
- Lot-label invariant: the lot number stays the **leading token** of every label. Party lot is appended, never reordered — e2e specs select options by lot-number prefix.
- After any shared install into FE: `rm -rf fabtraq-fe/node_modules/.vite`.
- Done-ness per repo: `npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build` clean; BE coverage 80/75/80.
- **`npm run test:integration` TRUNCATES `fabtraq_dev`.** Re-seed and warn the user.
- Commit after each task; push only on the user's go.

**Version note:** if the JW-In-status plan has already published shared 1.18.0, this plan's contract additions go out as **1.19.0**. If both workstreams are implemented together, one 1.18.0 covers both — check `npm view @pashwashah04/fabtraq-shared version` before bumping.

---

## File Structure

**fabtraq-shared**
- Create `src/primitives/party-lot.ts` — the pure combining function, beside `distribute.ts`.
- Modify `src/primitives/index.ts` — export it.
- Modify `src/schemas/transaction/jw-challan-in.ts` — `partyLotNo` on the yarn-item response.
- Modify `src/schemas/transaction/beam-receipt.ts` — `partyLotNo` on the composition-source response.
- Create `tests/primitives/party-lot.test.ts`.

**fabtraq-be**
- Modify `prisma/schema.prisma` — `partyLotNo` on `JwChallanInYarnItem` and `BeamCompositionSource`.
- Create `prisma/migrations/<ts>_party_lot_carry_forward/migration.sql`.
- Modify `src/modules/inventory/i-inventory.service.ts` — declare `findPartyLotsByLotNumbers`.
- Modify `src/modules/inventory/prisma-inventory.service.ts` — implement it.
- Modify `src/modules/jw-challan-in/jw-challan-in.service.ts` — resolve and persist.
- Modify `src/modules/jw-challan-in/{jw-challan-in.repository.ts,prisma-jw-challan-in.repository.ts,jw-challan-in.mapper.ts}` — carry the field.
- Modify `src/modules/beam-receipt/{beam-receipt.service.ts,prisma-beam-receipt.repository.ts,beam-receipt.mapper.ts}` — same.
- Modify `src/modules/inventory/{inventory.mapper.ts,inventory.service.ts}` — project JW-In-origin party lots.

**fabtraq-fe**
- Modify `src/features/jw-challans-in/jw-challan-in-detail.page.tsx` — Party Lot field on the item card.
- Modify `src/features/beams/beam-detail.page.tsx` — Party Lot column on the composition table.

**e2e**
- Create `tests/flows/party-lot-carry-forward.spec.ts`.

---

### Task 1: Shared — the combining function

**Files:**
- Create: `fabtraq-shared/src/primitives/party-lot.ts`
- Modify: `fabtraq-shared/src/primitives/index.ts`
- Test: `fabtraq-shared/tests/primitives/party-lot.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `combinePartyLots(values: readonly (string | null | undefined)[]): string | null`.

- [ ] **Step 1: Write the failing test**

Create `fabtraq-shared/tests/primitives/party-lot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { combinePartyLots } from '../../src/primitives/party-lot';

describe('combinePartyLots', () => {
  it('returns null when nothing survives', () => {
    expect(combinePartyLots([])).toBeNull();
    expect(combinePartyLots([null, undefined, '', '   '])).toBeNull();
  });

  it('returns a single value unchanged', () => {
    expect(combinePartyLots(['PL-441'])).toBe('PL-441');
  });

  it('trims and dedups identical values', () => {
    expect(combinePartyLots(['PL-441', ' PL-441 ', 'PL-441'])).toBe('PL-441');
  });

  it('joins distinct values with " / "', () => {
    expect(combinePartyLots(['PL-441', 'PL-509'])).toBe('PL-441 / PL-509');
  });

  it('sorts so the same set always renders identically', () => {
    expect(combinePartyLots(['PL-509', 'PL-441'])).toBe('PL-441 / PL-509');
    expect(combinePartyLots(['PL-441', 'PL-509'])).toBe('PL-441 / PL-509');
  });

  it('does not cap the result', () => {
    const many = ['E', 'D', 'C', 'B', 'A'];
    expect(combinePartyLots(many)).toBe('A / B / C / D / E');
  });

  it('ignores nulls mixed among real values', () => {
    expect(combinePartyLots([null, 'PL-441', undefined, 'PL-509', ''])).toBe(
      'PL-441 / PL-509',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fabtraq-shared && npx vitest run tests/primitives/party-lot.test.ts`
Expected: FAIL — cannot resolve `../../src/primitives/party-lot`.

- [ ] **Step 3: Implement**

Create `fabtraq-shared/src/primitives/party-lot.ts`:

```ts
/**
 * Combines the party (vendor) lot numbers of a returned lot's sources into the
 * single string that lot carries onward.
 *
 * Rules (design 2026-08-20 §5.4, decision L5): drop null/empty/whitespace-only,
 * trim, dedup, sort, join with " / ". Null when nothing survives. No cap.
 *
 * Sorted rather than input-ordered on purpose: the result is an identity
 * string, and the same set of ancestors must not render two different ways on
 * two different lots.
 *
 * Used by both the BE (writing the denormalized column at JW-In and beam
 * receipt) and the FE (never re-deriving, but sharing the vocabulary).
 */
const SEPARATOR = ' / ';

export function combinePartyLots(
  values: readonly (string | null | undefined)[],
): string | null {
  const cleaned = values
    .map((v) => (v ?? '').trim())
    .filter((v) => v.length > 0);

  if (cleaned.length === 0) return null;

  return [...new Set(cleaned)].sort().join(SEPARATOR);
}
```

Add to `fabtraq-shared/src/primitives/index.ts`, alphabetically after `./optional-text`:

```ts
export * from './party-lot';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-shared && npm run test && npm run typecheck && npm run lint`
Expected: PASS, all 7 cases.

- [ ] **Step 5: Commit**

```bash
cd fabtraq-shared
git add src/primitives/party-lot.ts src/primitives/index.ts tests/primitives/party-lot.test.ts
git commit -m "feat(shared): add combinePartyLots for party-lot carry-forward"
```

---

### Task 2: Shared — contract fields

**Files:**
- Modify: `fabtraq-shared/src/schemas/transaction/jw-challan-in.ts`
- Modify: `fabtraq-shared/src/schemas/transaction/beam-receipt.ts`
- Test: `fabtraq-shared/tests/schemas/party-lot-contract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `JwChallanInYarnItemResponse.partyLotNo: string | null` and `BeamCompositionSourceResponse.partyLotNo: string | null`.

- [ ] **Step 1: Write the failing test**

Create `fabtraq-shared/tests/schemas/party-lot-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { beamCompositionSourceResponseSchema } from '../../src/schemas/transaction/beam-receipt';

describe('party-lot contract', () => {
  const base = {
    id: '00000000-0000-0000-0000-000000000001',
    qualityId: '00000000-0000-0000-0000-000000000002',
    skuId: null,
    lotNumber: 'LOT-260820-0001',
    locationId: '00000000-0000-0000-0000-000000000003',
    floorId: '00000000-0000-0000-0000-000000000004',
    quantity: 10,
  };

  it('requires partyLotNo on a composition source (nullable, not optional)', () => {
    expect(() => beamCompositionSourceResponseSchema.parse(base)).toThrow();
    expect(() =>
      beamCompositionSourceResponseSchema.parse({ ...base, partyLotNo: null }),
    ).not.toThrow();
    expect(
      beamCompositionSourceResponseSchema.parse({ ...base, partyLotNo: 'PL-441' }).partyLotNo,
    ).toBe('PL-441');
  });
});
```

Required-nullable rather than optional, so a BE mapper that forgets to project it fails loudly instead of silently omitting — the same convention `skuShadeColorHex` already uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fabtraq-shared && npx vitest run tests/schemas/party-lot-contract.test.ts`
Expected: FAIL — the payload without `partyLotNo` parses fine.

- [ ] **Step 3: Add the fields**

In `src/schemas/transaction/beam-receipt.ts`, inside `beamCompositionSourceResponseSchema` after `lotNumber`:

```ts
  /** Party lot carried from the pulled lot, snapshotted at receipt (§5.5). */
  partyLotNo: z.string().nullable(),
```

In `src/schemas/transaction/jw-challan-in.ts`, inside `jwChallanInYarnItemResponseSchema` after `lotNo`:

```ts
  /** Combined party lot of this item's sources — derived, never user-entered. */
  partyLotNo: z.string().nullable(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-shared && npm run test && npm run typecheck`
Expected: PASS. Existing fixtures building these shapes need `partyLotNo: null` added.

- [ ] **Step 5: Bump, verify, commit, publish**

```bash
cd fabtraq-shared
npm view @pashwashah04/fabtraq-shared version   # confirm the next minor
npm version minor --no-git-tag-version
npm run verify
git add -A
git commit -m "feat(shared): add partyLotNo to JW-In yarn items and beam composition"
npm publish
```

---

### Task 3: BE — schema columns

**Files:**
- Modify: `fabtraq-be/prisma/schema.prisma`
- Create: `fabtraq-be/prisma/migrations/<timestamp>_party_lot_carry_forward/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `JwChallanInYarnItem.partyLotNo` and `BeamCompositionSource.partyLotNo`, both `String?`.

- [ ] **Step 1: Add the columns**

In `model JwChallanInYarnItem`, after `lotNo`:

```prisma
  partyLotNo      String?         @map("party_lot_no")
```

In `model BeamCompositionSource`, after `lotNumber`:

```prisma
  partyLotNo String? @map("party_lot_no")
```

- [ ] **Step 2: Generate and apply**

```bash
cd fabtraq-be
npx prisma migrate dev --name party_lot_carry_forward
npx prisma generate
```

No backfill (L3) — the generated DDL is the whole migration.

- [ ] **Step 3: Verify the columns exist and are null**

```bash
docker exec fabtraq-postgres psql -U fabtraq -d fabtraq_dev -c \
"SELECT count(*) AS total, count(party_lot_no) AS filled FROM jw_challan_in_yarn_item;"
```
Expected: `filled` = 0. Historical lots stay blank by design.

- [ ] **Step 4: Commit**

```bash
cd fabtraq-be
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(be): add party_lot_no to JW-In yarn items and beam composition"
```

---

### Task 4: BE — the bulk lot→party-lot resolver

**Files:**
- Modify: `fabtraq-be/src/modules/inventory/i-inventory.service.ts`
- Modify: `fabtraq-be/src/modules/inventory/prisma-inventory.service.ts`
- Test: `fabtraq-be/src/modules/inventory/inventory-bounded-context.test.ts`

**Interfaces:**
- Consumes: Task 3's columns.
- Produces:
```ts
findPartyLotsByLotNumbers(p: {
  lotNumbers: readonly string[];
  tx?: Prisma.TransactionClient;
}): Promise<Map<string, string | null>>;
```
Returns one entry per lot number that exists; lots not found are absent from the map. Purchase takes precedence over JW-In when both somehow carry the same lot number — matching the precedence `getEligibleSourceLots` already applies.

- [ ] **Step 1: Write the failing test**

Add to `fabtraq-be/src/modules/inventory/inventory-bounded-context.test.ts`:

```ts
describe('findPartyLotsByLotNumbers', () => {
  it('returns an empty map for no input without querying', async () => {
    const result = await service.findPartyLotsByLotNumbers({ lotNumbers: [] });
    expect(result.size).toBe(0);
    expect(prisma.yarnPurchaseItem.findMany).not.toHaveBeenCalled();
  });

  it('resolves purchase-origin and JW-In-origin lots in one map', async () => {
    vi.mocked(prisma.yarnPurchaseItem.findMany).mockResolvedValue([
      { lotNumber: 'LOT-A', partyLotNo: 'PL-441' },
    ] as never);
    vi.mocked(prisma.jwChallanInYarnItem.findMany).mockResolvedValue([
      { lotNo: 'LOT-B', partyLotNo: 'PL-441 / PL-509' },
    ] as never);

    const result = await service.findPartyLotsByLotNumbers({
      lotNumbers: ['LOT-A', 'LOT-B'],
    });

    expect(result.get('LOT-A')).toBe('PL-441');
    expect(result.get('LOT-B')).toBe('PL-441 / PL-509');
  });

  it('lets purchase win when a lot number appears in both tables', async () => {
    vi.mocked(prisma.yarnPurchaseItem.findMany).mockResolvedValue([
      { lotNumber: 'LOT-A', partyLotNo: 'PL-PURCHASE' },
    ] as never);
    vi.mocked(prisma.jwChallanInYarnItem.findMany).mockResolvedValue([
      { lotNo: 'LOT-A', partyLotNo: 'PL-CHALLAN' },
    ] as never);

    const result = await service.findPartyLotsByLotNumbers({ lotNumbers: ['LOT-A'] });

    expect(result.get('LOT-A')).toBe('PL-PURCHASE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fabtraq-be && npx vitest run src/modules/inventory/inventory-bounded-context.test.ts`
Expected: FAIL — `service.findPartyLotsByLotNumbers is not a function`.

- [ ] **Step 3: Implement**

Declare on `IInventoryService` in `i-inventory.service.ts`:

```ts
  /**
   * Bulk lot-number → party-lot lookup across both lot-minting tables.
   * Single hop by construction: every generation stores its OWN combined party
   * lot, so callers never walk an ancestry chain (design §5.2).
   */
  findPartyLotsByLotNumbers(p: {
    lotNumbers: readonly string[];
    tx?: Prisma.TransactionClient;
  }): Promise<Map<string, string | null>>;
```

Implement in `prisma-inventory.service.ts`, beside the existing bulk placement-status fetch:

```ts
  async findPartyLotsByLotNumbers(p: {
    lotNumbers: readonly string[];
    tx?: Prisma.TransactionClient;
  }): Promise<Map<string, string | null>> {
    if (p.lotNumbers.length === 0) return new Map();

    const db = p.tx ?? this.prisma;
    const lotNumbers = [...p.lotNumbers];

    const [purchaseItems, challanInItems] = await Promise.all([
      db.yarnPurchaseItem.findMany({
        where: { lotNumber: { in: lotNumbers } },
        select: { lotNumber: true, partyLotNo: true },
      }),
      db.jwChallanInYarnItem.findMany({
        where: { lotNo: { in: lotNumbers } },
        select: { lotNo: true, partyLotNo: true },
      }),
    ]);

    // JW-In first, then purchase overwrites — purchase takes precedence, the
    // same ordering getEligibleSourceLots applies.
    const out = new Map<string, string | null>();
    for (const r of challanInItems) out.set(r.lotNo, r.partyLotNo);
    for (const r of purchaseItems) out.set(r.lotNumber, r.partyLotNo);
    return out;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-be && npm run test && npm run typecheck && npm run lint`
Expected: PASS. Any `IInventoryService` mock factory used across the suite needs `findPartyLotsByLotNumbers: vi.fn().mockResolvedValue(new Map())` added — the shared mock helper is the single place to change.

- [ ] **Step 5: Commit**

```bash
cd fabtraq-be
git add src/modules/inventory
git commit -m "feat(be): add findPartyLotsByLotNumbers bulk resolver"
```

---

### Task 5: BE — JW-In resolves and persists the party lot

**Files:**
- Modify: `fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.ts`
- Modify: `fabtraq-be/src/modules/jw-challan-in/jw-challan-in.repository.ts`
- Modify: `fabtraq-be/src/modules/jw-challan-in/prisma-jw-challan-in.repository.ts`
- Modify: `fabtraq-be/src/modules/jw-challan-in/jw-challan-in.mapper.ts`
- Test: `fabtraq-be/src/modules/jw-challan-in/jw-challan-in.service.test.ts`

**Interfaces:**
- Consumes: `combinePartyLots` (Task 1); `findPartyLotsByLotNumbers` (Task 4); the `partyLotNo` column (Task 3).
- Produces: `PersistableJwChallanInYarnItem.partyLotNo: string | null`; `JwChallanInYarnItemRow.partyLotNo`; the response carries it.

The service already resolves `outItemMetas: Map<string, OutItemMeta>` where `OutItemMeta.lotNumber` is the SOURCE lot each out-item pulled from. That map is the input — no new lookup of out-items is needed.

- [ ] **Step 1: Write the failing tests**

Add to `jw-challan-in.service.test.ts`:

```ts
it('carries a single source lot party lot onto the received item', async () => {
  vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
    new Map([[SOURCE_LOT, 'PL-441']]),
  );
  vi.mocked(repo.findOutWithReceipts).mockResolvedValue(makeJwChallanOutWithReceipts());
  vi.mocked(repo.nextEntrySequence).mockResolvedValue(1);
  vi.mocked(repo.createYarnReturningRow).mockResolvedValue(makeJwChallanInRow());
  vi.mocked(repo.findById).mockResolvedValue(makeJwChallanInRow());

  await service.create(makeValidYarnInput(), makeCtx());

  expect(repo.createYarnReturningRow).toHaveBeenCalledWith(
    expect.objectContaining({
      yarnItems: [expect.objectContaining({ partyLotNo: 'PL-441' })],
    }),
    expect.anything(),
  );
});

it('combines distinct party lots when sources disagree', async () => {
  vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
    new Map([
      ['LOT-SRC-A', 'PL-509'],
      ['LOT-SRC-B', 'PL-441'],
    ]),
  );
  // Two sources on one received item, drawing from two different lots.
  const input = makeTwoSourceYarnInput();
  vi.mocked(repo.findOutWithReceipts).mockResolvedValue(makeJwChallanOutWithReceipts());
  vi.mocked(repo.nextEntrySequence).mockResolvedValue(1);
  vi.mocked(repo.createYarnReturningRow).mockResolvedValue(makeJwChallanInRow());
  vi.mocked(repo.findById).mockResolvedValue(makeJwChallanInRow());

  await service.create(input, makeCtx());

  // Sorted, not source-ordered.
  expect(repo.createYarnReturningRow).toHaveBeenCalledWith(
    expect.objectContaining({
      yarnItems: [expect.objectContaining({ partyLotNo: 'PL-441 / PL-509' })],
    }),
    expect.anything(),
  );
});

it('stores null when no source carries a party lot', async () => {
  vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
    new Map([[SOURCE_LOT, null]]),
  );
  vi.mocked(repo.findOutWithReceipts).mockResolvedValue(makeJwChallanOutWithReceipts());
  vi.mocked(repo.nextEntrySequence).mockResolvedValue(1);
  vi.mocked(repo.createYarnReturningRow).mockResolvedValue(makeJwChallanInRow());
  vi.mocked(repo.findById).mockResolvedValue(makeJwChallanInRow());

  await service.create(makeValidYarnInput(), makeCtx());

  expect(repo.createYarnReturningRow).toHaveBeenCalledWith(
    expect.objectContaining({
      yarnItems: [expect.objectContaining({ partyLotNo: null })],
    }),
    expect.anything(),
  );
});
```

`makeTwoSourceYarnInput()` is a new local factory: copy `makeValidYarnInput` and give the single yarn item two `sources` entries pointing at two different out-item IDs, with `consumedQty` summing to the item's `netWeight`. Extend the `makePrismaClient` out-item fixture list so both IDs resolve, each with its own `lotNumber` (`LOT-SRC-A` / `LOT-SRC-B`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd fabtraq-be && npx vitest run src/modules/jw-challan-in/jw-challan-in.service.test.ts`
Expected: FAIL — `partyLotNo` is absent from the persisted items.

- [ ] **Step 3: Implement**

In `jw-challan-in.repository.ts`, add to `PersistableJwChallanInYarnItem` and to `JwChallanInYarnItemRow`:

```ts
  readonly partyLotNo: string | null;
```

In `jw-challan-in.service.ts`, add the import:

```ts
import { combinePartyLots } from '@pashwashah04/fabtraq-shared';
```

Immediately before the `persistableItems` loop (step 7), resolve every source lot in one query:

```ts
        // Party-lot carry-forward (design §5.5). outItemMetas already holds each
        // source out-item's SOURCE lot number, so this is a single bulk lookup —
        // never an ancestry walk, because each generation stores its own value.
        const sourceLotNumbers = [
          ...new Set([...outItemMetas.values()].map((m) => m.lotNumber)),
        ];
        const partyLotByLot = await this.inventory.findPartyLotsByLotNumbers({
          lotNumbers: sourceLotNumbers,
          tx,
        });
```

Inside the loop, before `persistableItems.push`:

```ts
          const itemPartyLot = combinePartyLots(
            item.sources.map((src) =>
              partyLotByLot.get(outItemMetas.get(src.jwChallanOutItemId)?.lotNumber ?? '') ??
              null,
            ),
          );
```

and add to the pushed object:

```ts
            partyLotNo: itemPartyLot,
```

In `prisma-jw-challan-in.repository.ts`: add `partyLotNo: item.partyLotNo` to the yarn-item `create` data, `partyLotNo: true` to every yarn-item `select`, and `partyLotNo: item.partyLotNo` in `toYarnItemRow`.

In `jw-challan-in.mapper.ts`, inside the `yarnItems` map:

```ts
      partyLotNo: y.partyLotNo,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-be && npm run test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd fabtraq-be
npm run openapi:emit
git add src/modules/jw-challan-in openapi.json
git commit -m "feat(be): carry party lot forward onto JW-In received lots"
```

---

### Task 6: BE — beam composition snapshots the party lot

**Files:**
- Modify: `fabtraq-be/src/modules/beam-receipt/beam-receipt.service.ts`
- Modify: `fabtraq-be/src/modules/beam-receipt/prisma-beam-receipt.repository.ts`
- Modify: `fabtraq-be/src/modules/beam-receipt/beam-receipt.mapper.ts`
- Test: `fabtraq-be/src/modules/beam-receipt/beam-receipt.service.test.ts`

**Interfaces:**
- Consumes: `findPartyLotsByLotNumbers` (Task 4); the `partyLotNo` column (Task 3).
- Produces: `BeamCompositionSourceResponse.partyLotNo` populated.

Party lot stops travelling at the beam (L11) — the `Beam` row itself gets no party lot. The composition rows snapshot what went in.

- [ ] **Step 1: Write the failing test**

Add to `beam-receipt.service.test.ts`:

```ts
it('snapshots each composition source party lot at receipt', async () => {
  vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
    new Map([['LOT-SRC-A', 'PL-441']]),
  );

  await service.create(makeInHouseBeamInput(), makeCtx());

  expect(repo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      items: [
        expect.objectContaining({
          composition: [expect.objectContaining({ partyLotNo: 'PL-441' })],
        }),
      ],
    }),
    expect.anything(),
  );
});
```

Use whichever in-house beam input factory the file already defines; if there is none, build the smallest valid one from `createBeamReceiptSchema` and give its single composition slice `lotNumber: 'LOT-SRC-A'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fabtraq-be && npx vitest run src/modules/beam-receipt/beam-receipt.service.test.ts`
Expected: FAIL — `partyLotNo` is absent from the composition rows.

- [ ] **Step 3: Implement**

In `beam-receipt.service.ts`, the service already collects composition lot numbers around line 257. Reuse that collection:

```ts
import { combinePartyLots } from '@pashwashah04/fabtraq-shared';
```

Before persisting (step 5 of `create`):

```ts
    // Party-lot snapshot (design §5.5, L11). The beam itself carries no party
    // lot — beam identity takes over — but each composition row records what
    // went into it.
    const compositionLotNumbers = [
      ...new Set(items.flatMap((item) => item.composition.map((s) => s.lotNumber))),
    ];
    const partyLotByLot = await this.inventory.findPartyLotsByLotNumbers({
      lotNumbers: compositionLotNumbers,
      tx,
    });
```

In the `composition: item.composition.map((s) => ({ ... }))` block, add:

```ts
              partyLotNo: combinePartyLots([partyLotByLot.get(s.lotNumber) ?? null]),
```

`combinePartyLots` on a single value normalises whitespace and maps empty to null — one vocabulary rather than two.

In `prisma-beam-receipt.repository.ts`, add to the composition `create` map:

```ts
                      partyLotNo: s.partyLotNo ?? null,
```

and add `partyLotNo: string | null` to the composition slice type in `beam-receipt.repository.ts`.

In `beam-receipt.mapper.ts`, inside the `composition` map:

```ts
      partyLotNo: s.partyLotNo,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-be && npm run test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd fabtraq-be
npm run openapi:emit
git add src/modules/beam-receipt openapi.json
git commit -m "feat(be): snapshot party lot on beam composition sources"
```

---

### Task 7: BE — inventory projects JW-In-origin party lots

**Files:**
- Modify: `fabtraq-be/src/modules/inventory/inventory.mapper.ts:74`
- Modify: `fabtraq-be/src/modules/inventory/inventory.service.ts:343`
- Modify: `fabtraq-be/src/modules/inventory/inventory.repository.ts` — `partyLotNo` on the challan-in origin row type
- Test: `fabtraq-be/src/modules/inventory/inventory.mapper.test.ts`

**Interfaces:**
- Consumes: Task 5's persisted column.
- Produces: `InventoryLotRow.partyLotNo` and `AggregatedInventoryLotRow.partyLotNo` non-null for JW-In-origin lots.

This is the change that makes every picker in the app light up, because `formatLotIdentity` already renders it.

- [ ] **Step 1: Write the failing test**

Add to `inventory.mapper.test.ts`:

```ts
it('projects the party lot for a JW-In-origin lot', () => {
  const row = mapInventoryLotRow(
    makeAccumRow({ lotNumber: 'LOT-B' }),
    undefined,                                   // no purchase origin
    makeChallanInOrigin({ partyLotNo: 'PL-441' }),
    new Map(),
  );

  expect(row.originType).toBe('jw_challan_in');
  expect(row.partyLotNo).toBe('PL-441');
});

it('still prefers the purchase party lot when both origins resolve', () => {
  const row = mapInventoryLotRow(
    makeAccumRow({ lotNumber: 'LOT-A' }),
    makePurchaseOrigin({ partyLotNo: 'PL-PURCHASE' }),
    makeChallanInOrigin({ partyLotNo: 'PL-CHALLAN' }),
    new Map(),
  );

  expect(row.partyLotNo).toBe('PL-PURCHASE');
});
```

Use the file's existing fixture builders; add `partyLotNo` to `makeChallanInOrigin` if it lacks it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fabtraq-be && npx vitest run src/modules/inventory/inventory.mapper.test.ts`
Expected: FAIL — `partyLotNo` is `null` for the JW-In-origin lot.

- [ ] **Step 3: Implement**

In `inventory.repository.ts`, add to the challan-in origin row type:

```ts
  readonly partyLotNo: string | null;
```

In `inventory.mapper.ts`, replace line 74:

```ts
  const partyLotNo = purchase?.partyLotNo ?? challanIn?.partyLotNo ?? null;
```

Apply the identical change at `inventory.service.ts:343`, and add `partyLotNo: true` to the challan-in-origin `select` in whichever query feeds these mappers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fabtraq-be && npm run test && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Verify live**

Restart the dev server, then create a purchase with a party lot, send it out, and receive it. Confirm:

```bash
curl -s -b c.txt 'localhost:4000/inventory/lots?limit=100' \
  | python3 -c "import sys,json;[print(r['lotNumber'],r['partyLotNo'],r['originType']) for r in json.load(sys.stdin)['items']]"
```
Expected: the newly received JW-In lot shows the party lot, not `None`.

- [ ] **Step 6: Commit**

```bash
cd fabtraq-be
git add src/modules/inventory
git commit -m "feat(be): resolve party lot for JW-In-origin inventory lots"
```

---

### Task 8: FE — party lot on JW-In detail and beam composition

**Files:**
- Modify: `fabtraq-fe/src/features/jw-challans-in/jw-challan-in-detail.page.tsx`
- Modify: `fabtraq-fe/src/features/beams/beam-detail.page.tsx`
- Test: `fabtraq-fe/tests/unit/features/jw-challans-in/jw-challan-in-detail.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 5, 6.
- Produces: nothing.

Install the new shared build first:

```bash
cd fabtraq-fe
npm install @pashwashah04/fabtraq-shared@<version from Task 2>
rm -rf node_modules/.vite
```

Nothing is needed for pickers or the inventory table — `formatLotIdentity` and `inventory/columns.tsx:236` already handle those. Do not add a second rendering of the party lot in any picker; the lot-label module is the single vocabulary.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the carried party lot on a received item card', () => {
  renderDetail(makeChallan({ yarnItems: [makeYarnItem({ partyLotNo: 'PL-441 / PL-509' })] }));

  expect(screen.getByText('PL-441 / PL-509')).toBeInTheDocument();
});

it('renders an em dash when the item has no party lot', () => {
  renderDetail(makeChallan({ yarnItems: [makeYarnItem({ partyLotNo: null })] }));

  const field = screen.getByTestId('party-lot-0');
  expect(field).toHaveTextContent('—');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd fabtraq-fe && npx vitest run tests/unit/features/jw-challans-in`
Expected: FAIL — the party lot is not rendered.

- [ ] **Step 3: Implement**

In `jw-challan-in-detail.page.tsx`, inside `YarnItemCard`'s field grid, immediately after the Lot No field:

```tsx
        <Field
          data-testid={`party-lot-${index}`}
          label="Party Lot No"
          mono
          value={item.partyLotNo ?? '—'}
        />
```

If `Field` does not forward `data-testid`, wrap instead:

```tsx
        <div data-testid={`party-lot-${index}`}>
          <Field label="Party Lot No" mono value={item.partyLotNo ?? '—'} />
        </div>
```

In `beam-detail.page.tsx`, add a `Party Lot` column to the composition table, rendering `src.partyLotNo ?? '—'`, positioned immediately after the lot-number column so the reading order matches every other surface.

- [ ] **Step 4: Run to verify they pass**

Run: `cd fabtraq-fe && npm run test && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd fabtraq-fe
git add src/features tests package.json package-lock.json
git commit -m "feat(fe): show carried party lot on JW-In detail and beam composition"
```

---

### Task 9: E2E — the party lot survives two hops

**Files:**
- Create: `e2e/tests/flows/party-lot-carry-forward.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: nothing.

Own your fixtures — create a dedicated purchase with a distinctive party lot rather than reusing "first active" anything.

- [ ] **Step 1: Write the spec**

Create `e2e/tests/flows/party-lot-carry-forward.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';

test(
  'the party lot survives two job-work hops and reaches the lot listing',
  async ({ page, db }) => {
    const PARTY_LOT = `PL-E2E-${Date.now() % 100000}`;
    const Q = 20;

    // Hop 0 — purchase carrying a distinctive party lot, fully placed.
    const purchase = await createPurchaseWithPartyLot(page, db, PARTY_LOT, Q);

    // Hop 1 — out for twisting, received back.
    const out1 = await openJwPosition(page, purchase.lotNumber, 'Twisting', Q);
    const in1 = await receiveLot(page, out1, Q);

    const item1 = await db.queryOne<{ lot_no: string; party_lot_no: string | null }>(
      `SELECT lot_no, party_lot_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [in1.challanId],
    );
    expect(item1?.party_lot_no).toBe(PARTY_LOT);

    // Hop 2 — out again for dyeing, received back. The party lot must survive
    // a lot minted from a lot that was itself minted by a receipt.
    const out2 = await openJwPosition(page, item1!.lot_no, 'Dyeing', Q);
    const in2 = await receiveLot(page, out2, Q);

    const item2 = await db.queryOne<{ lot_no: string; party_lot_no: string | null }>(
      `SELECT lot_no, party_lot_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [in2.challanId],
    );
    expect(item2?.party_lot_no).toBe(PARTY_LOT);

    // Visible in the lot listing — the surface the user actually reads.
    await gotoAndExpect(page, '/inventory');
    await expect(page.getByRole('row', { name: item2!.lot_no })).toContainText(PARTY_LOT);

    // And in a picker, appended AFTER the lot number (label invariant).
    await gotoAndExpect(page, '/jw-challans-out/new');
    const option = page.getByRole('option', { name: item2!.lot_no });
    await expect(option).toContainText(`${item2!.lot_no} — ${PARTY_LOT}`);
  },
);
```

`createPurchaseWithPartyLot`, `openJwPosition`, and `receiveLot` are local helpers in this file. Model `openJwPosition` and `receiveLot` on the versions in `tests/flows/jw-in-yarn.spec.ts` — **copy them, do not import**, so this spec owns its fixtures. `createPurchaseWithPartyLot` fills the Party Lot No input in `PurchaseLineItemRow` (`items.N.partyLotNo`) and places the full quantity.

Reaching the picker option may require opening the source-lot dropdown first; follow the interaction pattern in `jw-in-yarn.spec.ts`.

- [ ] **Step 2: Run it**

Ask the user before stopping their dev servers (ports 4000/5173/7300 must be free).

```bash
cd e2e
npx playwright test tests/flows/party-lot-carry-forward.spec.ts
```
Expected: PASS. If the picker assertion fails on option text, check `formatAggregatedLotLabel` — the lot number must remain the leading token.

- [ ] **Step 3: Full suite**

```bash
cd e2e && npm run e2e
```
Expected: all green. This wipes and reseeds the database.

- [ ] **Step 4: Visual verification**

Screenshot the JW-In detail card, the beam composition table, and a lot picker showing `LOT-… — PL-…`. Confirm nothing wraps badly when two party lots are combined into `A / B`.

- [ ] **Step 5: Commit**

```bash
cd e2e
git add tests/flows/party-lot-carry-forward.spec.ts
git commit -m "test(e2e): party lot survives two job-work hops"
```

---

## Completion

- [ ] `npm run verify` green in fabtraq-shared, fabtraq-be, fabtraq-fe
- [ ] `npm run e2e` green
- [ ] A freshly received two-hop lot shows its party lot in `/inventory/lots`, on the JW-In detail card, and in every lot picker
- [ ] Historical JW-In lots still show `—` (no backfill, per L3)
- [ ] Beam composition rows carry the party lot; the `Beam` row does not
- [ ] No form anywhere accepts a party lot on JW-In (strictly derived, per L2)
- [ ] shared published; BE and FE resolve it from the registry
- [ ] OpenAPI regenerated and committed; CI drift gate green
- [ ] Screenshots reviewed
- [ ] Spec mirrored into each repo's `docs/sprints/`
- [ ] Nothing pushed until the user says go
