import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { selectByLabel, selectByAriaLabel, fillByLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';
import { createSentinelPurchase } from '../../support/sentinel-purchase';

test('transfer moves stock floor→floor with SKU preserved and no phantom row', async ({ page, db }) => {
  // 1) Derive EVERYTHING from the ledger before touching the UI.
  // The transfer-form picker (TransferSourcePicker) only offers positions with
  // jobWorkerId === null (stock-transfer-form.page.tsx: `positions` filter), so the
  // seed-position query must apply the same filter — otherwise it could pick a
  // (floor, lot) group that sums job-worker-attributed rows the UI never renders.
  //
  // `AND s.sku_id IS NOT NULL` + the `ORDER BY` below are E3 hardening: this test
  // used to run `LIMIT 1` with no ORDER BY, which was fine only because no
  // null-SKU stock existed anywhere in the DB. E3 (yarn-purchase.spec.ts) and the
  // sentinel test below now create persistent null-SKU stock — without this
  // filter, Postgres could return a (floor, lot) group with sku_id === null,
  // silently short-circuiting the `if (src!.sku_id !== null)` phantom-row check
  // a few lines down. Keep this filter; it is not a stylistic cleanup.
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
       AND s.sku_id IS NOT NULL
       AND s.job_worker_id IS NULL
       AND l.status = 'active'
       AND f.status = 'active'
     GROUP BY l.name, f.name, f.id, s.lot_number, s.sku_id
     HAVING SUM(s.in_quantity - s.out_quantity) >= 5
     ORDER BY s.lot_number, f.id
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
  // phantom (lot, sku=null) row was created at that floor. The hardened source
  // query above guarantees `src.sku_id` is a real SKU, so this is unconditional.
  expect(delta).toBeCloseTo(-5, 3);
  expect(
    await db.ledgerRowExists({ lotNumber: src!.lot_number, skuId: null, floorId: src!.floor_id }),
  ).toBe(false);
});

// E3: this test is the CONSUMER of the D4 legacy null-SKU path that both earlier
// plan revisions had to log as unverifiable — the seed writes no null-SKU ledger
// rows, so a null-SKU source was unreachable until the sentinel purchase flow
// started creating one. Uses the real production path (a sentinel purchase), not
// a hand-written fixture, per the lead's withdrawn-seed ruling.
test('null-SKU stock transfers cleanly with no phantom real-SKU row', async ({ page, db }) => {
  const Q = 5;
  const src = await createSentinelPurchase(page, db, Q);

  const dst = await db.queryOne<{ loc_name: string; floor_name: string; floor_id: string }>(
    `SELECT l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
     FROM location_floors f JOIN locations l ON l.id = f.location_id
     WHERE f.id <> $1 AND l.status = 'active' AND f.status = 'active'
     LIMIT 1`,
    [src.floor.id],
  );
  expect(dst, 'seed must provide a second floor to transfer into').not.toBeNull();

  await gotoAndExpect(page, '/stock-transfers/new');
  await selectByLabel(page, 'From Location', src.location.name);
  await selectByLabel(page, 'From Floor', src.floor.name);
  await selectByAriaLabel(page, 'Pick stock', src.lotNumber);
  await selectByLabel(page, 'To Location', dst!.loc_name);
  await selectByLabel(page, 'To Floor', dst!.floor_name);
  await fillByLabel(page, 'Quantity', String(Q));

  // Debit leg: pass `skuId: null` explicitly — `undefined` means "no filter" in
  // fixtures/db.ts and would make this assertion vacuous (it would sum every
  // SKU at this floor/lot, not just the null-SKU rows the sentinel wrote).
  const fromKey = { lotNumber: src.lotNumber, skuId: null, floorId: src.floor.id };
  const { delta } = await db.ledgerDelta(fromKey, async () => {
    await clickButton(page, 'Create Transfer');
    await expectToast(page, 'Stock transfer created');
    await expect(page).toHaveURL(/\/stock-transfers$/);
  });
  expect(delta).toBeCloseTo(-Q, 3);

  // Credit leg lands on the same skuId:null key at the destination floor.
  expect(
    await db.ledgerRowExists({ lotNumber: src.lotNumber, skuId: null, floorId: dst!.floor_id }),
  ).toBe(true);

  // No phantom row was minted under any real SKU, at either floor, for this lot
  // — the D4 legacy-path assertion test 1 above has been skipping since it was
  // written (it never had null-SKU stock to exercise it against).
  const phantomAtSrc = await db.queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM stock_ledger WHERE lot_number = $1 AND floor_id = $2 AND sku_id IS NOT NULL`,
    [src.lotNumber, src.floor.id],
  );
  expect(Number(phantomAtSrc!.n)).toBe(0);

  const phantomAtDst = await db.queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM stock_ledger WHERE lot_number = $1 AND floor_id = $2 AND sku_id IS NOT NULL`,
    [src.lotNumber, dst!.floor_id],
  );
  expect(Number(phantomAtDst!.n)).toBe(0);
});
