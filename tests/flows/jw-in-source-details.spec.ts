import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  fillByLabelExact,
  selectByAriaLabel,
  selectByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// JW-In source details (spec 2026-08-24, shared 1.23.0): the eligible-out-item
// source picker (dropdown row + collapsed trigger) and the JW-challan-in
// detail page's Sources table now surface job worker + quality + SKU (with
// shade colour) for every source, BE-hydrated. This spec owns every fixture
// it asserts on (job worker, quality, SKU) rather than piggybacking on the
// seeded QTY-001/RED — never rely on "first active" seeded entities (repo
// rule) when the entity's own NAME is what's being asserted on screen.
test(
  'JW-In source picker and challan-in detail surface job worker, quality, and SKU-shade for a source',
  async ({ page, db }) => {
    const Q = 12;

    // ── FIXTURE 1: job worker (owned, distinctive name).
    const jobWorkerName = codes.jobWorkerName();
    await gotoAndExpect(page, '/job-workers/new');
    await fillByLabel(page, 'Name', jobWorkerName);
    await fillByLabel(page, 'Contact Person', 'E2E Contact');
    await selectByLabel(page, 'State', 'Gujarat');
    await page.getByRole('checkbox', { name: 'Twisting' }).check();
    await clickButton(page, 'Create');
    await expectToast(page, 'Job worker created');

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE name = $1`,
      [jobWorkerName],
    );
    expect(jobWorker, 'the just-created job worker must be queryable').not.toBeNull();

    // ── FIXTURE 2: quality + SKU (owned, with a shade number + colour hex).
    const qualityName = codes.qualityName();
    await gotoAndExpect(page, '/qualities/new');
    await fillByLabel(page, 'Name', qualityName);
    await fillByLabel(page, 'HSN Code', '52051200');
    await clickButton(page, 'Create Quality');
    await expectToast(page, 'Quality created');
    await expect(page).toHaveURL(/\/qualities\/[^/]+\/edit/);
    const qualityId = page.url().match(/\/qualities\/([^/]+)\/edit/)?.[1];
    expect(qualityId, 'quality create must redirect to its own edit URL').toBeDefined();

    const skuName = codes.unique('SKU Source');
    const shadeNumber = 'S-42';
    const HEX_INPUT = '#2E8B57';
    await page.getByRole('tab', { name: 'SKUs' }).click();
    await fillByLabel(page, 'Name', skuName);
    await fillByLabel(page, 'Shade number', shadeNumber);
    await page.getByTestId('shade-colour-gate').check();
    await fillByLabel(page, 'Shade colour hex', HEX_INPUT);
    await clickButton(page, 'Add SKU');
    await expectToast(page, 'SKU created');

    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE id = $1`,
      [qualityId],
    );
    expect(quality, 'the just-created quality must be queryable').not.toBeNull();
    const sku = await db.queryOne<{ id: string; name: string; shade_number: string | null }>(
      `SELECT id, name, shade_number FROM yarn_skus WHERE name = $1`,
      [skuName],
    );
    expect(sku, 'the just-created SKU must be queryable').not.toBeNull();

    // App-wide SKU label convention: "name — shadeNumber".
    const skuLabel = `${skuName} — ${shadeNumber}`;

    // ── STOCK: a yarn purchase mints a raw lot of this exact quality/SKU on a
    // seeded floor (location/floor identity isn't asserted on screen, so the
    // spec reuses the seed rather than owning a fourth fixture).
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

    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Select vendor', `${vendor!.code} – ${vendor!.name}`);
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    await selectByAriaLabel(page, 'Select SKU', skuLabel);
    await fillByLabel(page, 'Quantity for line 1', String(Q));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floor!.name);
    await fillByLabelExact(page, 'placement quantity 1', String(Q));
    await clickButton(page, 'Save purchase');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);

    // Both quality and SKU are freshly minted this test run, so this lookup
    // is unambiguous.
    const mintedLot = await db.queryOne<{ lot_number: string }>(
      `SELECT lot_number FROM stock_ledger WHERE quality_id = $1 AND sku_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [quality!.id, sku!.id],
    );
    expect(mintedLot, 'the yarn purchase must mint a stock_ledger row for this SKU').not.toBeNull();

    // ── JW-OUT: send the fresh lot to the owned job worker, fully placed
    // (placement quantity == net weight) so it's ELIGIBLE for JW-In.
    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await page.getByRole('checkbox', { name: 'Twisting' }).check();
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    await selectByAriaLabel(page, 'Select SKU', skuLabel);
    await selectByAriaLabel(page, 'Source lot for line 1', mintedLot!.lot_number);
    await fillByLabel(page, 'Net weight for line 1', String(Q));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select floor and location', `${location!.name} · ${floor!.name}`);
    await fillByLabelExact(page, 'placement quantity 1', String(Q));
    await clickButton(page, 'Save challan');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
    const outChallanNo = await captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);

    // ── JW-IN: open the form, start a received lot of the same quality/SKU.
    await gotoAndExpect(page, '/jw-challans-in/new');
    await expect(page.getByRole('heading', { name: 'New Job Work Challan In' })).toBeVisible();

    await selectByAriaLabel(page, 'quality, lots.0', `${quality!.code} – ${quality!.name}`);
    await selectByAriaLabel(page, 'sku, lots.0', skuLabel);
    await fillByLabel(page, 'net weight, lots.0', String(Q));

    // ASSERTION 1 — the source picker's dropdown row shows job worker +
    // quality + SKU-shade (with colour swatch).
    await page.getByLabel('add source, lots.0').click();
    await page.getByLabel('source, lots.0.sources.0', { exact: true }).click();
    await fillByLabel(page, 'Search OUT challan no', outChallanNo);
    const eligibleOption = page.getByRole('option', { name: outChallanNo });
    await expect(eligibleOption).toBeVisible();
    await expect(eligibleOption).toContainText(`${mintedLot!.lot_number} · ${quality!.name} · `);
    await expect(eligibleOption).toContainText(skuLabel);
    await expect(eligibleOption).toContainText(`@ ${jobWorker!.name}`);
    await expect(eligibleOption.getByTestId('sku-swatch')).toHaveCount(1);

    // ASSERTION 2 — after selecting it, the collapsed trigger shows the same
    // identity (challanNo · lot · quality · SKU-shade · jobWorkerName · N pending).
    await eligibleOption.click();
    const trigger = page.getByLabel('source, lots.0.sources.0', { exact: true });
    await expect(trigger).toContainText(outChallanNo);
    await expect(trigger).toContainText(mintedLot!.lot_number);
    await expect(trigger).toContainText(quality!.name);
    await expect(trigger).toContainText(skuLabel);
    await expect(trigger).toContainText(jobWorker!.name);
    await expect(trigger).toContainText(`${Q} pending`);
    await expect(trigger.getByTestId('sku-swatch')).toHaveCount(1);

    // Prefill: pending == net == Q, so Consumed lands at Q automatically.
    await expect(page.getByLabel('consumed quantity, lots.0.sources.0')).toHaveValue(String(Q));

    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floor!.name);
    await fillByLabelExact(page, 'placement quantity 1', String(Q));

    await clickButton(page, 'Save receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-in\/[^/]+$/);

    // ASSERTION 3 — the challan-in detail page's Sources table shows quality
    // name, SKU—shade, and job worker name (BE-hydrated).
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWI-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();
    await gotoAndExpect(page, `/jw-challans-in/${challanId}`);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan In ${challanNo}` }),
    ).toBeVisible();

    const sourcesTable = page.getByTestId('sources-table');
    await expect(sourcesTable).toContainText(outChallanNo);
    await expect(sourcesTable).toContainText(quality!.name);
    await expect(sourcesTable).toContainText(skuLabel);
    await expect(sourcesTable).toContainText(jobWorker!.name);
    await expect(sourcesTable.getByTestId('sku-swatch')).toHaveCount(1);
  },
);
