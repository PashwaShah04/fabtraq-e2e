import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { selectByLabel, selectByAriaLabel, fillByLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

test('transfer moves stock floor→floor with SKU preserved and no phantom row', async ({ page, db }) => {
  // 1) Derive EVERYTHING from the ledger before touching the UI.
  // The transfer-form picker (TransferSourcePicker) only offers positions with
  // jobWorkerId === null (stock-transfer-form.page.tsx: `positions` filter), so the
  // seed-position query must apply the same filter — otherwise it could pick a
  // (floor, lot) group that sums job-worker-attributed rows the UI never renders.
  const src = await db.queryOne<{
    loc_name: string;
    floor_name: string;
    floor_id: string;
    lot_number: string;
    sku_id: string | null;
  }>(
    `SELECT l.name AS loc_name, f.name AS floor_name, f.id AS floor_id,
            s.lot_number, s.sku_id
     FROM stock_ledger s
     JOIN location_floors f ON f.id = s.floor_id
     JOIN locations l ON l.id = f.location_id
     WHERE s.lot_number IS NOT NULL
       AND s.job_worker_id IS NULL
       AND l.status = 'active'
       AND f.status = 'active'
     GROUP BY l.name, f.name, f.id, s.lot_number, s.sku_id
     HAVING SUM(s.in_quantity - s.out_quantity) >= 5
     LIMIT 1`,
  );
  expect(src, 'seed must provide a floor with >=5 of some lot').not.toBeNull();

  const dst = await db.queryOne<{ loc_name: string; floor_name: string }>(
    `SELECT l.name AS loc_name, f.name AS floor_name
     FROM location_floors f JOIN locations l ON l.id = f.location_id
     WHERE f.id <> $1 AND l.status = 'active' AND f.status = 'active'
     LIMIT 1`,
    [src!.floor_id],
  );
  expect(dst, 'seed must provide a second floor to transfer into').not.toBeNull();

  // 2) Drive the form with the derived names.
  await gotoAndExpect(page, '/stock-transfers/new');
  await selectByLabel(page, 'From Location', src!.loc_name);
  await selectByLabel(page, 'From Floor', src!.floor_name);
  // Source picker's aria-label is "Pick stock" (stock-transfer-form.page.tsx
  // <TransferSourcePicker ariaLabel="Pick stock" .../>). Option labels are built
  // by positionLabel() in TransferSourcePicker.tsx as
  // "<lotNumber> · <qualityName> · <sku|—> · <balance> <unit> · <processedTypes>",
  // so a substring match on the raw lot number selects the right option.
  await selectByAriaLabel(page, 'Pick stock', src!.lot_number);
  await selectByLabel(page, 'To Location', dst!.loc_name);
  await selectByLabel(page, 'To Floor', dst!.floor_name);
  await fillByLabel(page, 'Quantity', '5');

  // 3) Assert the delta on the SAME key we selected.
  const fromKey = { lotNumber: src!.lot_number, skuId: src!.sku_id, floorId: src!.floor_id };
  const { delta } = await db.ledgerDelta(fromKey, async () => {
    // Submit button text is "Create Transfer" on the new-stock-transfer form.
    await clickButton(page, 'Create Transfer');
    await expectToast(page, 'Stock transfer created');
    await expect(page).toHaveURL(/\/stock-transfers$/);
  });

  // Bug #1: create succeeded + navigated. Bug #2: from-floor dropped by 5, and no
  // phantom (lot, sku=null) row was created at that floor.
  expect(delta).toBeCloseTo(-5, 3);
  if (src!.sku_id !== null) {
    expect(
      await db.ledgerRowExists({ lotNumber: src!.lot_number, skuId: null, floorId: src!.floor_id }),
    ).toBe(false);
  }
});
