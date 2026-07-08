import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// JW Challan In "dyed" is NOT a separate route/form — router.tsx redirects
// /jw-challans-in/new/dyed → /jw-challans-in/new/yarn (Navigate replace). "Dyed" is
// represented entirely within the yarn form: YarnLineRow.tsx derives
// `isDyed = processedTypes.includes('dyeing')` from the same JobWorkTypeMultiSelect
// used for twisting/gassing, and conditionally renders a required "Shade No" input
// (shadeNo, aria-label `shade number, yarn lot ${n}`) — enforced by the shared zod
// schema (jw-challan-in.ts: shadeNo required when processedTypes includes 'dyeing').
// Multi-source (YarnLineSourceSubTable / EligibleOutItemSourcePicker) is the SAME
// component regardless of processed type — per memory the dyed-only multi-source
// gate was lifted, so combining sources is no longer what distinguishes "dyed" from
// Task 13's plain yarn receipt. This spec isolates the dyed-specific behavior
// (processedTypes=['dyeing'] + shadeNo) with the SAME single-source topology as
// Task 13, so the only material diff between the two specs is the processed type —
// keeping the two-sided ledger delta assertion clean and non-tautological.
//
// Ledger: applyChallanInYarnLedger (prisma-inventory.service.ts) is the ONE ledger
// function for both plain and dyed yarn receipts — there is no separate "dyed"
// ledger path. It writes the same two legs as jw-in-yarn.spec.ts documents:
//   Leg A (JW-debit) keyed on { lotNumber: src.sourceLotNumber, skuId, qualityId,
//     locationId: null, floorId: null, jobWorkerId: src.jobWorkerId } — drains the
//     position the prerequisite JW-Out opened.
//   Leg B (floor-credit) keyed on { lotNumber: <fresh minted lot>, skuId, qualityId,
//     locationId, floorId, jobWorkerId: null } — credits the receiving floor.
// isValidInputState (fabtraq-shared primitives/job-work.ts) confirms a raw lot
// (processedTypes=[]) is valid input for 'dyeing' (predicate: !P.has('dyeing') &&
// !beam-intersect), so the same raw-lot / job-worker prerequisite pattern used by
// jw-in-yarn.spec.ts for 'twisting' works unchanged for 'dyeing' — job workers carry
// no capability gate (jw-challan-out.service.ts only checks existence + active
// status), and no seeded JW-out to a dyeing job worker is left outstanding (the
// seed's own dyed M:N scenario, JW-002/"Rang Rang Dyeworks", is fully_received), so
// this spec opens its own at-job-worker position first, same as Task 13.

test(
  '/jw-challans-in/new/dyed redirects to the yarn form (dyed is not a separate route)',
  async ({ page }) => {
    await page.goto('/jw-challans-in/new/dyed');
    await expect(page).toHaveURL(/\/jw-challans-in\/new\/yarn/);
  },
);

test(
  'JW challan-in dyed (processed) receipt drains the at-job-worker position and credits a receiving floor with a two-sided ledger delta',
  async ({ page, db }) => {
    const Q = 10;
    const shadeNo = 'SHADE-E2E-01';

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    // Raw lot (unprocessed, cardinality(processed_types)=0) — isValidInputState
    // confirms this is valid input for 'dyeing' too (same predicate shape as
    // 'twisting'/'gassing': not-already-dyed, not a beam-stage lot).
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

    // Receiving floor DISTINCT from the source floor (jw-in-yarn.spec.ts pattern) so
    // the floor-credit leg's "before" balance is unambiguous.
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

    // ── Step 0: open an at-job-worker position via JW-Challan-Out, requesting
    //    'dyeing' (not 'twisting') as the job-work type — this is the outstanding
    //    JW-out this dyed receipt receives against. No seeded outstanding dyeing
    //    JW-out is available (seed's dyed scenario is fully_received), so drive it
    //    inline, same as jw-in-yarn.spec.ts does for the plain yarn case.
    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    // NOTE (real FE bug, reported not fixed — see task-14-report.md): on this form,
    // jw-challan-out-form.page.tsx's `Field` wraps its children in a <label>, so the
    // "Operations *" field's outer <label> wraps the ENTIRE JobWorkTypeMultiSelect
    // group (all 6 option <label>s nested inside it). That outer label's aggregated
    // text therefore contains every option's text, including "Dyeing"; since it has
    // no htmlFor, its implicit target is the FIRST control inside it (the "Twisting"
    // checkbox). getByLabel('Dyeing') naively matches both the correct inner label
    // ("Dyeing" → jwt-dyeing) AND that outer label (whose text also contains
    // "Dyeing", implicitly targeting jwt-twisting) → strict-mode violation (2
    // elements). getByRole('checkbox', { name: 'Dyeing' }) uses real accessible-name
    // computation and is unambiguous, so it's used here instead.
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

    // ── Step 1: JW-Challan-In via the "dyed" entry point — redirected to the same
    //    yarn form Task 13 uses (asserted standalone above; re-confirmed here as
    //    part of the real navigation path).
    await page.goto('/jw-challans-in/new/dyed');
    await expect(page).toHaveURL(/\/jw-challans-in\/new\/yarn$/);

    await clickButton(page, 'Add yarn lot');

    await selectByAriaLabel(page, 'quality, yarn lot 1', `${src!.quality_code} – ${src!.quality_name}`);
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);

    // Processed Types — 'dyeing' (not 'twisting') is what makes this the dyed
    // variant; ticking it reveals the required Shade No input (YarnLineRow.tsx
    // `isDyed`).
    await page.getByLabel('Dyeing').check();
    await fillByLabel(page, 'shade number, yarn lot 1', shadeNo);

    await fillByLabel(page, 'net weight, yarn lot 1', String(Q));

    await clickButton(page, 'Pick eligible out item');
    await fillByLabel(page, 'Search OUT challan no', outChallanNo);
    const eligibleOption = page.getByRole('option', { name: outChallanNo });
    await expect(eligibleOption).toBeVisible();
    await eligibleOption.click();

    // Fully receive Q with zero wastage/still-at-JW so the conservation invariant
    // holds and the JW-debit leg's outQuantity (consumedQty + wastage) equals
    // exactly Q.
    await fillByLabel(page, 'consumed quantity, source 1', String(Q));
    await fillByLabel(page, 'wastage, source 1', '0');
    await fillByLabel(page, 'still at JW quantity, source 1', '0');

    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select location',
      `${receivingFloor!.loc_code} – ${receivingFloor!.loc_name}`,
    );
    await selectByAriaLabel(page, 'Select floor', receivingFloor!.floor_name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    // ── Two-sided delta, keyed exactly as applyChallanInYarnLedger writes them
    // (same function, same keys as the plain-yarn Task 13 spec — 'dyed' changes
    // only the processedTypes value written into Leg B, not the key shape).
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

    // DETAIL — capture the minted entry number and confirm the dyed-specific fields
    // (processed type "Dyeing" badge + Shade No) are actually reflected, not just
    // accepted silently.
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWI-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();

    await gotoAndExpect(page, `/jw-challans-in/${challanId}`);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan In ${challanNo}` }),
    ).toBeVisible();
    await expect(page.getByText('Dyeing')).toBeVisible();
    await expect(page.getByText(shadeNo)).toBeVisible();
  },
);
