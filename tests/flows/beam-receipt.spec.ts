import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// Beam Receipt — in_house origin (BR-S1/BR-S7/B-010). Of the three beamOrigin
// paths (purchase / in_house / sizing_jw), only in_house drains real stock:
// BeamReceiptService.createInHouse (beam-receipt.service.ts) runs an 8-step
// floor deduction — for each composition slice it writes ONE stock_ledger row
// via applyBeamCompositionLedger (prisma-inventory.service.ts):
//   { transactionType: 'beam_receipt', qualityId, skuId, lotNumber,
//     locationId, floorId (the floor being debited), jobWorkerId: null,
//     inQuantity: 0, outQuantity: slice.quantity }.
// `purchase` has NO ledger drain at all (tx.beam.create only); `sizing_jw`
// drains an at-JW position opened by a prior challan-out, not floor stock. So
// in_house is the only origin that produces a floor-position ledger delta.
//
// The FE (beam-receipt-form.page.tsx) always sends composition as absolute KG
// slices (map-form-to-input.ts's `allocatePulls` emits
// `compositionShape: 'absolute' as const` for every slice) — so driving one
// Section-A yarn row + one Section-B consolidated pull row covering it
// exactly is sufficient; no design prefill needed for this happy path.
//
// Consolidated-pull redesign (docs/specs/2026-07-21-beam-receipt-consolidated-
// pull-design.md, fabtraq-fe): the old per-item mode toggle -> source cards ->
// lot sections -> per-floor placement tables are GONE. Composition is now
// entered as: Section A "Yarns used per beam" (quality + optional SKU + kg,
// per beam) and Section B "Pull from stock" (one consolidated table, grouped
// by yarn key, lot + combined location/floor + kg). The wire payload shape
// (flat absolute composition slices) is unchanged — only the FE selectors are
// new.
//
// tx.beam.create also runs per item with status: 'received' (createInHouse,
// beam-receipt.service.ts ~line 293). IMPORTANT schema note: the `beams` table
// has NO beam_receipt_id column — it links via beam_receipt_item_id ->
// beam_receipt_items.id -> beam_receipt_items.beam_receipt_id (confirmed via
// `\d beams` / `\d beam_receipt_items` against the live seed DB). The task
// brief's suggested query (`SELECT status FROM beams WHERE beam_receipt_id =
// $1`) does not match the real schema — this spec joins through
// beam_receipt_items instead.
test(
  'in_house beam receipt deducts source yarn and registers a received beam',
  async ({ page, db }) => {
    const Q = 6;

    // Derive the source position from the ledger — same shape as
    // jw-in-yarn.spec.ts / stock-transfer.spec.ts: a floor-held (not at-JW),
    // active-master lot with >= Q balance. CompositionSourcePicker
    // deliberately drops the isValidInputState filter (BR-L4 — "any
    // processed type is eligible for beam composition"), so no
    // processed_types restriction is needed here.
    const src = await db.queryOne<{
      lot_number: string;
      sku_id: string;
      quality_id: string;
      quality_code: string;
      quality_name: string;
      sku_name: string;
      sku_shade_number: string | null;
      loc_id: string;
      loc_name: string;
      floor_id: string;
      floor_name: string;
    }>(
      `SELECT s.lot_number, s.sku_id, s.quality_id,
              q.code AS quality_code, q.name AS quality_name,
              sku.name AS sku_name, sku.shade_number AS sku_shade_number,
              l.id AS loc_id, l.name AS loc_name, f.id AS floor_id, f.name AS floor_name
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
       GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
                sku.name, sku.shade_number, l.id, l.name, f.id, f.name
       HAVING SUM(s.in_quantity - s.out_quantity) >= $1
       ORDER BY s.lot_number
       LIMIT 1`,
      [Q],
    );
    expect(src, 'seed must provide a floor-held yarn lot with >= Q balance').not.toBeNull();

    const skuOptionLabel =
      src!.sku_shade_number !== null && src!.sku_shade_number !== ''
        ? `${src!.sku_name} — ${src!.sku_shade_number}`
        : src!.sku_name;

    const beamNumber = `BM-IH-${Date.now()}`;

    await gotoAndExpect(page, '/beam-receipts/new');

    // Origin toggle — role="group" aria-label="beam origin", 3 buttons
    // (beam-receipt-form.page.tsx:156-157). in_house is the only origin with a
    // real ledger drain.
    await page
      .getByRole('group', { name: 'beam origin' })
      .getByRole('button', { name: 'In-house', exact: true })
      .click();

    // Item 1 beam spec — beamNumber/netWeight are the only required fields
    // (createBeamReceiptSchema: inHouseBeamItemSchema). All BR-S7 fields
    // (ends/reed/beamWidth/...) are optional; skipped.
    await fillByLabel(page, 'beam number, items.0', beamNumber);
    await fillByLabel(page, 'net weight, items.0', String(Q));

    // Section A — "Yarns used per beam": one yarn row for this beam, quality
    // + SKU + kg (BeamYarnsTable.tsx). Quantity === Q keeps wastage
    // (usedSum - netWeight) at 0 — no conservation-tolerance edge cases.
    await clickButton(page, 'add yarn to item 1');
    await selectByAriaLabel(
      page,
      'yarn quality, items.0.yarns.0',
      `${src!.quality_code} – ${src!.quality_name}`,
    );
    await selectByAriaLabel(page, 'yarn sku, items.0.yarns.0', skuOptionLabel);
    await fillByLabel(page, 'yarn quantity, items.0.yarns.0', String(Q));

    // Section B — "Pull from stock": one consolidated pull row for that yarn
    // key, covering the Q kg need exactly (B-3 exact-coverage gate). The
    // group button's accessible name is SKU-qualified
    // (`add pull for <quality> · <sku>`); match on the quality code, which is
    // a stable substring regardless of exact SKU-label formatting
    // (StockPullTable.tsx / yarn-key.ts's `qualifiedYarnLabel`).
    await clickButton(page, `add pull for ${src!.quality_code}`);
    await selectByAriaLabel(page, 'pull lot, pulls.0', src!.lot_number);
    await selectByAriaLabel(
      page,
      'pull floor, pulls.0',
      `${src!.loc_name} · ${src!.floor_name}`,
    );
    await fillByLabel(page, 'pull quantity, pulls.0', String(Q));

    // Ledger key — EXACTLY the row applyBeamCompositionLedger writes for this
    // slice: qualityId/skuId/lotNumber/locationId/floorId from the slice,
    // jobWorkerId always null (floor debit, not an at-JW leg). Non-tautological:
    // this floor already carries a real seed balance before Save.
    const ledgerKey = {
      qualityId: src!.quality_id,
      skuId: src!.sku_id,
      lotNumber: src!.lot_number,
      locationId: src!.loc_id,
      floorId: src!.floor_id,
      jobWorkerId: null,
    };

    const { delta } = await db.ledgerDelta(ledgerKey, async () => {
      await clickButton(page, 'Save beam receipt');
      // useCreateBeamReceipt onSuccess toast: `Saved ${data.entryNo}`
      // (beam-receipt-form.page.tsx onSubmit).
      await expectToast(page, /^Saved /);
      await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);
    });

    // The floor-debit leg: outQuantity = Q, inQuantity = 0 → delta = -Q.
    expect(delta).toBeCloseTo(-Q, 3);

    // DETAIL — capture the minted entry number, scoped to <main>, regex anchored
    // to the real prefix confirmed via formatBeamReceiptNo (fabtraq-shared
    // primitives/entry-no.ts: `BRC-<financialYear>-<seq>`, e.g. "BRC-2025-26-001" —
    // note the prefix is BRC, not BR; it's the dedicated sequence shared by all
    // three beamOrigin paths).
    const entryNo = await captureDocNo(page.getByRole('main'), /\bBRC-\d{4}-\d{2}-\d{3,}\b/);
    const receiptId = page.url().split('/').pop();

    // Registered beam — status='received' (createInHouse's tx.beam.create).
    // `beams` has no beam_receipt_id column; join through beam_receipt_items
    // (see top-of-file note — this diverges from the task brief's suggested
    // query, which targets a column that does not exist in the real schema).
    const beamRow = await db.queryOne<{ status: string }>(
      `SELECT b.status
       FROM beams b
       JOIN beam_receipt_items bri ON bri.id = b.beam_receipt_item_id
       WHERE bri.beam_receipt_id = $1
       LIMIT 1`,
      [receiptId],
    );
    expect(beamRow, 'a beam row must be registered against the new beam receipt item').not.toBeNull();
    expect(beamRow!.status).toBe('received');

    // Detail page renders (fresh navigation, not just client-side post-Save state).
    await gotoAndExpect(page, `/beam-receipts/${receiptId}`);
    await expect(page.getByRole('heading', { name: entryNo })).toBeVisible();
  },
);

// Beam Receipt — sizing_jw origin, mixed-challan sources (2026-07-22 design:
// docs/specs/2026-07-22-sizing-jw-mixed-challan-design.md, fabtraq-fe). The
// header `challanOutId` field is GONE (M2/M5) — the OUT challan is derived
// per beam from its own `outItemId` via the per-row EligibleOutItemPicker, so
// one receipt may legitimately mix beams returned against different OUT
// challans. BE validates + rolls up status per DISTINCT referenced challan
// (M7), and drains the at-JW position each sizing OUT challan's own credit
// leg opened via applyBeamReceiptSizingLedger (beam-receipt.service.ts
// createSizingJw, prisma-inventory.service.ts) — tagged
// transactionType='beam_receipt', keyed on
// { qualityId, skuId, lotNumber: <sizing OUT item's own lotNumber>,
//   jobWorkerId: <that item's own challan's job worker>, floorId: null,
//   locationId: null }.
//
// Prerequisite chain: sizing needs a source lot carrying `warping` in
// processedTypes and neither `sizing` nor `weaving` (isValidInputState,
// fabtraq-shared primitives/job-work.ts). The seed has no such lot lying
// around ready-made, so this test builds one live: a raw lot -> warping
// JW-Challan-Out -> JW-Challan-In (yarn, processedTypes=['warping']) mints a
// fresh warped lot on a receiving floor (jw-out.spec.ts / jw-in-yarn.spec.ts
// patterns) -> TWO sizing JW-Challan-Out challans off that warped lot.
//
// The two sizing challans are sent to TWO DIFFERENT job workers (not two
// different lots) so their at-JW credit legs land on distinct ledger keys
// even though both reference the same warped lot number — this keeps the
// per-challan ledger assertions below non-tautological without needing a
// second warping run.
test(
  'sizing_jw beam receipt mixes beams from two OUT challans',
  async ({ page, db }) => {
    const Q_WARP = 30;
    const Q_SENT_A = 12;
    const Q_SENT_B = 10;
    const Q_RECV_A = 12; // fully receives challan A
    const Q_RECV_B = 6; // partially receives challan B (4 kg remains pending)

    const jobWorkerA = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    const jobWorkerB = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code OFFSET 1 LIMIT 1`,
    );
    expect(jobWorkerA, 'seed must provide an active job worker').not.toBeNull();
    expect(
      jobWorkerB,
      'seed must provide a second active job worker (distinct at-JW ledger keys)',
    ).not.toBeNull();

    // Raw (unprocessed) floor lot with enough balance to warp — same
    // derivation as jw-out.spec.ts / jw-in-yarn.spec.ts.
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
      [Q_WARP],
    );
    expect(src, 'seed must provide a raw lot with >= Q_WARP balance').not.toBeNull();

    const skuOptionLabel =
      src!.sku_shade_number !== null && src!.sku_shade_number !== ''
        ? `${src!.sku_name} — ${src!.sku_shade_number}`
        : src!.sku_name;

    // A receiving floor distinct from the source floor, for the warping
    // JW-in step — same rationale as jw-in-yarn.spec.ts (unambiguous "before"
    // balance for the freshly minted warped lot).
    const receivingFloor = await db.queryOne<{
      loc_id: string;
      loc_code: string;
      loc_name: string;
      floor_name: string;
      floor_id: string;
    }>(
      `SELECT l.id AS loc_id, l.code AS loc_code, l.name AS loc_name,
              f.name AS floor_name, f.id AS floor_id
       FROM location_floors f JOIN locations l ON l.id = f.location_id
       WHERE f.id <> $1 AND l.status = 'active' AND f.status = 'active'
       ORDER BY f.id LIMIT 1`,
      [src!.floor_id],
    );
    expect(
      receivingFloor,
      'seed must provide a second active floor to receive into',
    ).not.toBeNull();

    // ── Step 0a: warping JW-Challan-Out on the raw lot (jw-out.spec.ts
    //    pattern, operation = Warping) — opens the at-JW position the
    //    following JW-In drains.
    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorkerA!.code} – ${jobWorkerA!.name}`);
    await page.getByRole('checkbox', { name: 'Warping', exact: true }).check();
    await selectByAriaLabel(
      page,
      'Quality for line 1',
      `${src!.quality_code} – ${src!.quality_name}`,
    );
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await selectByAriaLabel(page, 'Source lot for line 1', src!.lot_number);
    await fillByLabel(page, 'Net weight for line 1', String(Q_WARP));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select floor and location',
      `${src!.loc_name} · ${src!.floor_name}`,
    );
    await fillByLabel(page, 'placement quantity 1', String(Q_WARP));
    await clickButton(page, 'Save challan');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
    const warpOutChallanNo = await captureDocNo(
      page.getByRole('main'),
      /\bJWO-\d{4}-\d{2}-\d{3,}\b/,
    );

    // ── Step 0b: JW-Challan-In (yarn) receiving the warping challan fully,
    //    processedTypes=['warping'], crediting `receivingFloor` with a
    //    freshly minted warped lot.
    //
    //    Driven via a direct API call (not the "Pick eligible out item"
    //    picker used elsewhere in this file): findEligibleOutItems
    //    (prisma-inventory.service.ts BE-8) DELIBERATELY excludes any OUT
    //    challan carrying a beam-track jobWorkType (warping/sizing/weaving)
    //    from that picker's candidate list — "even a warping-only Out (not
    //    yet sized) is not shown in the yarn picker" — so a warping challan
    //    can never be selected there by design. createJwChallanIn
    //    (jw-challan-in.service.ts) itself has no such exclusion — it only
    //    validates the referenced outItemId exists and the conservation
    //    invariant holds — so this is a legitimate BE-validated request, just
    //    not reachable through that one picker. Same pattern already
    //    established in this suite (place-stock-transfer-sync.spec.ts
    //    getCsrfToken/page.request) for BE behaviour with no UI entry point.
    const warpOutItem = await db.queryOne<{ id: string }>(
      `SELECT jcoi.id
       FROM jw_challan_out_items jcoi
       JOIN jw_challans_out jco ON jco.id = jcoi.challan_out_id
       WHERE jco.challan_no = $1`,
      [warpOutChallanNo],
    );
    expect(warpOutItem, 'the warping OUT challan must have exactly one item').not.toBeNull();

    const cookies = await page.context().cookies();
    const csrfCookie = cookies.find((c) => c.name === 'fabtraq_csrf');
    expect(csrfCookie, 'fabtraq_csrf cookie must be present for an authenticated session').toBeDefined();
    const csrfToken = decodeURIComponent(csrfCookie!.value).split('|')[0] ?? '';

    const jwInRes = await page.request.post(`${env.API_URL}/jw-challans-in`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        date: new Date().toISOString().slice(0, 10),
        yarnItems: [
          {
            qualityId: src!.quality_id,
            skuId: src!.sku_id,
            processedTypes: ['warping'],
            netWeight: Q_WARP,
            unit: 'KG',
            sources: [
              {
                jwChallanOutItemId: warpOutItem!.id,
                consumedQty: Q_WARP,
                wastage: 0,
                stillAtJwQty: 0,
                completions: [],
              },
            ],
            placements: [
              {
                locationId: receivingFloor!.loc_id,
                floorId: receivingFloor!.floor_id,
                quantity: Q_WARP,
                unit: 'KG',
              },
            ],
          },
        ],
      },
    });
    expect(jwInRes.status(), await jwInRes.text()).toBe(201);
    const jwInBody = (await jwInRes.json()) as { yarnItems: { lotNo: string }[] };
    const mintedLotNo = jwInBody.yarnItems[0]?.lotNo;
    expect(mintedLotNo, 'the JW-in response must carry the newly minted warped lot number').toBeTruthy();
    const warpedLot: string = mintedLotNo!;

    // ── Step 1: two sizing OUT challans off the SAME warped lot, one item
    //    each, sent to DIFFERENT job workers (see top-of-block note).
    async function createSizingOutChallan(
      jobWorker: { code: string; name: string },
      qty: number,
    ): Promise<string> {
      await gotoAndExpect(page, '/jw-challans-out/new');
      await selectNativeByLabel(page, 'Job worker', `${jobWorker.code} – ${jobWorker.name}`);
      await page.getByRole('checkbox', { name: 'Sizing', exact: true }).check();
      await selectByAriaLabel(
        page,
        'Quality for line 1',
        `${src!.quality_code} – ${src!.quality_name}`,
      );
      await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
      await selectByAriaLabel(page, 'Source lot for line 1', warpedLot);
      await fillByLabel(page, 'Net weight for line 1', String(qty));
      await clickButton(page, 'Add placement');
      await selectByAriaLabel(
        page,
        'Select floor and location',
        `${receivingFloor!.loc_name} · ${receivingFloor!.floor_name}`,
      );
      await fillByLabel(page, 'placement quantity 1', String(qty));
      await clickButton(page, 'Save challan');
      await expectToast(page, /^Saved /);
      await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
      return captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
    }

    const challanNoA = await createSizingOutChallan(jobWorkerA!, Q_SENT_A);
    const challanNoB = await createSizingOutChallan(jobWorkerB!, Q_SENT_B);

    // ── Step 2: /beam-receipts/new -> origin "Sizing JW". The header
    //    "Challan Out ID" field is GONE (M5) — the per-row picker is the
    //    only challan linkage anywhere on the page.
    await gotoAndExpect(page, '/beam-receipts/new');
    await page
      .getByRole('group', { name: 'beam origin' })
      .getByRole('button', { name: 'Sizing JW', exact: true })
      .click();
    await expect(page.getByLabel('Challan Out ID')).toHaveCount(0);

    const beamNumberA = `BM-SZ-A-${Date.now()}`;
    const beamNumberB = `BM-SZ-B-${Date.now()}`;

    // Beam row 1 -> challan A's out item, full receive.
    await fillByLabel(page, 'beam number, items.0', beamNumberA);
    await fillByLabel(page, 'net weight, items.0', String(Q_RECV_A));
    await page.getByRole('button', { name: 'Pick eligible out item' }).nth(0).click();
    await page.getByRole('option').filter({ hasText: challanNoA }).first().click();

    // Beam row 2 -> challan B's out item, partial receive.
    await clickButton(page, '+ Add beam item');
    await fillByLabel(page, 'beam number, items.1', beamNumberB);
    await fillByLabel(page, 'net weight, items.1', String(Q_RECV_B));
    await page.getByRole('button', { name: 'Pick eligible out item' }).nth(1).click();
    await page.getByRole('option').filter({ hasText: challanNoB }).first().click();

    // Ledger keys — EXACTLY what applyBeamReceiptSizingLedger writes: the
    // at-JW position each sizing OUT challan's own credit leg opened
    // (lotNumber = warpedLot for both; jobWorkerId is what makes A and B
    // distinguishable, per top-of-block note). Non-tautological: both keys
    // already carry a real positive balance (from the sizing OUT challans
    // above) before Save.
    const keyA = {
      qualityId: src!.quality_id,
      skuId: src!.sku_id,
      lotNumber: warpedLot,
      jobWorkerId: jobWorkerA!.id,
      floorId: null,
      locationId: null,
    };
    const keyB = {
      qualityId: src!.quality_id,
      skuId: src!.sku_id,
      lotNumber: warpedLot,
      jobWorkerId: jobWorkerB!.id,
      floorId: null,
      locationId: null,
    };
    const beforeA = await db.ledgerBalance(keyA);
    const beforeB = await db.ledgerBalance(keyB);
    expect(beforeA).toBeCloseTo(Q_SENT_A, 3);
    expect(beforeB).toBeCloseTo(Q_SENT_B, 3);

    await clickButton(page, 'Save beam receipt');
    // useCreateBeamReceipt onSuccess toast: `Saved ${data.entryNo}`.
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);

    const entryNo = await captureDocNo(page.getByRole('main'), /\bBRC-\d{4}-\d{2}-\d{3,}\b/);
    const receiptId = page.url().split('/').pop();

    const afterA = await db.ledgerBalance(keyA);
    const afterB = await db.ledgerBalance(keyB);
    expect(afterA - beforeA).toBeCloseTo(-Q_RECV_A, 3);
    expect(afterB - beforeB).toBeCloseTo(-Q_RECV_B, 3);

    // DB: one stock_ledger row per beam, transaction_type='beam_receipt',
    // draining the matching out item's at-JW position — joins through
    // beam_receipt_items exactly like the in_house test above (beams has no
    // beam_receipt_id column).
    const ledgerRowA = await db.queryOne<{
      out_quantity: string;
      job_worker_id: string;
      lot_number: string;
    }>(
      `SELECT sl.out_quantity, sl.job_worker_id, sl.lot_number
       FROM stock_ledger sl
       JOIN beam_receipt_items bri ON bri.id = sl.transaction_item_id
       WHERE bri.beam_receipt_id = $1 AND bri.beam_number = $2 AND sl.transaction_type = 'beam_receipt'`,
      [receiptId, beamNumberA],
    );
    const ledgerRowB = await db.queryOne<{
      out_quantity: string;
      job_worker_id: string;
      lot_number: string;
    }>(
      `SELECT sl.out_quantity, sl.job_worker_id, sl.lot_number
       FROM stock_ledger sl
       JOIN beam_receipt_items bri ON bri.id = sl.transaction_item_id
       WHERE bri.beam_receipt_id = $1 AND bri.beam_number = $2 AND sl.transaction_type = 'beam_receipt'`,
      [receiptId, beamNumberB],
    );
    expect(ledgerRowA, 'beam A must drain a beam_receipt ledger row').not.toBeNull();
    expect(ledgerRowB, 'beam B must drain a beam_receipt ledger row').not.toBeNull();
    expect(Number(ledgerRowA!.out_quantity)).toBeCloseTo(Q_RECV_A, 3);
    expect(Number(ledgerRowB!.out_quantity)).toBeCloseTo(Q_RECV_B, 3);
    expect(ledgerRowA!.job_worker_id).toBe(jobWorkerA!.id);
    expect(ledgerRowB!.job_worker_id).toBe(jobWorkerB!.id);
    expect(ledgerRowA!.lot_number).toBe(warpedLot);
    expect(ledgerRowB!.lot_number).toBe(warpedLot);

    // jw_challans_out status rollup (M7) — A fully received (12/12 consumed),
    // B partially received (6/10 consumed, 4kg still pending).
    const challanStatusA = await db.queryOne<{ status: string }>(
      `SELECT status FROM jw_challans_out WHERE challan_no = $1`,
      [challanNoA],
    );
    const challanStatusB = await db.queryOne<{ status: string }>(
      `SELECT status FROM jw_challans_out WHERE challan_no = $1`,
      [challanNoB],
    );
    expect(challanStatusA!.status).toBe('fully_received');
    expect(challanStatusB!.status).toBe('partially_received');

    // ── Detail page: both challan numbers rendered on the beam item cards
    //    (label "OUT Challan", per-beam Field — M6). Fresh navigation, not
    //    just client-side post-Save state.
    await gotoAndExpect(page, `/beam-receipts/${receiptId}`);
    await expect(page.getByRole('heading', { name: entryNo })).toBeVisible();
    await expect(page.getByText('OUT Challan')).toHaveCount(2);
    await expect(page.getByText(challanNoA, { exact: true })).toBeVisible();
    await expect(page.getByText(challanNoB, { exact: true })).toBeVisible();

    // ── Cancel: reverses the ledger and rolls both challans back to 'sent'.
    // No success toast on cancel (handleCancel just calls mutate()) — wait
    // deterministically on the POST .../cancel response instead.
    const [cancelResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === 'POST' &&
          res.url().includes(`/beam-receipts/${receiptId}/cancel`),
      ),
      clickButton(page, 'Cancel receipt'),
    ]);
    expect(cancelResponse.status()).toBe(200);

    const afterCancelA = await db.ledgerBalance(keyA);
    const afterCancelB = await db.ledgerBalance(keyB);
    expect(afterCancelA).toBeCloseTo(Q_SENT_A, 3);
    expect(afterCancelB).toBeCloseTo(Q_SENT_B, 3);

    // Reversal rows: reverseLedger writes NEW rows (notes='cancellation')
    // with in_quantity = the forward row's out_quantity, same
    // transaction_type/transaction_id — forward rows never carry
    // in_quantity > 0 for this ledger key, so this count is unambiguous.
    const reversalCount = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM stock_ledger
       WHERE transaction_id = $1 AND transaction_type = 'beam_receipt' AND in_quantity > 0`,
      [receiptId],
    );
    expect(Number(reversalCount!.n)).toBeGreaterThanOrEqual(2);

    const finalStatusA = await db.queryOne<{ status: string }>(
      `SELECT status FROM jw_challans_out WHERE challan_no = $1`,
      [challanNoA],
    );
    const finalStatusB = await db.queryOne<{ status: string }>(
      `SELECT status FROM jw_challans_out WHERE challan_no = $1`,
      [challanNoB],
    );
    expect(finalStatusA!.status).toBe('sent');
    expect(finalStatusB!.status).toBe('sent');
  },
);
