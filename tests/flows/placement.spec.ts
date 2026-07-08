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
// KNOWN BUG (confirmed by reading, not fixed — see task-18-report.md):
//
// place-stock.service.ts's addPlacements docblock claims: "Writes placed-only
// ledger rows via applyPurchaseLedger / applyChallanOutLedger /
// applyChallanInYarnLedger when the item transitions to fully_placed." The
// method body only calls `this.inventory.mintPlacements(...)` (writes
// `placements` rows + updates placementStatus) — it never calls
// applyPurchaseLedger/applyChallanOutLedger/applyChallanInYarnLedger. A
// repo-wide grep confirms those three functions are called from exactly one
// site each, all inside the CREATE flows (yarn-purchase.service.ts:200,
// jw-challan-out.service.ts:136, jw-challan-in.service.ts:320) — never from
// place-stock.service.ts. There is no Prisma middleware/$extends and no DB
// trigger on stock_ledger that could write it another way (grepped
// $use/$extends across src/, grepped migrations/ for CREATE TRIGGER — none).
// fabtraq-be's own integration tests confirm this too:
// tests/integration/place-stock-be10.routes.test.ts's "POST /placements"
// describe block asserts placementStatus transitions and the audit log —
// never stock_ledger.
//
// Net effect: stock placed through the /place-stock queue+editor is
// recorded in the `placements` table (and placementStatus flips to
// fully_placed), but NEVER reaches `stock_ledger` — the table every other
// flow in this app reads floor balances from (see stock-transfer.spec.ts,
// yarn-purchase.spec.ts). The floor a user just "placed" stock onto silently
// shows no additional balance.
//
// This is reported, not fixed (constraints: real bug -> DONE_WITH_CONCERNS,
// no cross-repo changes). The second test below encodes the CORRECT expected
// behavior (+Q ledger delta at the chosen floor key) and is marked
// `test.fail()` so the run stays green while the assertion documents the
// real requirement: if fabtraq-be ships the missing ledger write, this test
// will start unexpectedly PASSING, which Playwright reports as a failure —
// a built-in tripwire to remove the annotation once fixed.
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
    await gotoAndExpect(page, '/place-stock');
    await page.getByRole('row', { name: item!.lot_number }).click();
    await expect(page).toHaveURL(new RegExp(`/place-stock/yarn_purchase_item/${item!.id}$`));

    // EDITOR — add a placement covering the full unplaced quantity, on the
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
  'placing stock via the editor should credit the chosen floor with a +Q stock_ledger entry (BLOCKED — BE never writes it, see top-of-file note)',
  async ({ page, db }) => {
    test.fail(
      true,
      'Confirmed BE bug: PlaceStockService.addPlacements never calls ' +
        'applyPurchaseLedger/applyChallanOutLedger/applyChallanInYarnLedger — only the ' +
        'CREATE flows do. Stock placed through /place-stock never reaches stock_ledger. ' +
        'This test asserts the CORRECT behavior and is expected to fail until BE adds the ' +
        'missing ledger write; remove test.fail() once fixed.',
    );

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

    await gotoAndExpect(page, '/place-stock');
    await page.getByRole('row', { name: item!.lot_number }).click();
    await expect(page).toHaveURL(new RegExp(`/place-stock/yarn_purchase_item/${item!.id}$`));

    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floor!.name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    // Ledger key exactly as applyPurchaseLedger would write it (had it been
    // called): (lotNumber, qualityId, skuId, locationId, floorId) — the same
    // floor picked in the UI, so the assertion is a true single source of truth.
    const key = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: location!.id,
      floorId: floor!.id,
    };

    const { delta } = await db.ledgerDelta(key, async () => {
      await clickButton(page, 'Save Placements');
      await expectToast(page, 'Stock placed successfully');
      await expect(page).toHaveURL(/\/place-stock$/);
    });

    expect(delta).toBeCloseTo(Q, 3);
  },
);
