import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// JW Challan In (yarn) — PER-LOT SOURCES FORM (spec 2026-07-23, supersedes the
// 2026-07-22 consolidated-form spec's Section B/allocator/Place-expander):
// /jw-challans-in/new renders the form directly (chooser page deleted, D4).
// Section A is a received-lots grid (aria `quality, lots.N` / `sku, lots.N` /
// `net weight, lots.N` / work-done chips); Section B ("Sources at job worker")
// is grouped BY LOT — each lot has its own `+ Add source` button
// (`add source, lots.N`) and its own source rows, one picker trigger per row
// (`source, lots.N.sources.J`, aria via `EligibleOutItemSourcePicker`'s
// `triggerAriaLabel` prop), `consumed quantity, lots.N.sources.J` /
// `still at JW quantity, lots.N.sources.J` / `wastage override,
// lots.N.sources.J`. ANY out-item can feed ANY lot regardless of quality/SKU
// (no yarn-key restriction, no cross-lot allocator) — the same out-item can
// feed two DIFFERENT lots but not two rows of the SAME lot. Section C
// ("Place stock") is an ALWAYS-VISIBLE region per lot (`place stock,
// lots.N`, `role="region"`) — no click-to-reveal toggle anymore; its
// `PlacementFieldArray` fields (`Add placement`, `Select location`, `Select
// floor`, `placement quantity N`) are unchanged. `processedTypes` is NOT
// entered — the BE derives it from (each source's prior state ∪ work marked
// done), and the work-done chips default to ticked.
//
// Ledger contract is unchanged from the pre-redesign spec:
// applyChallanInYarnLedger writes TWO legs per source row:
//   Leg A (JW-debit, per source link) keyed on { lotNumber: src.sourceLotNumber,
//     skuId, qualityId, locationId: null, floorId: null, jobWorkerId },
//     outQuantity = consumedQty + wastage — draining the position the JW-Out
//     opened.
//   Leg B (floor-credit, per placement) keyed on { lotNumber: <fresh minted
//     lot>, skuId, qualityId, locationId, floorId, jobWorkerId: null }.
//
// Prerequisite: an OUTSTANDING JW-out (all seeded outs are fully_received), so
// each test drives the JW-Out flow first — same approach as jw-out.spec.ts.

interface SourceLotRow {
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
}

const RAW_LOT_SQL = `SELECT s.lot_number, s.sku_id, s.quality_id,
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
 LIMIT 1`;

// Same shape as RAW_LOT_SQL but scoped to one SKU code — used by the
// cross-SKU test to pin down the RED (SKU-001) and BLUE (SKU-002) raw lots
// independently under the single seeded quality that carries two SKUs
// (QTY-001).
const RAW_LOT_FOR_SKU_SQL = `SELECT s.lot_number, s.sku_id, s.quality_id,
        q.code AS quality_code, q.name AS quality_name,
        sku.name AS sku_name, sku.shade_number AS sku_shade_number,
        l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
 FROM stock_ledger s
 JOIN location_floors f ON f.id = s.floor_id
 JOIN locations l ON l.id = f.location_id
 JOIN yarn_qualities q ON q.id = s.quality_id
 JOIN yarn_skus sku ON sku.id = s.sku_id
 WHERE s.lot_number IS NOT NULL
   AND s.job_worker_id IS NULL
   AND l.status = 'active' AND f.status = 'active'
   AND q.status = 'active' AND sku.status = 'active'
   AND cardinality(s.processed_types) = 0
   AND sku.code = $1
 GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
          sku.name, sku.shade_number, l.name, f.name, f.id
 HAVING SUM(s.in_quantity - s.out_quantity) >= $2
 ORDER BY s.lot_number
 LIMIT 1`;

function skuLabelOf(src: SourceLotRow): string {
  return src.sku_shade_number !== null && src.sku_shade_number !== ''
    ? `${src.sku_name} — ${src.sku_shade_number}`
    : src.sku_name;
}

/** Drives /jw-challans-out/new to open a fresh at-JW position for `src`. */
async function openJwPosition(
  page: import('@playwright/test').Page,
  jobWorker: { code: string; name: string },
  src: SourceLotRow,
  jobWorkTypeLabel: string,
  q: number,
): Promise<string> {
  await gotoAndExpect(page, '/jw-challans-out/new');
  await selectNativeByLabel(page, 'Job worker', `${jobWorker.code} – ${jobWorker.name}`);
  // getByRole (not getByLabel) — the outer Operations <label> wraps the whole
  // multi-select group; see jw-in-dyed.spec.ts note on the known FE quirk.
  await page.getByRole('checkbox', { name: jobWorkTypeLabel, exact: true }).check();
  await selectByAriaLabel(page, 'Quality for line 1', `${src.quality_code} – ${src.quality_name}`);
  await selectByAriaLabel(page, 'Select SKU', skuLabelOf(src));
  await selectByAriaLabel(page, 'Source lot for line 1', src.lot_number);
  await fillByLabel(page, 'Net weight for line 1', String(q));
  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select floor and location', `${src.loc_name} · ${src.floor_name}`);
  await fillByLabel(page, 'placement quantity 1', String(q));
  await clickButton(page, 'Save challan');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
  return captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
}

/**
 * Drives the per-lot-sources JW-In form for the single-source case: one
 * received lot (quality/SKU/net), one source row under `lots.0` picked
 * against `outChallanNo` (consumed = q, wastage auto, still 0), fully placed
 * onto `floor` via the always-visible Place-stock region. Assumes the
 * work-done chips stay default-ticked.
 */
async function receiveLot(
  page: import('@playwright/test').Page,
  src: SourceLotRow,
  outChallanNo: string,
  floor: { loc_code: string; loc_name: string; floor_name: string },
  q: number,
): Promise<void> {
  await gotoAndExpect(page, '/jw-challans-in/new');
  await expect(page.getByRole('heading', { name: 'New Job Work Challan In' })).toBeVisible();

  // Section A — the grid starts with one empty lot row. The grid's SKU
  // trigger is `sku, lots.N` (ReceivedLotsGrid SkuCell), unlike the JW-Out
  // form which keeps QualitySkuSelect's default "Select SKU". Unchanged by
  // the per-lot-sources redesign.
  await selectByAriaLabel(page, 'quality, lots.0', `${src.quality_code} – ${src.quality_name}`);
  await selectByAriaLabel(page, 'sku, lots.0', skuLabelOf(src));
  await fillByLabel(page, 'net weight, lots.0', String(q));

  // Section B — grouped by lot: add a source row under lot 0, pick the
  // freshly minted OUT item; consumed = q; wastage stays blank (auto = 0
  // since consumed == net); still-at-JW defaults to 0.
  await page.getByLabel('add source, lots.0').click();
  await page.getByLabel('source, lots.0.sources.0').click();
  await fillByLabel(page, 'Search OUT challan no', outChallanNo);
  const eligibleOption = page.getByRole('option', { name: outChallanNo });
  await expect(eligibleOption).toBeVisible();
  await eligibleOption.click();
  await fillByLabel(page, 'consumed quantity, lots.0.sources.0', String(q));

  // Work-done chips appear once the source is picked, default ticked (D3) —
  // no interaction needed; assert presence so a silent regression can't pass.
  await expect(page.getByLabel('work done, lots.0')).toBeVisible();

  // Place the full quantity via the always-visible Place-stock region (no
  // click-to-reveal expander anymore) so the minted lot is fully_placed and
  // immediately sourceable by a follow-up JW-Out.
  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select location', `${floor.loc_code} – ${floor.loc_name}`);
  await selectByAriaLabel(page, 'Select floor', floor.floor_name);
  await fillByLabel(page, 'placement quantity 1', String(q));

  await clickButton(page, 'Save receipt');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-in\/[^/]+$/);
}

test(
  'JW challan-in (yarn) drains the at-job-worker position and credits a receiving floor with a two-sided ledger delta',
  async ({ page, db }) => {
    const Q = 10;

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    const src = await db.queryOne<SourceLotRow>(RAW_LOT_SQL, [Q]);
    expect(src, 'seed must provide a raw lot with >=10 balance on an active floor').not.toBeNull();

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

    const outChallanNo = await openJwPosition(page, jobWorker!, src!, 'Twisting', Q);

    // Two-sided delta, keyed exactly as applyChallanInYarnLedger writes them.
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

    await receiveLot(page, src!, outChallanNo, receivingFloor!, Q);

    const jwAfter = await db.ledgerBalance(jwKey);
    const floorAfter = await db.ledgerBalance(floorKey);

    expect(jwAfter - jwBefore).toBeCloseTo(-Q, 3);
    expect(floorAfter - floorBefore).toBeCloseTo(Q, 3);

    // DETAIL — entry number + the DERIVED state (never user-entered on the new
    // form): a twisting round-trip must show as Twisting on the detail card.
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWI-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();

    await gotoAndExpect(page, `/jw-challans-in/${challanId}`);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan In ${challanNo}` }),
    ).toBeVisible();
    await expect(page.getByText('Twisting').first()).toBeVisible();
  },
);

test(
  'two-stage chain (twisting → gassing) accumulates processedTypes: the second receipt lands as twisted + gassed in stock_ledger',
  async ({ page, db }) => {
    const Q = 10;

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    const src = await db.queryOne<SourceLotRow>(RAW_LOT_SQL, [Q]);
    expect(src, 'seed must provide a raw lot with >=10 balance on an active floor').not.toBeNull();

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

    // ── Stage 1: raw lot → twisting → received as fresh lot B on receivingFloor.
    const out1 = await openJwPosition(page, jobWorker!, src!, 'Twisting', Q);
    await receiveLot(page, src!, out1, receivingFloor!, Q);

    // Lot B is minted server-side; resolve it from the DB keyed by the saved
    // challan id (the detail page shows source lot numbers too, so scraping
    // the first LOT-… match would be ambiguous).
    const in1Id = page.url().split('/').pop();
    const lotBRow = await db.queryOne<{ lot_no: string }>(
      `SELECT lot_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [in1Id],
    );
    expect(lotBRow).not.toBeNull();
    const lotB = lotBRow!.lot_no;
    expect(lotB).not.toBe(src!.lot_number);

    // ── Stage 2: send lot B (now twisted, at receivingFloor) out for gassing.
    // The JW-Out source picker must offer it: isValidInputState(['twisting'],
    // ['gassing']) is true, and stage 1 fully placed it.
    const srcB: SourceLotRow = {
      ...src!,
      lot_number: lotB,
      loc_name: receivingFloor!.loc_name,
      floor_name: receivingFloor!.floor_name,
      floor_id: receivingFloor!.floor_id,
    };
    const out2 = await openJwPosition(page, jobWorker!, srcB, 'Gassing', Q);
    await receiveLot(page, srcB, out2, receivingFloor!, Q);

    // Detail page shows the ACCUMULATED derived state — both stages.
    await expect(page.getByText('Twisting').first()).toBeVisible();
    await expect(page.getByText('Gassing').first()).toBeVisible();

    // Source of truth: the final minted lot's newest stock_ledger row carries
    // BOTH types (standing rule: assert inventory impact against stock_ledger).
    const in2Id = page.url().split('/').pop();
    const lotCRow = await db.queryOne<{ lot_no: string }>(
      `SELECT lot_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [in2Id],
    );
    expect(lotCRow).not.toBeNull();
    const ledgerRow = await db.queryOne<{ processed_types: string[] }>(
      `SELECT processed_types FROM stock_ledger
       WHERE lot_number = $1 ORDER BY created_at DESC LIMIT 1`,
      [lotCRow!.lot_no],
    );
    expect(ledgerRow).not.toBeNull();
    expect([...ledgerRow!.processed_types].sort()).toEqual(['gassing', 'twisting']);
  },
);

test(
  'JW challan-in (yarn) cross-SKU multi-source: one received lot draws from two different-SKU job-worker sources',
  async ({ page, db }) => {
    // The old key-matching allocator made this unenterable ("orphan pulls");
    // the per-lot-sources redesign lifts the restriction entirely (spec
    // 2026-07-23 P2 — quality/SKU may differ, no warning). RED (SKU-001) and
    // BLUE (SKU-002) are the only two SKUs the seed ships under one quality
    // (QTY-001), which is exactly what's needed to build two distinct-SKU
    // sources without provisioning a whole new quality.
    const Q_RED = 6;
    const Q_BLUE = 5;
    const Q_TOTAL = Q_RED + Q_BLUE;

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE code = 'QTY-001'`,
    );
    expect(
      quality,
      'seed must provide QTY-001 — the one quality carrying two SKUs (RED/BLUE)',
    ).not.toBeNull();

    const srcRed = await db.queryOne<SourceLotRow>(RAW_LOT_FOR_SKU_SQL, ['SKU-001', Q_RED]);
    expect(srcRed, 'seed must provide a raw SKU-001 (RED) lot with sufficient balance').not.toBeNull();
    const srcBlue = await db.queryOne<SourceLotRow>(RAW_LOT_FOR_SKU_SQL, ['SKU-002', Q_BLUE]);
    expect(srcBlue, 'seed must provide a raw SKU-002 (BLUE) lot with sufficient balance').not.toBeNull();

    const receivingFloor = await db.queryOne<{
      loc_code: string;
      loc_name: string;
      floor_name: string;
      floor_id: string;
    }>(
      `SELECT l.code AS loc_code, l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
       FROM location_floors f JOIN locations l ON l.id = f.location_id
       WHERE l.status = 'active' AND f.status = 'active'
       ORDER BY f.id LIMIT 1`,
    );
    expect(receivingFloor, 'seed must provide an active floor to receive into').not.toBeNull();

    const outNoRed = await openJwPosition(page, jobWorker!, srcRed!, 'Twisting', Q_RED);
    const outNoBlue = await openJwPosition(page, jobWorker!, srcBlue!, 'Twisting', Q_BLUE);

    // The received lot's own SKU must be a THIRD one, distinct from both
    // sources' SKUs — the seed only ships RED/SKU-001 and BLUE/SKU-002 under
    // QTY-001, so create it via the quality edit form's SKU field-array
    // (same pattern as tests/masters/qualities.spec.ts).
    const thirdSkuName = codes.unique('SKU CrossFeed');
    await gotoAndExpect(page, `/qualities/${quality!.id}/edit`);
    await page.getByRole('tab', { name: 'SKUs' }).click();
    await fillByLabel(page, 'Name', thirdSkuName);
    await clickButton(page, 'Add SKU');
    await expectToast(page, 'SKU created');

    await gotoAndExpect(page, '/jw-challans-in/new');
    await expect(page.getByRole('heading', { name: 'New Job Work Challan In' })).toBeVisible();

    await selectByAriaLabel(page, 'quality, lots.0', `${quality!.code} – ${quality!.name}`);
    await selectByAriaLabel(page, 'sku, lots.0', thirdSkuName);
    await fillByLabel(page, 'net weight, lots.0', String(Q_TOTAL));

    // Source row 1 — the RED out item.
    await page.getByLabel('add source, lots.0').click();
    await page.getByLabel('source, lots.0.sources.0').click();
    await fillByLabel(page, 'Search OUT challan no', outNoRed);
    const redOption = page.getByRole('option', { name: outNoRed });
    await expect(redOption).toBeVisible();
    await redOption.click();
    await fillByLabel(page, 'consumed quantity, lots.0.sources.0', String(Q_RED));

    // Source row 2 — the BLUE out item, under the SAME received lot.
    await page.getByLabel('add source, lots.0').click();
    await page.getByLabel('source, lots.0.sources.1').click();
    await fillByLabel(page, 'Search OUT challan no', outNoBlue);
    const blueOption = page.getByRole('option', { name: outNoBlue });
    await expect(blueOption).toBeVisible();
    await blueOption.click();
    await fillByLabel(page, 'consumed quantity, lots.0.sources.1', String(Q_BLUE));

    // Balanced (6 + 5 = 11 == net) — the old "orphan pull" failure mode is
    // impossible now: no coverage error despite the two sources carrying
    // different SKUs than the lot and each other. `source coverage, lots.N`
    // is a bare <span aria-label>, not a form control, so use the attribute
    // selector (repo convention, same as `selectByAriaLabel`'s locator) —
    // `getByLabel` is reserved for form-control aria-labels elsewhere in
    // this suite.
    await expect(page.locator('[aria-label="source coverage, lots.0"]')).toHaveText('✓ covered');

    // Place the full combined quantity via the always-visible Place-stock region.
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select location',
      `${receivingFloor!.loc_code} – ${receivingFloor!.loc_name}`,
    );
    await selectByAriaLabel(page, 'Select floor', receivingFloor!.floor_name);
    await fillByLabel(page, 'placement quantity 1', String(Q_TOTAL));

    const jwKeyRed = {
      lotNumber: srcRed!.lot_number,
      skuId: srcRed!.sku_id,
      qualityId: srcRed!.quality_id,
      floorId: null,
      jobWorkerId: jobWorker!.id,
    };
    const jwKeyBlue = {
      lotNumber: srcBlue!.lot_number,
      skuId: srcBlue!.sku_id,
      qualityId: srcBlue!.quality_id,
      floorId: null,
      jobWorkerId: jobWorker!.id,
    };
    const jwRedBefore = await db.ledgerBalance(jwKeyRed);
    const jwBlueBefore = await db.ledgerBalance(jwKeyBlue);
    expect(jwRedBefore).toBeCloseTo(Q_RED, 3);
    expect(jwBlueBefore).toBeCloseTo(Q_BLUE, 3);

    await clickButton(page, 'Save receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-in\/[^/]+$/);

    // Both at-JW positions drained — one per source, independently.
    const jwRedAfter = await db.ledgerBalance(jwKeyRed);
    const jwBlueAfter = await db.ledgerBalance(jwKeyBlue);
    expect(jwRedAfter - jwRedBefore).toBeCloseTo(-Q_RED, 3);
    expect(jwBlueAfter - jwBlueBefore).toBeCloseTo(-Q_BLUE, 3);

    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWI-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();

    // Source of truth for the minted lot's inventory impact: stock_ledger,
    // not /inventory (standing rule). Resolve the minted lot number from the
    // saved challan's own item row, then assert the floor-credit leg.
    const mintedLotRow = await db.queryOne<{ lot_no: string }>(
      `SELECT lot_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [challanId],
    );
    expect(mintedLotRow, 'the JW-in must mint exactly one yarn item row').not.toBeNull();
    const mintedLot = mintedLotRow!.lot_no;

    const floorKey = {
      lotNumber: mintedLot,
      floorId: receivingFloor!.floor_id,
      jobWorkerId: null,
    };
    const floorBalance = await db.ledgerBalance(floorKey);
    expect(floorBalance).toBeCloseTo(Q_TOTAL, 3);

    const ledgerRowExists = await db.ledgerRowExists(floorKey);
    expect(ledgerRowExists, 'the minted lot must carry a floor-credit stock_ledger row').toBe(true);

    // DETAIL — both distinct-SKU sources are listed against the one minted lot.
    await gotoAndExpect(page, `/jw-challans-in/${challanId}`);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan In ${challanNo}` }),
    ).toBeVisible();
    const sourcesTable = page.getByTestId('sources-table');
    await expect(sourcesTable.getByText(outNoRed)).toBeVisible();
    await expect(sourcesTable.getByText(outNoBlue)).toBeVisible();
  },
);
