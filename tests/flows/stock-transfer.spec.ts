import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { selectByLabel, selectByAriaLabel, fillByLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';
import { createSentinelPurchase, createSkuPurchase } from '../../support/sentinel-purchase';

test('transfer moves stock floor→floor with SKU preserved and no phantom row', async ({ page, db }) => {
  // 1) Mint this spec's OWN real-SKU lot via a production-path purchase.
  // This test used to source "whichever seeded (floor, lot) has >= 5 balance"
  // from the live ledger — a sibling spec running in parallel could drain that
  // lot between the DB probe and the UI submit (seen live 2026-08-23: balance
  // dropped to 2 KG mid-test). Specs must own their fixtures.
  const Q = 5;
  const src = await createSkuPurchase(page, db, Q);
  expect(src.skuId, 'fixture purchase must be SKU-keyed for the phantom-row check').not.toBeNull();

  const dst = await db.queryOne<{ loc_name: string; floor_name: string }>(
    `SELECT l.name AS loc_name, f.name AS floor_name
     FROM location_floors f JOIN locations l ON l.id = f.location_id
     WHERE f.id <> $1 AND l.status = 'active' AND f.status = 'active'
     LIMIT 1`,
    [src.floor.id],
  );
  expect(dst, 'seed must provide a second floor to transfer into').not.toBeNull();

  // 2) Drive the form with the minted lot.
  await gotoAndExpect(page, '/stock-transfers/new');
  await selectByLabel(page, 'From Location', src.location.name);
  await selectByLabel(page, 'From Floor', src.floor.name);
  // Source picker's aria-label is "Pick stock" (stock-transfer-form.page.tsx
  // <TransferSourcePicker ariaLabel="Pick stock" .../>). Option labels are built
  // by positionLabel() in TransferSourcePicker.tsx as
  // "<lotNumber> · <qualityName> · <sku|—> · <balance> <unit> · <processedTypes>",
  // so a substring match on the raw lot number selects the right option.
  await selectByAriaLabel(page, 'Pick stock', src.lotNumber);
  await selectByLabel(page, 'To Location', dst!.loc_name);
  await selectByLabel(page, 'To Floor', dst!.floor_name);
  await fillByLabel(page, 'Quantity', String(Q));

  // 3) Assert the delta on the SAME key we selected.
  const fromKey = { lotNumber: src.lotNumber, skuId: src.skuId, floorId: src.floor.id };
  const { delta } = await db.ledgerDelta(fromKey, async () => {
    // Submit button text is "Create Transfer" on the new-stock-transfer form.
    await clickButton(page, 'Create Transfer');
    await expectToast(page, 'Stock transfer created');
    await expect(page).toHaveURL(/\/stock-transfers$/);
  });

  // Bug #1: create succeeded + navigated. Bug #2: from-floor dropped by Q, and no
  // phantom (lot, sku=null) row was created at that floor. createSkuPurchase
  // guarantees `src.skuId` is a real SKU, so this is unconditional.
  expect(delta).toBeCloseTo(-Q, 3);
  expect(
    await db.ledgerRowExists({ lotNumber: src.lotNumber, skuId: null, floorId: src.floor.id }),
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
