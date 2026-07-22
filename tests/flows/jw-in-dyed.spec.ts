import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// JW Challan In "dyed" — CONSOLIDATED FORM (spec 2026-07-22). "Dyed" is not a
// route or a picker choice anymore: there is no Processed Types input at all
// (D2 — the BE derives state from the source's prior processedTypes ∪ the
// work-done chips, which default ticked). What makes a receipt "dyed" is
// purely that its source OUT declared 'dyeing'. The Shade No cell in the
// received-lots grid (aria `shade, lots.N`) stays DISABLED until the derived
// state includes dyeing — i.e. until a dyeing source is picked in Section B —
// and is required from then on (BE-enforced, derived-dyeing rule).
//
// Ledger contract is identical to jw-in-yarn.spec.ts (same
// applyChallanInYarnLedger, same two legs); 'dyed' changes only the
// processedTypes value written into Leg B.
test(
  '/jw-challans-in/new/dyed redirects to the consolidated form (dyed is not a separate route)',
  async ({ page }) => {
    await page.goto('/jw-challans-in/new/dyed');
    await expect(page).toHaveURL(/\/jw-challans-in\/new$/);
    await expect(page.getByRole('heading', { name: 'New Job Work Challan In' })).toBeVisible();
  },
);

test(
  'JW challan-in dyed receipt derives the dyed state from its source, requires shade, and moves the two-sided ledger delta',
  async ({ page, db }) => {
    const Q = 10;
    const shadeNo = 'SHADE-E2E-01';

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    const src = await db.queryOne<{
      lot_number: string;
      sku_id: string;
      quality_id: string;
      quality_code: string;
      quality_name: string;
      sku_name: string;
      sku_shade_number: string | null;
      loc_name: string;
      floor_name: string;
      floor_id: string;
    }>(
      `SELECT s.lot_number, s.sku_id, s.quality_id,
              q.code AS quality_code, q.name AS quality_name,
              sku.name AS sku_name, sku.shade_number AS sku_shade_number,
              l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
       FROM stock_ledger s
       JOIN location_floors f ON f.id = s.floor_id
       JOIN locations l ON l.id = f.location_id
       JOIN yarn_qualities q ON q.id = s.quality_id
       JOIN yarn_skus sku ON sku.id = s.sku_id
       WHERE s.lot_number IS NOT NULL
         AND s.sku_id IS NOT NULL
         AND s.job_worker_id IS NULL
         AND l.status = 'active' AND f.status = 'active'
         AND q.status = 'active' AND sku.status = 'active'
         AND cardinality(s.processed_types) = 0
       GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
                sku.name, sku.shade_number, l.name, f.name, f.id
       HAVING SUM(s.in_quantity - s.out_quantity) >= $1
       ORDER BY s.lot_number
       LIMIT 1`,
      [Q],
    );
    expect(src, 'seed must provide a raw lot with >=10 balance on an active floor').not.toBeNull();

    const skuOptionLabel =
      src!.sku_shade_number !== null && src!.sku_shade_number !== ''
        ? `${src!.sku_name} — ${src!.sku_shade_number}`
        : src!.sku_name;

    const receivingFloor = await db.queryOne<{
      loc_code: string;
      loc_name: string;
      floor_name: string;
      floor_id: string;
    }>(
      `SELECT l.code AS loc_code, l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
       FROM location_floors f JOIN locations l ON l.id = f.location_id
       WHERE f.id <> $1 AND l.status = 'active' AND f.status = 'active'
       ORDER BY f.id LIMIT 1`,
      [src!.floor_id],
    );
    expect(receivingFloor, 'seed must provide a second active floor to receive into').not.toBeNull();

    // ── Step 0: open an at-job-worker position via JW-Challan-Out declaring
    //    'dyeing'. getByRole (not getByLabel) — the outer Operations <label>
    //    wraps the whole multi-select group (known FE quirk, task-14-report.md).
    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await page.getByRole('checkbox', { name: 'Dyeing', exact: true }).check();
    await selectByAriaLabel(
      page,
      'Quality for line 1',
      `${src!.quality_code} – ${src!.quality_name}`,
    );
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await selectByAriaLabel(page, 'Source lot for line 1', src!.lot_number);
    await fillByLabel(page, 'Net weight for line 1', String(Q));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select floor and location',
      `${src!.loc_name} · ${src!.floor_name}`,
    );
    await fillByLabel(page, 'placement quantity 1', String(Q));
    await clickButton(page, 'Save challan');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
    const outChallanNo = await captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);

    // ── Step 1: the "dyed" entry point redirects into the one consolidated form.
    await page.goto('/jw-challans-in/new/dyed');
    await expect(page).toHaveURL(/\/jw-challans-in\/new$/);

    // Section A identity — shade stays disabled until a dyeing source is picked.
    // The grid's SKU trigger is `sku, lots.N` (not "Select SKU" — that label
    // belongs to the JW-Out form's unchanged QualitySkuSelect default).
    await selectByAriaLabel(page, 'quality, lots.0', `${src!.quality_code} – ${src!.quality_name}`);
    await selectByAriaLabel(page, 'sku, lots.0', skuOptionLabel);
    await fillByLabel(page, 'net weight, lots.0', String(Q));
    await expect(page.getByLabel('shade, lots.0')).toBeDisabled();

    // Section B — pick the dyeing OUT item; consumed = Q, wastage auto (0).
    await clickButton(page, 'Add source');
    await clickButton(page, 'Pick eligible out item');
    await fillByLabel(page, 'Search OUT challan no', outChallanNo);
    const eligibleOption = page.getByRole('option', { name: outChallanNo });
    await expect(eligibleOption).toBeVisible();
    await eligibleOption.click();
    await fillByLabel(page, 'consumed quantity, pulls.0', String(Q));

    // Derived state now includes dyeing (Dyeing chip default-ticked) → the
    // shade cell enables and is required.
    const shadeCell = page.getByLabel('shade, lots.0');
    await expect(shadeCell).toBeEnabled();
    await shadeCell.fill(shadeNo);

    // Place the full quantity via the per-lot expander (D6).
    await page.getByLabel('place stock, lots.0').click();
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select location',
      `${receivingFloor!.loc_code} – ${receivingFloor!.loc_name}`,
    );
    await selectByAriaLabel(page, 'Select floor', receivingFloor!.floor_name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    // ── Two-sided delta, same keys as jw-in-yarn.spec.ts.
    const jwKey = {
      lotNumber: src!.lot_number,
      skuId: src!.sku_id,
      qualityId: src!.quality_id,
      floorId: null,
      jobWorkerId: jobWorker!.id,
    };
    const floorKey = {
      qualityId: src!.quality_id,
      skuId: src!.sku_id,
      floorId: receivingFloor!.floor_id,
    };

    const jwBefore = await db.ledgerBalance(jwKey);
    expect(jwBefore).toBeCloseTo(Q, 3);
    const floorBefore = await db.ledgerBalance(floorKey);

    await clickButton(page, 'Save receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-in\/[^/]+$/);

    const jwAfter = await db.ledgerBalance(jwKey);
    const floorAfter = await db.ledgerBalance(floorKey);

    expect(jwAfter - jwBefore).toBeCloseTo(-Q, 3);
    expect(floorAfter - floorBefore).toBeCloseTo(Q, 3);

    // DETAIL — the DERIVED dyed state + shade are reflected, not just accepted.
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWI-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();

    await gotoAndExpect(page, `/jw-challans-in/${challanId}`);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan In ${challanNo}` }),
    ).toBeVisible();
    await expect(page.getByText('Dyeing').first()).toBeVisible();
    await expect(page.getByText(shadeNo)).toBeVisible();
  },
);
