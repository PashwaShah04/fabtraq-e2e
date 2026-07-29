import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { EMPTY_SKU_QUALITY_HINT, SENTINEL_OPTION_LABEL } from '../../fixtures/copy';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';
import type { Db } from '../../fixtures/db';

// E6 (spec rev 2, D5) — an empty-SKU quality is an ADVISORY hint, never a
// dead end: the "No shade / greige" sentinel is always selectable regardless
// of whether the quality has any SKUs (QualitySkuSelect.tsx: `showHint` is
// computed independently of `disabled`, which only tracks `qualityId === ''`).
// Testing the hint as a blocker would encode rev-1's retired hard-mandatory
// behaviour.
//
// Only the yarn-purchase test below completes the document with the
// sentinel. JW-in and beam-receipt (In-house) structurally cannot: a
// brand-new quality has no stock anywhere, and both of those forms populate
// their source/pull pickers from EXISTING floor stock of that quality —
// JW-in needs an outstanding JW-out opened from floor stock of the quality
// (openJwPosition), and beam receipt's Section B exact-coverage gate needs
// an existing lot of that quality to pull. That is a property of this
// fixture (a genuinely stockless quality), not a gap to work around: the
// sentinel-completes-the-document path is already covered end-to-end with
// real stock by E4 Test B (JW-in) and E5 Test B (beam receipt). Originating
// stock here first would duplicate that coverage with a much heavier
// fixture, so this file proves the hint + non-dead-end behaviour on all
// three forms and leaves full completion to yarn purchase, which mints a
// lot from nothing.
//
// Do NOT add a zero-SKU quality to the seed — it would perturb every other
// spec's `ORDER BY code LIMIT 1` quality resolution (plan note).

/** Creates a fresh, active yarn quality with zero SKUs via /qualities/new
 *  (pattern: qualities.spec.ts:17-31) — the SKUs tab is left untouched. */
async function createZeroSkuQuality(
  page: Page,
  db: Db,
): Promise<{ id: string; code: string; name: string }> {
  const name = codes.qualityName();
  await gotoAndExpect(page, '/qualities/new');
  await fillByLabel(page, 'Name', name);
  await fillByLabel(page, 'HSN Code', '52051200');
  await clickButton(page, 'Create Quality');
  await expectToast(page, 'Quality created');
  await expect(page).toHaveURL(/\/qualities\/[^/]+\/edit/);

  const match = page.url().match(/\/qualities\/([^/]+)\/edit/);
  if (!match) throw new Error(`unexpected quality edit URL: ${page.url()}`);
  const row = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE id = $1`,
    [match[1]],
  );
  expect(row, 'freshly created quality must be queryable immediately after create').not.toBeNull();
  return row!;
}

async function resolveVendorAndFloor(db: Db) {
  const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(vendor, 'seed must provide at least one active vendor').not.toBeNull();

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

  return { vendor: vendor!, location: location!, floor: floor! };
}

test(
  'yarn purchase: empty-SKU quality shows the D5 hint but the sentinel completes the document',
  async ({ page, db }) => {
    const Q = 15;
    const quality = await createZeroSkuQuality(page, db);
    const { vendor, location, floor } = await resolveVendorAndFloor(db);

    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Select vendor', `${vendor.code} – ${vendor.name}`);
    await selectByAriaLabel(page, 'Quality for line 1', `${quality.code} – ${quality.name}`);

    // D5 hint — advisory, rendered once the SKU query for this quality
    // settles with zero results. Exact copy, never paraphrased.
    await expect(page.getByText(EMPTY_SKU_QUALITY_HINT, { exact: true })).toBeVisible();

    // Rev-2 behaviour change: the SKU control stays ENABLED and the
    // sentinel stays selectable even though the quality has no SKUs — this
    // is exactly the assertion that would have caught shipping rev-1's
    // dead-end select (disabled control, nothing to pick).
    const skuTrigger = page.locator('[aria-label="Select SKU"]');
    await expect(skuTrigger).toBeEnabled();
    await skuTrigger.click();
    const listbox = page.getByRole('listbox');
    const sentinelOption = listbox.getByRole('option', { name: SENTINEL_OPTION_LABEL });
    await expect(sentinelOption).toBeVisible();
    await expect(sentinelOption).toBeEnabled();

    // D5 scopes inline SKU-creation out of v1 — no such control exists in
    // the open dropdown (a spec tolerating its absence would not catch one
    // being added unreviewed).
    await expect(listbox.getByRole('button', { name: /sku/i })).toHaveCount(0);

    await sentinelOption.click();

    await fillByLabel(page, 'Quantity for line 1', String(Q));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location.code} – ${location.name}`);
    await selectByAriaLabel(page, 'Select floor', floor.name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    // The one place this file proves the hint doesn't stand between the
    // user and a valid entry: save with the sentinel and assert the
    // sku_id IS NULL ledger row.
    const { delta } = await db.ledgerDelta({ qualityId: quality.id, skuId: null }, async () => {
      await clickButton(page, 'Save purchase');
      await expectToast(page, /^Saved /);
      await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
    });
    expect(delta).toBeCloseTo(Q, 3);

    const purchaseId = page.url().split('/').pop();
    const rows = await db.queryMany<{ sku_id: string | null; in_quantity: string }>(
      `SELECT sku_id, in_quantity FROM stock_ledger WHERE transaction_id = $1`,
      [purchaseId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sku_id).toBeNull();
    expect(Number(rows[0]!.in_quantity)).toBeCloseTo(Q, 3);
  },
);

test(
  'JW challan-in (yarn): empty-SKU quality shows the D5 hint and the SKU control is not disabled',
  async ({ page, db }) => {
    const quality = await createZeroSkuQuality(page, db);

    await gotoAndExpect(page, '/jw-challans-in/new');
    await selectByAriaLabel(page, 'quality, lots.0', `${quality.code} – ${quality.name}`);

    await expect(page.getByText(EMPTY_SKU_QUALITY_HINT, { exact: true })).toBeVisible();

    const skuTrigger = page.locator('[aria-label="sku, lots.0"]');
    await expect(skuTrigger).toBeEnabled();
    await skuTrigger.click();
    const listbox = page.getByRole('listbox');
    const sentinelOption = listbox.getByRole('option', { name: SENTINEL_OPTION_LABEL });
    await expect(sentinelOption).toBeVisible();
    await expect(sentinelOption).toBeEnabled();
    await expect(listbox.getByRole('button', { name: /sku/i })).toHaveCount(0);

    // Prove it is genuinely selectable (not merely rendered-but-inert).
    await sentinelOption.click();
    await expect(skuTrigger).toHaveText(SENTINEL_OPTION_LABEL);

    // No completion here — see the top-of-file note. This quality has no
    // floor stock anywhere, so no outstanding JW-out can be opened against
    // it (openJwPosition's prerequisite); the sentinel-completes-the-
    // document path is already covered with real stock by E4 Test B.
  },
);

test(
  'beam receipt (In-house): empty-SKU quality shows the D5 hint and the SKU control is not disabled',
  async ({ page, db }) => {
    const Q = 10;
    const quality = await createZeroSkuQuality(page, db);
    const beamNumber = `BM-E6-${Date.now()}`;

    await gotoAndExpect(page, '/beam-receipts/new');
    await page
      .getByRole('group', { name: 'beam origin' })
      .getByRole('button', { name: 'In-house', exact: true })
      .click();
    await fillByLabel(page, 'beam number, items.0', beamNumber);
    await fillByLabel(page, 'net weight, items.0', String(Q));

    await clickButton(page, 'add yarn to item 1');
    await selectByAriaLabel(page, 'yarn quality, items.0.yarns.0', `${quality.code} – ${quality.name}`);

    await expect(page.getByText(EMPTY_SKU_QUALITY_HINT, { exact: true })).toBeVisible();

    const skuTrigger = page.locator('[aria-label="yarn sku, items.0.yarns.0"]');
    await expect(skuTrigger).toBeEnabled();
    await skuTrigger.click();
    const listbox = page.getByRole('listbox');
    const sentinelOption = listbox.getByRole('option', { name: SENTINEL_OPTION_LABEL });
    await expect(sentinelOption).toBeVisible();
    await expect(sentinelOption).toBeEnabled();
    await expect(listbox.getByRole('button', { name: /sku/i })).toHaveCount(0);

    await sentinelOption.click();
    await expect(skuTrigger).toHaveText(SENTINEL_OPTION_LABEL);

    // No completion here — see the top-of-file note. Section B's
    // exact-coverage gate needs an existing lot of this quality to pull,
    // and this quality has no stock anywhere; the sentinel-completes-the-
    // document path is already covered with real stock by E5 Test B.
  },
);
