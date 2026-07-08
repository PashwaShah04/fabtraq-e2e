import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// JW Challan In (yarn) is the mirror of JW Challan Out: it drains the at-job-worker
// position that a prior challan-out opened, and credits a receiving floor with the
// processed yarn. applyChallanInYarnLedger (prisma-inventory.service.ts) writes TWO
// ledger legs per yarn item:
//   Leg A (JW-debit, one row per source link) — keyed on
//     { lotNumber: src.sourceLotNumber, skuId: p.skuId, qualityId: p.qualityId,
//       locationId: null, floorId: null, jobWorkerId: src.jobWorkerId },
//     outQuantity = consumedQty + wastage. `src.sourceLotNumber` and `src.jobWorkerId`
//     are resolved server-side from the referenced JwChallanOutItem's own parent
//     challan (resolveOutItemMetas), so this is EXACTLY the same key the original
//     JW-Out's credit leg used to open the position — draining it.
//   Leg B (floor-credit, one row per placement) — keyed on
//     { lotNumber: p.lotNumber (a FRESH minted lot — unknown before Save),
//       skuId: p.skuId, qualityId: p.qualityId, locationId: placement.locationId,
//       floorId: placement.floorId, jobWorkerId: null }, inQuantity = placement.quantity.
//
// Prerequisite: an OUTSTANDING JW-out to receive against. All 4 JW-out challans the
// seed creates (prisma/seed.ts) are immediately paired with a matching JW-in/BeamReceipt
// and flipped to 'fully_received' inside the same seed transaction — confirmed by
// grepping `jwChallanOut.create`/`jwChallanOut.update` (4 creates, 4 updates to
// 'fully_received') and by querying `jw_challans_out` status counts on a freshly
// seeded DB (only 'sent'/'fully_received' rows exist, and the lone 'sent' row
// observed pre-run was leftover runtime data from a prior spec, not seed data).
// So option (a) — reuse a seeded outstanding JW-out — is NOT available; this spec
// drives the JW-Out flow itself first (same approach as jw-out.spec.ts) to open a
// fresh at-job-worker position, then receives against it in the same test.
test(
  'JW challan-in (yarn) drains the at-job-worker position and credits a receiving floor with a two-sided ledger delta',
  async ({ page, db }) => {
    const Q = 10;

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    // Same raw-lot derivation as jw-out.spec.ts: a floor-held, unprocessed lot with
    // >= Q balance, restricted to active masters so it mirrors what the FE's own
    // pickers would offer.
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

    // A receiving floor DISTINCT from the source floor, so the floor-credit leg's
    // "before" balance is unambiguous and unrelated to the JW-Out step's own
    // floor-debit row.
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

    // ── Step 0: open an at-job-worker position via JW-Challan-Out (jw-out.spec.ts
    //    pattern) — this is our "outstanding JW-out to receive against" (option (b);
    //    see top-of-file note on why the seed can't supply one).
    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await page.getByLabel('Twisting').check();
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

    // ── Step 1: JW-Challan-In chooser → yarn form.
    await gotoAndExpect(page, '/jw-challans-in/new');
    await expect(
      page.getByRole('heading', { name: 'New JW Challan In — choose receive type' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Yarn (twisted / gassed / dyed)' }).click();
    await expect(page).toHaveURL(/\/jw-challans-in\/new\/yarn$/);

    await clickButton(page, 'Add yarn lot');

    // Identity — quality/SKU aria-labels are "quality, yarn lot 1" /
    // "Select SKU" (YarnLineRow.tsx / QualitySkuSelect.tsx, reused from
    // yarn-purchases). Matching the OUT item's own quality+SKU keeps the
    // received item's declared skuId/qualityId identical to the ones the
    // JW-debit leg's key is built from server-side.
    await selectByAriaLabel(page, 'quality, yarn lot 1', `${src!.quality_code} – ${src!.quality_name}`);
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);

    // Processed Types (JobWorkTypeMultiSelect, shared component — same "Twisting"
    // checkbox used for the OUT challan's job-work-types field above).
    await page.getByLabel('Twisting').check();

    await fillByLabel(page, 'net weight, yarn lot 1', String(Q));

    // Source row: EligibleOutItemSourcePicker is a Popover (not a shadcn Select),
    // so it needs its own open → search → pick-option sequence rather than
    // selectByAriaLabel. Search is a case-insensitive `contains` on the parent
    // challanNo (findEligibleOutItems), so searching by the exact minted OUT
    // challan number returns exactly one row.
    await clickButton(page, 'Pick eligible out item');
    await fillByLabel(page, 'Search OUT challan no', outChallanNo);
    const eligibleOption = page.getByRole('option', { name: outChallanNo });
    await expect(eligibleOption).toBeVisible();
    await eligibleOption.click();

    // Fully receive Q with zero wastage/still-at-JW so the conservation invariant
    // (|Σconsumed − Σwastage − ΣstillAtJwQty − netWeight| ≤ 0.001) holds and the
    // JW-debit leg's outQuantity (consumedQty + wastage) equals exactly Q.
    await fillByLabel(page, 'consumed quantity, source 1', String(Q));
    await fillByLabel(page, 'wastage, source 1', '0');
    await fillByLabel(page, 'still at JW quantity, source 1', '0');

    // Placement — plain LocationFloorSelect (no availableFloors prop passed for
    // the JW-In path), same "Select location" / "Select floor" pattern as
    // yarn-purchase.spec.ts.
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select location',
      `${receivingFloor!.loc_code} – ${receivingFloor!.loc_name}`,
    );
    await selectByAriaLabel(page, 'Select floor', receivingFloor!.floor_name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    // ── Two-sided delta, both keyed exactly as applyChallanInYarnLedger writes them.
    // Leg A (JW position): lotNumber/jobWorkerId are the SAME key the JW-Out step's
    // credit leg opened above — it holds a real +Q balance before this action (not
    // a tautological 0→delta), and must drain to 0 (delta -Q) after Save.
    const jwKey = {
      lotNumber: src!.lot_number,
      skuId: src!.sku_id,
      qualityId: src!.quality_id,
      floorId: null,
      jobWorkerId: jobWorker!.id,
    };
    // Leg B (receiving floor): lotNumber omitted — the IN item mints a brand-new lot
    // number server-side that isn't knowable before Save (yarn-purchase.spec.ts
    // pattern). Scoped to the exact (quality, sku, floor) triple we drove into the
    // UI; the assertion is the DELTA around the Save action, not an absolute sum.
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

    // DETAIL — capture the minted entry number, scoped to <main>, regex anchored to
    // the real prefix confirmed via formatJwChallanInNo (fabtraq-shared
    // primitives/entry-no.ts: `JWI-<financialYear>-<seq>`, e.g. "JWI-2025-26-001").
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWI-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();

    await gotoAndExpect(page, `/jw-challans-in/${challanId}`);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan In ${challanNo}` }),
    ).toBeVisible();
  },
);
