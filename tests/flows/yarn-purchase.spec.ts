import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

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
//
// KNOWN FE BUG blocks this test — see test.fixme() call below for details.
test(
  'yarn purchase mints a new lot and writes a +Q stock_ledger entry',
  async ({ page, db }) => {
    // KNOWN FE BUG (not a test-selector issue — every selector below is verified
    // correct against the real component): fabtraq-fe/src/shared/components/
    // PlacementFieldArray.tsx line 150 (`<div className="w-full min-w-0">`) is the
    // strongest candidate cause (found by inspection, not confirmed by editing FE
    // code — out of scope here) for the "Location / Floor" table cell collapsing
    // under the yarn-purchase line-item table's other fixed-width columns (Qty
    // 112px / Unit 104px / Remove 40px) plus the preceding Quality/SKU/Party
    // Lot/Boxes/Qty/Unit/Rate/Amount columns. The nested LocationFloorSelect
    // (shared/components/LocationFloorSelect.tsx, a 2-up `grid-cols-2` of "Select
    // location" + "Select floor" triggers — yarn-purchase never passes
    // `availableFloors` to PlacementFieldArray, so it never uses the combined
    // AvailableFloorSelect used by the JW-Out path) is squeezed to near-zero
    // width, and the floor SelectTrigger becomes unclickable (its own `.field`
    // wrapper intercepts pointer events at the collapsed hit-test point). The
    // table wrapper has `overflow-x-auto` (PurchaseLineItemTable.tsx)
    // specifically to handle narrow widths, but `min-w-0` on the placements
    // column defeats it, so the cell shrinks instead of the table scrolling.
    //
    // Repro (this run, headed): fails at the Playwright default 1280×720 viewport
    // (used, unoverridden, by every other spec in this repo) and at 1366×768-class
    // laptop widths; passes at 1440×900, 1920×1080, and 2400×1200 — full flow
    // green, including the +100 stock_ledger delta assertion below, in ~3.5s. This
    // is a real responsive-layout defect at common laptop resolutions, not a test
    // environment quirk — do NOT "fix" it here by widening the test viewport, that
    // would hide a genuine bug behind a green check.
    //
    // Once PlacementFieldArray's layout is fixed, delete this test.fixme() call —
    // the body below is otherwise a complete, verified-passing spec.
    test.fixme();

    const Q = 100;

    // Derive real seed master data rather than creating masters (constraints doc: each
    // test creates its own masters ONLY when the seed doesn't already supply what's
    // needed — vendor/quality/sku/location/floor are all seeded and stable).
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

    // CREATE
    await gotoAndExpect(page, '/yarn-purchases/new');

    // Date is pre-filled with today's date by CREATE_DEFAULTS (yarn-purchase-form.page.tsx)
    // — no interaction needed.

    // VendorSelect's SelectTrigger carries its accessible name via a raw
    // aria-label="Select vendor" (not the wrapping "Vendor *" <label> text), so
    // selectByAriaLabel is required here, same gotcha as designs.spec.ts / quality-form.
    await selectByAriaLabel(page, 'Select vendor', `${vendor!.code} – ${vendor!.name}`);

    // Line item 1: quality select is aria-label="Quality for line 1"
    // (PurchaseLineItemRow.tsx). Selecting it also sets `unit` to the quality's
    // defaultUnit (KG per seed) via the row's onValueChange side effect.
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);

    // SKU select (QualitySkuSelect.tsx) is aria-label="Select SKU"; option label is
    // "<name> — <shadeNumber>" when a shade number exists.
    const skuOptionLabel =
      sku!.shade_number !== null && sku!.shade_number !== '' ? `${sku!.name} — ${sku!.shade_number}` : sku!.name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);

    await fillByLabel(page, 'Quantity for line 1', String(Q));

    // Placements: an item with ZERO placements mints a lot but writes no stock_ledger
    // row (applyPurchaseLedger loops over Placement rows) — add exactly one placement
    // covering the full quantity so the create write-path actually reaches the ledger.
    // Select location / Select floor (LocationFloorSelect.tsx) are the real triggers
    // for the yarn-purchase placement path — see the KNOWN FE BUG note above for why
    // the floor click is currently blocked at common viewport widths.
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floor!.name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    // Assert the ledger delta around the create action. Key omits lotNumber (a
    // purchase mints a brand-new lot we can't know ahead of time) — see the
    // top-of-file note for why summing across all lots of this (quality, sku) is
    // still a valid, non-tautological delta assertion.
    const { delta } = await db.ledgerDelta(
      { qualityId: quality!.id, skuId: sku!.id },
      async () => {
        await clickButton(page, 'Save purchase');
        await expectToast(page, /^Saved /);
        await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
      },
    );
    expect(delta).toBeCloseTo(Q, 3);

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
