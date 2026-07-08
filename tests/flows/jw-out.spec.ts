import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// JW Challan Out moves stock OUT of a floor position and INTO an at-job-worker
// position (jw-challan-out.service.ts `applyChallanOutLedger` writes two ledger
// legs per placement: Leg 1 debits the source floor — skuId/lotNumber/floorId
// carried straight from the form's item — Leg 2 credits the job worker with
// locationId=floorId=null). We only assert Leg 1's key (the source floor debit);
// Leg 2 lives at a distinct (floorId=null, jobWorkerId=<jw>) key that stock-transfer's
// pattern doesn't need to touch.
//
// The item's `skuId` is form-driven (create service: `skuId: item.skuId ?? undefined`
// flows straight into the ledger write) — if the form never selects a SKU, the
// written Leg-1 row would carry skuId=null even though the *source* stock (the row
// our seed query found) has a real skuId. That would silently target a DIFFERENT
// ledger key than the one we assert against. So this spec explicitly drives the
// SKU picker (unlike stock-transfer.spec.ts's source picker, which is keyed by lot
// alone) to keep the UI-selection and the asserted key on the exact same row.
test(
  'JW challan-out sends stock from a source floor to a job worker with a -Q ledger delta',
  async ({ page, db }) => {
    const Q = 10;

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    // Derive the source position from the ledger exactly the way
    // SourceLotPicker + AvailableFloorSelect will render it:
    //  - jobWorkerId IS NULL + floorId/locationId NOT NULL: a floor position, not an
    //    at-JW position (SourceLotPicker's underlying `listAggregatedLots` rolls up
    //    per-floor balances into `placements[]`; only floor rows can appear there).
    //  - cardinality(processed_types) = 0: a raw/unprocessed lot. `isValidInputState`
    //    (fabtraq-shared primitives/job-work.ts) requires `!P.has('twisting') &&
    //    !hasAny(['warping','sizing','weaving'])` for the 'twisting' operation — a raw
    //    lot always satisfies this, so picking 'twisting' as the challan's operation
    //    is guaranteed valid input for whatever raw lot we find here.
    //  - status = 'active' on location/floor/quality/sku: mirrors the active-only
    //    filters the FE's own master-data selects apply.
    const src = await db.queryOne<{
      lot_number: string;
      sku_id: string;
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

    // 2) Drive the form with the derived values.
    await gotoAndExpect(page, '/jw-challans-out/new');

    // Job worker is a plain native <select aria-label="Job worker">
    // (jw-challan-out-form.page.tsx), not a shadcn Select — selectNativeByLabel
    // routes through Playwright's selectOption() instead of the click+click
    // pattern the other helpers use.
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);

    // Operations checkboxes (JobWorkTypeMultiSelect, shared/components) are plain
    // <input type="checkbox"> wrapped in <label htmlFor>, labelled via
    // JOB_WORK_TYPE_LABELS['twisting'] = 'Twisting'. Must be selected before the
    // source-lot picker below — SourceLotPicker is disabled until jobWorkTypes is
    // non-empty (SourceLotPicker.tsx: `isReady = qualityId !== '' && hasJobWorkTypes`).
    await page.getByLabel('Twisting').check();

    // Line item 1: quality select is aria-label="Quality for line 1"
    // (ChallanOutLineItemRow.tsx), same shadcn-Select pattern as yarn-purchase.
    await selectByAriaLabel(
      page,
      'Quality for line 1',
      `${src!.quality_code} – ${src!.quality_name}`,
    );

    // SKU (QualitySkuSelect.tsx, reused from yarn-purchases) is aria-label
    // "Select SKU"; option label is "<name> — <shadeNumber>" when a shade number
    // exists. Selecting the SKU narrows the source-lot picker to lots of this
    // exact (quality, sku) AND makes the item's submitted skuId match the seed
    // row's real skuId (see top-of-file note on why this matters for the delta key).
    const skuOptionLabel =
      src!.sku_shade_number !== null && src!.sku_shade_number !== ''
        ? `${src!.sku_name} — ${src!.sku_shade_number}`
        : src!.sku_name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);

    // Source lot (SourceLotPicker.tsx) is aria-label "Source lot for line 1";
    // option label starts with the raw lot number, so a substring match selects it.
    // Selecting it populates `availableFloors` from the lot's per-floor placements
    // (SourceLotPicker onChange -> ChallanOutLineItemRow -> AvailableFloorSelect).
    await selectByAriaLabel(page, 'Source lot for line 1', src!.lot_number);

    await fillByLabel(page, 'Net weight for line 1', String(Q));

    // Placements: PlacementFieldArray (shared/components), JW-Out path — renders
    // AvailableFloorSelect (aria-label "Select floor and location") instead of the
    // free LocationFloorSelect the yarn-purchase form uses, constrained to the
    // lot's actual floor positions with their live `available` balance.
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select floor and location',
      `${src!.loc_name} · ${src!.floor_name}`,
    );
    await fillByLabel(page, 'placement quantity 1', String(Q));

    // 3) Assert the ledger delta on the SAME (lotNumber, skuId, floorId) key the
    // seed query found. Non-tautological: the key already had a positive balance
    // before the action (seeded stock), the assertion is the after-minus-before
    // DELTA around the create call (not an absolute sum), and Leg 1 of
    // applyChallanOutLedger only fires if mintPlacements + the ledger write both
    // succeed for this exact floorId — a regression that dropped the floor debit
    // (e.g. the yarn-purchase "zero placements" class of bug) or wrote it to the
    // wrong key would leave this delta at 0 or a different magnitude.
    const key = { lotNumber: src!.lot_number, skuId: src!.sku_id, floorId: src!.floor_id };
    const { delta } = await db.ledgerDelta(key, async () => {
      await clickButton(page, 'Save challan');
      await expectToast(page, /^Saved /);
      await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
    });
    expect(delta).toBeCloseTo(-Q, 3);

    // DETAIL — capture the minted challan number, scoped to <main> with a regex
    // anchored to the real prefix confirmed via formatJwChallanOutNo
    // (fabtraq-shared/src/primitives/entry-no.ts: `JWO-<financialYear>-<seq>`,
    // e.g. "JWO-2025-26-001").
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();

    // Re-navigate to the detail route directly (not just the post-save redirect)
    // to confirm the route itself renders on a fresh load.
    await gotoAndExpect(page, `/jw-challans-out/${challanId}`);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan Out ${challanNo}` }),
    ).toBeVisible();
  },
);
