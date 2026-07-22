import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

// ---------------------------------------------------------------------------
// Precondition: an unplaced source item in the place-stock queue.
//
// PlaceStockService.listQueue (fabtraq-be/src/modules/place-stock/place-stock.service.ts)
// feeds /place-stock from three source tables (yarn_purchase_items,
// jw_challan_out_items, jw_challan_in_yarn_items) filtered to
// placementStatus IN ('pending', 'partially_placed'). The seed
// (fabtraq-be/prisma/seed.ts) only ever creates items with placementStatus:
// 'fully_placed' (3 literal occurrences, no pending/partial rows), so the
// queue is EMPTY immediately after `npm run e2e` reseeds — an unplaced
// source must be created inline, not read from the seed.
//
// The yarn-purchase create schema explicitly supports this: `placements:
// placementInputSchema.array()` on createYarnPurchaseItemSchema has no
// non-empty constraint, with the schema comment "Empty array allowed: items
// can be created without placements (pending). Placements are added later
// via POST /placements (BE-10)." (fabtraq-shared/src/schemas/transaction/
// yarn-purchase.ts). So: create a yarn purchase, fill the line item, but
// deliberately skip "Add placement" before Save — the item mints
// placementStatus='pending' with 0 placements and shows up in the queue.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FIXED (2026-07-10, spec docs/superpowers/specs/2026-07-10-unplaced-stock-
// visibility-design.md): the silent-ledger bug this file used to document
// with a `test.fail()` tripwire is resolved. Two BE changes:
//
// 1. Create-time bucket credit (design §3.1) — `applyPurchaseLedger` /
//    `applyChallanInYarnLedger` now write ONE extra `stock_ledger` row for
//    the unplaced remainder at the "bucket" position
//    (locationId=NULL, floorId=NULL, jobWorkerId=NULL), transactionType
//    unchanged ('purchase' / 'challan_in'). This is what makes pending stock
//    show up as an "Awaiting placement" row in Stock Balance / Lots
//    immediately after create, before anyone visits /place-stock.
//
// 2. Queue placement (design §3.2, the actual bug fix) — `PlaceStockService.
//    addPlacements` now calls the new `IInventoryService.applyPlacementLedger`
//    inside the same transaction as `mintPlacements`, writing a move-pair per
//    placement: bucket debit (out=q) + floor credit (in=q), both
//    transactionType='placement'. Stock placed through the /place-stock queue
//    now reaches `stock_ledger` — the floor a user "places" onto immediately
//    shows the new balance, and the source lot's bucket balance drains by the
//    same amount (double-entry: bucket + floor deltas net to zero for a given
//    placement).
//
// The second test below asserts this move-pair directly. The third test
// below is the full user-reported scenario (docs design §5 / origin session
// "when I purchase yarn, if it is placed or not it should be visible in my
// inventory"): create unplaced → bucket credit + "Awaiting placement" row
// visible → place in two partial batches → floor balance grows / bucket
// drains each time → item leaves the queue once fully placed.
// ---------------------------------------------------------------------------

test(
  'unplaced yarn-purchase item flows through the place-stock queue and editor, recording the placement',
  async ({ page, db }) => {
    const Q = 40;

    const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(vendor, 'seed must provide at least one active vendor').not.toBeNull();

    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

    const sku = await db.queryOne<{ id: string; code: string; name: string; shade_number: string | null }>(
      `SELECT id, code, name, shade_number FROM yarn_skus
       WHERE status = 'active' AND quality_id = $1
       ORDER BY code LIMIT 1`,
      [quality!.id],
    );
    expect(sku, 'seed must provide at least one active SKU for the chosen quality').not.toBeNull();

    const location = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM locations WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(location, 'seed must provide at least one active location').not.toBeNull();

    const floor = await db.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM location_floors WHERE status = 'active' AND location_id = $1
       ORDER BY name LIMIT 1`,
      [location!.id],
    );
    expect(floor, 'seed must provide at least one active floor for the chosen location').not.toBeNull();

    // CREATE — a purchase with one line item and ZERO placements (skip "Add
    // placement" entirely). Same field selectors as yarn-purchase.spec.ts.
    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Select vendor', `${vendor!.code} – ${vendor!.name}`);
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    const skuOptionLabel =
      sku!.shade_number !== null && sku!.shade_number !== '' ? `${sku!.name} — ${sku!.shade_number}` : sku!.name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await fillByLabel(page, 'Quantity for line 1', String(Q));

    await clickButton(page, 'Save purchase');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
    const purchaseId = page.url().split('/').pop();

    const item = await db.queryOne<{
      id: string;
      lot_number: string;
      placement_status: string;
    }>(
      `SELECT id, lot_number, placement_status FROM yarn_purchase_items WHERE purchase_id = $1`,
      [purchaseId],
    );
    expect(item, 'the created purchase must have exactly one item').not.toBeNull();
    expect(item!.placement_status).toBe('pending');

    // QUEUE — the item must be visible and clickable through to the editor.
    // Its row's Lot / Quality / SKU column shows the SKU as "<name> (<code>)"
    // resolved from the live /qualities/:id/skus list — the same SKU the
    // purchase above was created with, so this is a real cross-check, not an
    // echo of UI input.
    await gotoAndExpect(page, '/place-stock');
    await expect(page.getByRole('row', { name: item!.lot_number })).toContainText(
      `${sku!.name} (${sku!.code})`,
    );
    await page.getByRole('row', { name: item!.lot_number }).click();
    await expect(page).toHaveURL(new RegExp(`/place-stock/yarn_purchase_item/${item!.id}$`));

    // EDITOR — the item summary strip shows the same resolved SKU…
    await expect(page.getByText(`${sku!.name} (${sku!.code})`)).toBeVisible();

    // …then add a placement covering the full unplaced quantity, on the
    // chosen location/floor.
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floor!.name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    await clickButton(page, 'Save Placements');
    await expectToast(page, 'Stock placed successfully');
    await expect(page).toHaveURL(/\/place-stock$/);

    // Record-keeping assertions: real, non-tautological — read back AFTER
    // Save, keyed on the id/location/floor actually driven through the UI.
    const placement = await db.queryOne<{ quantity: string; location_id: string; floor_id: string }>(
      `SELECT quantity, location_id, floor_id FROM placements
       WHERE source_type = 'yarn_purchase_item' AND source_item_id = $1`,
      [item!.id],
    );
    expect(placement, 'Save Placements must write a placements row').not.toBeNull();
    expect(Number(placement!.quantity)).toBeCloseTo(Q, 3);
    expect(placement!.location_id).toBe(location!.id);
    expect(placement!.floor_id).toBe(floor!.id);

    const updatedItem = await db.queryOne<{ placement_status: string }>(
      `SELECT placement_status FROM yarn_purchase_items WHERE id = $1`,
      [item!.id],
    );
    expect(updatedItem!.placement_status).toBe('fully_placed');
  },
);

test(
  'placing stock via the editor credits the chosen floor and drains the awaiting-placement bucket with a move-pair ledger entry',
  async ({ page, db }) => {
    const Q = 25;

    const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(vendor, 'seed must provide at least one active vendor').not.toBeNull();

    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

    const sku = await db.queryOne<{ id: string; name: string; shade_number: string | null }>(
      `SELECT id, name, shade_number FROM yarn_skus
       WHERE status = 'active' AND quality_id = $1
       ORDER BY code LIMIT 1`,
      [quality!.id],
    );
    expect(sku, 'seed must provide at least one active SKU for the chosen quality').not.toBeNull();

    const location = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM locations WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(location, 'seed must provide at least one active location').not.toBeNull();

    const floor = await db.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM location_floors WHERE status = 'active' AND location_id = $1
       ORDER BY name LIMIT 1`,
      [location!.id],
    );
    expect(floor, 'seed must provide at least one active floor for the chosen location').not.toBeNull();

    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Select vendor', `${vendor!.code} – ${vendor!.name}`);
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    const skuOptionLabel =
      sku!.shade_number !== null && sku!.shade_number !== '' ? `${sku!.name} — ${sku!.shade_number}` : sku!.name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await fillByLabel(page, 'Quantity for line 1', String(Q));

    await clickButton(page, 'Save purchase');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
    const purchaseId = page.url().split('/').pop();

    const item = await db.queryOne<{ id: string; lot_number: string }>(
      `SELECT id, lot_number FROM yarn_purchase_items WHERE purchase_id = $1`,
      [purchaseId],
    );
    expect(item, 'the created purchase must have exactly one item').not.toBeNull();

    // The CREATE itself (zero placements) must have already written a bucket
    // credit for the full Q — design §3.1. Keyed on the just-minted lot
    // number, so this is a real read of a specific row, not a tautology.
    const bucketKey = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: null,
      floorId: null,
      jobWorkerId: null,
    };
    const bucketAfterCreate = await db.ledgerBalance(bucketKey);
    expect(bucketAfterCreate).toBeCloseTo(Q, 3);

    await gotoAndExpect(page, '/place-stock');
    await page.getByRole('row', { name: item!.lot_number }).click();
    await expect(page).toHaveURL(new RegExp(`/place-stock/yarn_purchase_item/${item!.id}$`));

    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floor!.name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    // Floor-credit leg exactly as applyPlacementLedger writes it: the same
    // floor picked in the UI, so the assertion is a true single source of
    // truth. jobWorkerId is explicitly null on this leg (distinct from a JW
    // position row).
    const floorKey = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: location!.id,
      floorId: floor!.id,
      jobWorkerId: null,
    };
    const floorBefore = await db.ledgerBalance(floorKey);

    const { delta: bucketDelta } = await db.ledgerDelta(bucketKey, async () => {
      await clickButton(page, 'Save Placements');
      await expectToast(page, 'Stock placed successfully');
      await expect(page).toHaveURL(/\/place-stock$/);
    });
    const floorAfter = await db.ledgerBalance(floorKey);

    // Move pair: bucket drains by Q, floor credits by Q — double entry nets
    // to zero across the two legs.
    expect(bucketDelta).toBeCloseTo(-Q, 3);
    expect(floorAfter - floorBefore).toBeCloseTo(Q, 3);
  },
);

test(
  'user scenario: purchase yarn without placing it shows as "Awaiting placement", then placing it in two batches moves the balance to the floor and drops it off the queue',
  async ({ page, db }) => {
    const Q = 1000;
    const HALF = 500;

    const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(vendor, 'seed must provide at least one active vendor').not.toBeNull();

    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

    const sku = await db.queryOne<{ id: string; name: string; shade_number: string | null }>(
      `SELECT id, name, shade_number FROM yarn_skus
       WHERE status = 'active' AND quality_id = $1
       ORDER BY code LIMIT 1`,
      [quality!.id],
    );
    expect(sku, 'seed must provide at least one active SKU for the chosen quality').not.toBeNull();

    const location = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM locations WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(location, 'seed must provide at least one active location').not.toBeNull();

    const floor = await db.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM location_floors WHERE status = 'active' AND location_id = $1
       ORDER BY name LIMIT 1`,
      [location!.id],
    );
    expect(floor, 'seed must provide at least one active floor for the chosen location').not.toBeNull();

    // A second, distinct floor on the SAME location — the second placement
    // batch below (Step 5) must land on a DIFFERENT floor than the first
    // (Step 4). The duplicate-floor exclusion (fabtraq-fe 8df5315 /
    // fabtraq-be DUPLICATE_FLOOR_PLACEMENT guard) now correctly removes an
    // already-placed floor from the "Select floor" dropdown, so placing a
    // second batch on the SAME floor as the first — which this scenario used
    // to do — times out waiting for an option that's no longer offered. The
    // scenario's actual intent ("bucket drains across two partial placements,
    // item leaves the queue") is floor-independent, so a second floor
    // preserves it faithfully instead of exercising the now-fixed bug as a
    // feature (mirrors the same retarget in fabtraq-be's
    // place-stock-ledger-wiring.service.test.ts).
    const floor2 = await db.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM location_floors WHERE status = 'active' AND location_id = $1 AND id <> $2
       ORDER BY name LIMIT 1`,
      [location!.id, floor!.id],
    );
    expect(floor2, 'seed must provide a second active floor on the chosen location').not.toBeNull();

    // ── Step 1: purchase 1000 KG with ZERO placements (the original bug
    // report — "when I purchase yarn, if it is placed or not it should be
    // visible in my inventory").
    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Select vendor', `${vendor!.code} – ${vendor!.name}`);
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    const skuOptionLabel =
      sku!.shade_number !== null && sku!.shade_number !== '' ? `${sku!.name} — ${sku!.shade_number}` : sku!.name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await fillByLabel(page, 'Quantity for line 1', String(Q));

    await clickButton(page, 'Save purchase');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
    const purchaseId = page.url().split('/').pop();

    const item = await db.queryOne<{ id: string; lot_number: string; placement_status: string }>(
      `SELECT id, lot_number, placement_status FROM yarn_purchase_items WHERE purchase_id = $1`,
      [purchaseId],
    );
    expect(item, 'the created purchase must have exactly one item').not.toBeNull();
    expect(item!.placement_status).toBe('pending');

    const bucketKey = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: null,
      floorId: null,
      jobWorkerId: null,
    };
    const floorKey = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: location!.id,
      floorId: floor!.id,
      jobWorkerId: null,
    };
    const floor2Key = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: location!.id,
      floorId: floor2!.id,
      jobWorkerId: null,
    };

    // Ledger: create-time bucket credit for the full unplaced quantity.
    expect(await db.ledgerBalance(bucketKey)).toBeCloseTo(Q, 3);
    expect(await db.ledgerBalance(floorKey)).toBeCloseTo(0, 3);
    expect(await db.ledgerBalance(floor2Key)).toBeCloseTo(0, 3);

    // ── Step 2: Stock Balance OVERVIEW (B-015 redesign) — this page now
    // shows one row per (quality, sku, processedTypes, unit) with a Custody
    // split column, not a per-position "Awaiting placement" row; it also has
    // no SKU filter any more (D3), so filter by quality only. The "Unplaced"
    // part of the Custody text is exactly the group's
    // location=null/floor=null/jobWorker=null bucket for the RAW state
    // specifically (`db.ledgerBalance`'s `LedgerKey` has no processedTypes
    // dimension, so it would over-count here if any job-worked stock of this
    // quality+sku also happened to be unplaced) — same key as before, still
    // aggregated across ALL lots of that quality+sku (same as
    // inventory.spec.ts's oracle rule). This item was purchased with zero
    // job-work, so its row carries the "Raw" processed badge — combined
    // with the SKU name that uniquely picks the row out of the quality's
    // other stock items.
    await gotoAndExpect(page, `/inventory?qualityId=${quality!.id}&pageSize=200`);
    const overviewRow = page.getByRole('row').filter({ hasText: sku!.name }).filter({ hasText: 'Raw' });
    await expect(overviewRow).toHaveCount(1);
    const bucketBalanceRow = await db.queryOne<{ bal: string | null }>(
      `SELECT COALESCE(SUM(in_quantity - out_quantity), 0)::text AS bal
       FROM stock_ledger
       WHERE quality_id = $1 AND sku_id = $2 AND location_id IS NULL AND job_worker_id IS NULL
         AND processed_types = '{}'`,
      [quality!.id, sku!.id],
    );
    const groupBucketBalance = Number(bucketBalanceRow?.bal ?? 0);
    const custodyCell = overviewRow.getByRole('cell', { name: /Unplaced/ });
    await expect(custodyCell).toBeVisible();
    const custodyText = (await custodyCell.textContent()) ?? '';
    const unplacedMatch = custodyText.match(/Unplaced ([\d.]+) kg/);
    expect(unplacedMatch, `expected an "Unplaced" figure in custody text "${custodyText}"`).not.toBeNull();
    expect(Number.parseFloat(unplacedMatch![1])).toBeCloseTo(groupBucketBalance, 3);
    expect(groupBucketBalance).toBeGreaterThanOrEqual(Q);

    // ── Step 3: Lots page — exact lotNumber filter isolates THIS lot only,
    // independent of any other quality+sku bucket balance in the DB.
    await gotoAndExpect(page, `/inventory/lots?lotNumber=${item!.lot_number}`);
    const lotRows = page.getByRole('row', { name: item!.lot_number });
    await expect(lotRows).toHaveCount(1);
    await expect(lotRows.first()).toContainText('Awaiting placement');
    await expect(lotRows.first()).toContainText('1000.000 kg');

    // ── Step 4: place HALF (500) via the Place Stock queue + editor.
    await gotoAndExpect(page, '/place-stock');
    await page.getByRole('row', { name: item!.lot_number }).click();
    await expect(page).toHaveURL(new RegExp(`/place-stock/yarn_purchase_item/${item!.id}$`));

    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floor!.name);
    await fillByLabel(page, 'placement quantity 1', String(HALF));

    const { delta: bucketDelta1 } = await db.ledgerDelta(bucketKey, async () => {
      await clickButton(page, 'Save Placements');
      await expectToast(page, 'Stock placed successfully');
      await expect(page).toHaveURL(/\/place-stock$/);
    });
    expect(bucketDelta1).toBeCloseTo(-HALF, 3);
    expect(await db.ledgerBalance(bucketKey)).toBeCloseTo(HALF, 3);
    expect(await db.ledgerBalance(floorKey)).toBeCloseTo(HALF, 3);

    const afterFirstPlacement = await db.queryOne<{ placement_status: string }>(
      `SELECT placement_status FROM yarn_purchase_items WHERE id = $1`,
      [item!.id],
    );
    expect(afterFirstPlacement!.placement_status).toBe('partially_placed');

    // Item is STILL in the queue (not fully placed yet).
    await gotoAndExpect(page, '/place-stock');
    await expect(page.getByRole('row', { name: item!.lot_number })).toBeVisible();
    await expect(page.getByRole('row', { name: item!.lot_number })).toContainText('Partial');

    // Lots page now shows TWO rows for this lot number: the bucket remainder
    // and the floor position.
    await gotoAndExpect(page, `/inventory/lots?lotNumber=${item!.lot_number}`);
    const midRows = page.getByRole('row', { name: item!.lot_number });
    await expect(midRows).toHaveCount(2);
    const midBucketRow = midRows.filter({ hasText: 'Awaiting placement' });
    const midFloorRow = midRows.filter({ hasText: floor!.name });
    await expect(midBucketRow).toHaveCount(1);
    await expect(midBucketRow).toContainText('500.000 kg');
    await expect(midFloorRow).toHaveCount(1);
    await expect(midFloorRow).toContainText('500.000 kg');

    // ── Step 5: place the REMAINING 500 on a DIFFERENT floor (floor2 — see
    // the comment at floor2's query above) — item transitions to
    // fully_placed and leaves the queue. The scenario's point (bucket drains
    // across two partial placements, item leaves the queue) is
    // floor-independent, so splitting across two floors instead of stacking
    // on one preserves it faithfully.
    await gotoAndExpect(page, '/place-stock');
    await page.getByRole('row', { name: item!.lot_number }).click();
    await expect(page).toHaveURL(new RegExp(`/place-stock/yarn_purchase_item/${item!.id}$`));

    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floor2!.name);
    await fillByLabel(page, 'placement quantity 1', String(HALF));

    const { delta: bucketDelta2 } = await db.ledgerDelta(bucketKey, async () => {
      await clickButton(page, 'Save Placements');
      await expectToast(page, 'Stock placed successfully');
      await expect(page).toHaveURL(/\/place-stock$/);
    });
    expect(bucketDelta2).toBeCloseTo(-HALF, 3);
    expect(await db.ledgerBalance(bucketKey)).toBeCloseTo(0, 3);
    expect(await db.ledgerBalance(floorKey)).toBeCloseTo(HALF, 3);
    expect(await db.ledgerBalance(floor2Key)).toBeCloseTo(HALF, 3);

    const afterSecondPlacement = await db.queryOne<{ placement_status: string }>(
      `SELECT placement_status FROM yarn_purchase_items WHERE id = $1`,
      [item!.id],
    );
    expect(afterSecondPlacement!.placement_status).toBe('fully_placed');

    // Item has LEFT the queue.
    await gotoAndExpect(page, '/place-stock');
    await expect(page.getByRole('row', { name: item!.lot_number })).toHaveCount(0);

    // Lots page: bucket row is gone (0 balance, filtered out); the lot is now
    // split across TWO floor rows (500 each) — this test places its two
    // batches on different floors (see floor2's query above), so "the floor
    // row remains" is now "both floor rows remain".
    await gotoAndExpect(page, `/inventory/lots?lotNumber=${item!.lot_number}`);
    const finalRows = page.getByRole('row', { name: item!.lot_number });
    await expect(finalRows).toHaveCount(2);
    await expect(finalRows.filter({ hasText: 'Awaiting placement' })).toHaveCount(0);
    const finalFloorRow = finalRows.filter({ hasText: floor!.name });
    const finalFloor2Row = finalRows.filter({ hasText: floor2!.name });
    await expect(finalFloorRow).toHaveCount(1);
    await expect(finalFloorRow).toContainText('500.000 kg');
    await expect(finalFloor2Row).toHaveCount(1);
    await expect(finalFloor2Row).toContainText('500.000 kg');

    // Positions detail page (D4) for the exact (quality, sku, Raw state)
    // stock item: cross-checked against the ledger, same oracle rule as
    // inventory.spec.ts. The redesigned `/inventory` overview has no
    // location/floor params at all any more — that breakdown lives on
    // `/inventory/positions`'s "In factory" section, which lists every floor
    // for this stock item in one page load, so BOTH floors this lot is now
    // split across are checked from a single navigation (unlike the old
    // per-floor `/inventory?...&floorId=` filter, which needed two).
    const unitRow = await db.queryOne<{ unit: string }>(
      `SELECT unit::text AS unit FROM stock_ledger WHERE quality_id = $1 AND sku_id = $2 LIMIT 1`,
      [quality!.id, sku!.id],
    );
    expect(unitRow, 'expected at least one ledger row for this quality/sku to read its unit').not.toBeNull();
    await gotoAndExpect(
      page,
      `/inventory/positions?qualityId=${quality!.id}&skuId=${sku!.id}&state=raw&unit=${unitRow!.unit}`,
    );
    const inFactory = page.getByRole('region', { name: 'In factory' });
    await expect(inFactory).toBeVisible();

    // `db.ledgerBalance`'s `LedgerKey` has no `processedTypes` dimension (it
    // predates B-015's state-split positions page), so it would over-count
    // here if any job-worked stock of this quality+sku also happened to sit
    // on the same floor — this item is raw, and the page is scoped to
    // `state=raw`, so the oracle must be scoped the same way.
    const rawFloorBalance = async (floorId: string): Promise<number> => {
      const row = await db.queryOne<{ bal: string | null }>(
        `SELECT COALESCE(SUM(in_quantity - out_quantity), 0)::text AS bal
         FROM stock_ledger
         WHERE quality_id = $1 AND sku_id = $2 AND location_id = $3 AND floor_id = $4
           AND job_worker_id IS NULL AND processed_types = '{}'`,
        [quality!.id, sku!.id, location!.id, floorId],
      );
      return Number(row?.bal ?? 0);
    };

    const floorGroupBalance = await rawFloorBalance(floor!.id);
    const floorRow = inFactory.getByRole('row', { name: floor!.name });
    await expect(floorRow).toBeVisible();
    await expect(floorRow).toContainText(location!.name);
    await expect(floorRow).toContainText(`${floorGroupBalance.toFixed(3)} kg`);

    const floor2GroupBalance = await rawFloorBalance(floor2!.id);
    const floor2Row = inFactory.getByRole('row', { name: floor2!.name });
    await expect(floor2Row).toBeVisible();
    await expect(floor2Row).toContainText(location!.name);
    await expect(floor2Row).toContainText(`${floor2GroupBalance.toFixed(3)} kg`);

    // No "Awaiting placement" residue left for THIS lot specifically — scoped
    // by lotNumber, not the whole (quality, sku) group. Both the overview's
    // Custody "Unplaced" figure and the positions page's "Awaiting
    // placement" section aggregate across EVERY lot sharing this
    // quality+sku, so a check there would break the moment another spec
    // running later in the same serial suite legitimately leaves its OWN
    // unplaced residue at the same quality+sku (this repo's
    // vendor/quality/sku picks are all "first active" queries, so
    // collisions across specs are the norm, not the exception — e.g.
    // place-stock-transfer-sync.spec.ts's B-013 edit-twice test deliberately
    // leaves 5kg unplaced). Use the Lots page instead (already proven
    // lot-scoped above via ?lotNumber=), which is what "filter by lot text"
    // concretely means here.
    expect(
      await db.ledgerBalance({
        lotNumber: item!.lot_number,
        qualityId: quality!.id,
        skuId: sku!.id,
        locationId: null,
        floorId: null,
        jobWorkerId: null,
      }),
    ).toBeCloseTo(0, 3);
    await gotoAndExpect(page, `/inventory/lots?lotNumber=${item!.lot_number}`);
    await expect(
      page.getByRole('row', { name: item!.lot_number }).filter({ hasText: 'Awaiting placement' }),
    ).toHaveCount(0);
  },
);
