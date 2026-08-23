import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { SENTINEL_OPTION_LABEL, SKU_ANSWER_REQUIRED } from '../../fixtures/copy';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, fillByLabelExact, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import type { Db } from '../../fixtures/db';

// Seed-resolution shared by both tests below (E3 plan note: lift into a shared
// helper in this file rather than duplicating five queries per test).
// vendor/quality/sku/location/floor are all seeded and stable — tests derive
// real masters rather than creating their own.
async function resolvePurchaseMasters(db: Db) {
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

  return { vendor: vendor!, quality: quality!, sku: sku!, location: location!, floor: floor! };
}

// A yarn purchase MINTS a new lot (yarn-purchase.service.ts: `mintLotNumber` inside
// the create transaction) — the lot number can't be known before Save, so unlike
// stock-transfer.spec.ts we can't derive the ledger key up front. Instead we key the
// delta on (qualityId, skuId) with lotNumber omitted (`db.ledgerDelta`'s `whereFor`
// treats `undefined` as "no filter"): this sums ALL lots of that quality+sku, but
// because we assert the DELTA (after − before) around the create action, any seed
// baseline for that quality+sku is subtracted out — the assertion is non-tautological,
// it fails if the purchase-create flow silently drops the ledger write (e.g. by
// leaving the item's placements empty — applyPurchaseLedger in
// prisma-inventory.service.ts writes ONE stock_ledger row per Placement row, so a
// purchase item with zero placements mints a lot but writes NO ledger rows at all).
test(
  'yarn purchase mints a new lot and writes a +Q stock_ledger entry',
  async ({ page, db }) => {
    const Q = 100;
    const { vendor, quality, sku, location, floor } = await resolvePurchaseMasters(db);

    // CREATE
    await gotoAndExpect(page, '/yarn-purchases/new');

    // Date is pre-filled with today's date by CREATE_DEFAULTS (yarn-purchase-form.page.tsx)
    // — no interaction needed.

    // VendorSelect's SelectTrigger carries its accessible name via a raw
    // aria-label="Select vendor" (not the wrapping "Vendor *" <label> text), so
    // selectByAriaLabel is required here, same gotcha as designs.spec.ts / quality-form.
    await selectByAriaLabel(page, 'Select vendor', `${vendor.code} – ${vendor.name}`);

    // Line item 1: quality select is aria-label="Quality for line 1"
    // (PurchaseLineItemRow.tsx). Selecting it also sets `unit` to the quality's
    // defaultUnit (KG per seed) via the row's onValueChange side effect.
    await selectByAriaLabel(page, 'Quality for line 1', `${quality.code} – ${quality.name}`);

    // SKU select (QualitySkuSelect.tsx) is aria-label="Select SKU"; option label is
    // "<name> — <shadeNumber>" when a shade number exists.
    const skuOptionLabel =
      sku.shade_number !== null && sku.shade_number !== '' ? `${sku.name} — ${sku.shade_number}` : sku.name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);

    await fillByLabel(page, 'Quantity for line 1', String(Q));

    // Placements: an item with ZERO placements mints a lot but writes no stock_ledger
    // row (applyPurchaseLedger loops over Placement rows) — add exactly one placement
    // covering the full quantity so the create write-path actually reaches the ledger.
    // Select location / Select floor (LocationFloorSelect.tsx) are the real triggers
    // for the yarn-purchase placement path.
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location.code} – ${location.name}`);
    await selectByAriaLabel(page, 'Select floor', floor.name);
    await fillByLabelExact(page, 'placement quantity 1', String(Q));

    // Intercept the create request BEFORE the click that fires it — E3's
    // wire-payload requirement: a real-SKU pick must send `skuId` on the wire.
    // This is the control case for the sentinel test below, which asserts the
    // opposite (no key at all) for the same UI gesture.
    const reqPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url() === `${env.API_URL}/yarn-purchases`,
    );

    // Assert the ledger delta around the create action. Key omits lotNumber (a
    // purchase mints a brand-new lot we can't know ahead of time) — see the
    // top-of-file note for why summing across all lots of this (quality, sku) is
    // still a valid, non-tautological delta assertion.
    const { delta } = await db.ledgerDelta(
      { qualityId: quality.id, skuId: sku.id },
      async () => {
        await clickButton(page, 'Save purchase');
        await expectToast(page, /^Saved /);
        await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
      },
    );
    expect(delta).toBeCloseTo(Q, 3);

    const body = (await reqPromise).postDataJSON() as { items: Array<Record<string, unknown>> };
    expect(body.items[0]?.skuId).toBe(sku.id);

    // DETAIL — capture the minted entry number, scoped to <main> (not the whole page,
    // which would also match sidebar nav text) with a regex anchored to the real
    // format confirmed via formatYarnPurchaseEntryNo in fabtraq-shared
    // (`YP-<financialYear>-<seq>`, e.g. "YP-2025-26-001").
    const entryNo = await captureDocNo(page.getByRole('main'), /\bYP-\d{4}-\d{2}-\d{3,}\b/);
    await expect(page.getByRole('heading', { name: `Yarn Purchase ${entryNo}` })).toBeVisible();

    const purchaseId = page.url().split('/').pop();

    // EDIT — header-only edit form loads (items are immutable per yarn-purchase.ts
    // schema doc comment).
    await gotoAndExpect(page, `/yarn-purchases/${purchaseId}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit Yarn Purchase' })).toBeVisible();
  },
);

// E3: the SKU answer is REQUIRED (a real SKU or the "No shade / greige" sentinel),
// but the wire `skuId` stays optional everywhere (D2) — so the gate is a
// client-side, pre-submit check (yarn-purchase-form.page.tsx `onSubmit`), not a
// schema tightening. That is exactly why step 1 below asserts a ZERO ledger delta
// around the blocked click: a client-side-only guard that still posts to the BE
// would pass a DOM-only assertion while silently writing a document.
//
// This test is also the PRODUCER of null-SKU stock that E5 (beam receipt) and
// stock-transfer.spec.ts's new test consume — its DB assertions are scoped to
// this purchase's own transaction_id so they hand off a precise (lotNumber,
// quality) pair rather than "some null-SKU row exists somewhere".
test(
  'yarn purchase blocks until SKU answered; the sentinel writes SKU-less stock',
  async ({ page, db }) => {
    const Q = 40;
    const { vendor, quality, location, floor } = await resolvePurchaseMasters(db);

    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Select vendor', `${vendor.code} – ${vendor.name}`);
    await selectByAriaLabel(page, 'Quality for line 1', `${quality.code} – ${quality.name}`);
    await fillByLabel(page, 'Quantity for line 1', String(Q));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location.code} – ${location.name}`);
    await selectByAriaLabel(page, 'Select floor', floor.name);
    await fillByLabelExact(page, 'placement quantity 1', String(Q));

    // 1) Unanswered blocks. Every other field is filled — SKU is the only gap.
    // The zero-delta assertion is what distinguishes a real block from a form
    // that posted and 400'd; the URL assertion catches a redirect-on-failure bug.
    const { delta: blockedDelta } = await db.ledgerDelta({ qualityId: quality.id }, async () => {
      await clickButton(page, 'Save purchase');
      await expect(page.getByText(SKU_ANSWER_REQUIRED).first()).toBeVisible();
    });
    expect(blockedDelta).toBe(0);
    await expect(page).toHaveURL(/\/yarn-purchases\/new$/);

    // O2 guard: no convention "Greige" SKU gets minted as a side effect of this
    // flow — captured before AND after the sentinel save below.
    const skuCountBefore = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM yarn_skus WHERE quality_id = $1`,
      [quality.id],
    );

    // 2) Answer with the sentinel and save.
    await selectByAriaLabel(page, 'Select SKU', SENTINEL_OPTION_LABEL);

    // 6) The wire payload, not just the DOM: selecting the sentinel and selecting a
    // real SKU are the same UI gesture with different payloads. Assert the sentinel
    // case sends NO `skuId` key at all (test 1 above is the control: a real-SKU
    // pick sends one).
    const reqPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url() === `${env.API_URL}/yarn-purchases`,
    );

    const { delta } = await db.ledgerDelta({ qualityId: quality.id, skuId: null }, async () => {
      await clickButton(page, 'Save purchase');
      await expectToast(page, /^Saved /);
      await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
    });
    expect(delta).toBeCloseTo(Q, 3);

    const body = (await reqPromise).postDataJSON() as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).not.toHaveProperty('skuId');

    const purchaseId = page.url().split('/').pop();

    // 3) Ledger oracle — assert against stock_ledger directly (ledger-is-source-of-
    // truth), scoped to this purchase's transaction_id so the assertion is precise:
    // the minted lot's row has sku_id IS NULL and carries the full quantity, and no
    // row was written under any real SKU for that lot.
    const rows = await db.queryMany<{
      lot_number: string | null;
      sku_id: string | null;
      in_quantity: string;
    }>(`SELECT lot_number, sku_id, in_quantity FROM stock_ledger WHERE transaction_id = $1`, [purchaseId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sku_id).toBeNull();
    expect(Number(rows[0]!.in_quantity)).toBeCloseTo(Q, 3);
    const lotNumber = rows[0]!.lot_number;
    expect(lotNumber).not.toBeNull();

    const phantomRealSkuRow = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM stock_ledger WHERE lot_number = $1 AND sku_id IS NOT NULL`,
      [lotNumber],
    );
    expect(Number(phantomRealSkuRow!.n)).toBe(0);

    // 4) No convention SKU was created (O2): the sentinel bypasses yarn_skus
    // entirely rather than minting a "Greige" row that would permanently split
    // ledger buckets from legacy null-SKU stock.
    const skuCountAfter = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM yarn_skus WHERE quality_id = $1`,
      [quality.id],
    );
    expect(skuCountAfter!.n).toBe(skuCountBefore!.n);

    // 5) Handoff for E5: the minted (qualityId, lotNumber) pair identifies this
    // run's null-SKU stock. E5 can locate it the same way this test does — via
    // `stock_ledger.transaction_id` for a freshly-minted purchase, or via
    // `WHERE sku_id IS NULL AND quality_id = $1 ORDER BY created_at DESC LIMIT 1`
    // for "the most recent sentinel lot" — rather than re-deriving a lot number
    // from the DOM.

    // 7) No edit-path assertion: yarn purchase items are immutable (D4 rev 2 —
    // yarn-purchase.ts schema doc comment states no item-edit route exists), so
    // there is nothing to drive here.
  },
);
