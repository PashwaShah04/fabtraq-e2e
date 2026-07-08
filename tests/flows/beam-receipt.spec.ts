import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
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
// The FE (beam-receipt-form.page.tsx) always sends composition as absolute
// KG slices regardless of the UI's "Absolute / % Total / Design" mode toggle
// (map-form-to-input.ts: `compositionShape: 'absolute' as const` for every
// placement row) — so driving the default 'absolute' mode with one source row
// and one placement is sufficient; no design/percent setup needed.
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

    // Composition — default mode is 'absolute'; add one source row.
    await clickButton(page, 'Add yarn source');
    await selectByAriaLabel(
      page,
      'quality for source 1',
      `${src!.quality_code} – ${src!.quality_name}`,
    );
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await selectByAriaLabel(page, 'source lot for source 1', src!.lot_number);

    // Placement — once a lot is selected, PlacementFieldArray switches to
    // AvailableFloorSelect (aria-label "Select floor and location"), scoped to
    // that lot's own on-hand floors (InHouseCompositionSection.tsx
    // handleLotChange). Placing exactly Q keeps wastage (usedSum - netWeight)
    // at 0 — no conservation-tolerance edge cases.
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select floor and location',
      `${src!.loc_name} · ${src!.floor_name}`,
    );
    await fillByLabel(page, 'placement quantity 1', String(Q));

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
