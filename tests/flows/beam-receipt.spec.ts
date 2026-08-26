import { test, expect } from "../../fixtures/test";
import { env } from "../../fixtures/env";
import {
  SENTINEL_OPTION_LABEL,
  SKU_ANSWER_REQUIRED,
} from "../../fixtures/copy";
import { gotoAndExpect } from "../../support/nav";
import {
  fillByLabel,
  fillByLabelExact,
  selectByAriaLabel,
  selectByLabel,
  clickButton,
} from "../../support/forms";
import { confirmDialogAndWait } from "../../support/api";
import { expectToast, captureDocNo } from "../../support/assert";
import { createSentinelPurchase } from "../../support/sentinel-purchase";
import { codes } from "../../fixtures/codes";

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
test("in_house beam receipt deducts source yarn and registers a received beam", async ({
  page,
  db,
}) => {
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
  expect(
    src,
    "seed must provide a floor-held yarn lot with >= Q balance",
  ).not.toBeNull();

  const skuOptionLabel =
    src!.sku_shade_number !== null && src!.sku_shade_number !== ""
      ? `${src!.sku_name} — ${src!.sku_shade_number}`
      : src!.sku_name;

  const beamNumber = `BM-IH-${Date.now()}`;

  await gotoAndExpect(page, "/beam-receipts/new");

  // Origin toggle — role="group" aria-label="beam origin", 3 buttons
  // (beam-receipt-form.page.tsx:156-157). in_house is the only origin with a
  // real ledger drain.
  await page
    .getByRole("group", { name: "beam origin" })
    .getByRole("button", { name: "In-house", exact: true })
    .click();

  // Item 1 beam spec — beamNumber/netWeight are the only required fields
  // (createBeamReceiptSchema: inHouseBeamItemSchema). All BR-S7 fields
  // (ends/reed/beamWidth/...) are optional; skipped.
  await fillByLabel(page, "beam number, items.0", beamNumber);
  await fillByLabel(page, "net weight, items.0", String(Q));

  // Section A — "Yarns used per beam": one yarn row for this beam, quality
  // + SKU + kg (BeamYarnsTable.tsx). Quantity === Q keeps wastage
  // (usedSum - netWeight) at 0 — no conservation-tolerance edge cases.
  await clickButton(page, "add yarn to item 1");
  await selectByAriaLabel(
    page,
    "yarn quality, items.0.yarns.0",
    `${src!.quality_code} – ${src!.quality_name}`,
  );
  await selectByAriaLabel(page, "yarn sku, items.0.yarns.0", skuOptionLabel);
  await fillByLabel(page, "yarn quantity, items.0.yarns.0", String(Q));

  // Section B — "Pull from stock": one consolidated pull row for that yarn
  // key, covering the Q kg need exactly (B-3 exact-coverage gate). The
  // group button's accessible name is SKU-qualified
  // (`add pull for <quality> · <sku>`); match on the quality code, which is
  // a stable substring regardless of exact SKU-label formatting
  // (StockPullTable.tsx / yarn-key.ts's `qualifiedYarnLabel`).
  await clickButton(page, `add pull for ${src!.quality_code}`);

  // Canonical lot vocabulary (spec 2026-07-27): the pull picker's options
  // must carry the processed state — "LOT · balance KG · Raw" for this raw
  // seed lot — exactly like the JW pickers. Open the dropdown, assert the
  // full label shape, then pick (selectByAriaLabel would reopen it, so
  // drive the two steps manually here).
  await page.locator('[aria-label="pull lot, pulls.0"]').click();
  const pullLotOption = page.getByRole("option", { name: src!.lot_number });
  await expect(pullLotOption).toContainText(/· \d+\.\d{3} KG · Raw$/);
  await pullLotOption.click();

  await selectByAriaLabel(
    page,
    "pull floor, pulls.0",
    `${src!.loc_name} · ${src!.floor_name}`,
  );
  await fillByLabel(page, "pull quantity, pulls.0", String(Q));

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
    await clickButton(page, "Save beam receipt");
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
  const entryNo = await captureDocNo(
    page.getByRole("main"),
    /\bBRC-\d{4}-\d{2}-\d{3,}\b/,
  );
  const receiptId = page.url().split("/").pop();

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
  expect(
    beamRow,
    "a beam row must be registered against the new beam receipt item",
  ).not.toBeNull();
  expect(beamRow!.status).toBe("received");

  // Detail page renders (fresh navigation, not just client-side post-Save state).
  await gotoAndExpect(page, `/beam-receipts/${receiptId}`);
  await expect(page.getByRole("heading", { name: entryNo })).toBeVisible();
});

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
test("sizing_jw beam receipt mixes beams from two OUT challans", async ({
  page,
  db,
}) => {
  const Q_WARP = 30;
  const Q_SENT_A = 12;
  const Q_SENT_B = 10;
  const Q_RECV_A = 12; // fully receives challan A
  const Q_RECV_B = 6; // partially receives challan B (4 kg remains pending)

  const jobWorkerA = await db.queryOne<{
    id: string;
    code: string;
    name: string;
  }>(
    `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  const jobWorkerB = await db.queryOne<{
    id: string;
    code: string;
    name: string;
  }>(
    `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code OFFSET 1 LIMIT 1`,
  );
  expect(jobWorkerA, "seed must provide an active job worker").not.toBeNull();
  expect(
    jobWorkerB,
    "seed must provide a second active job worker (distinct at-JW ledger keys)",
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
  expect(
    src,
    "seed must provide a raw lot with >= Q_WARP balance",
  ).not.toBeNull();

  const skuOptionLabel =
    src!.sku_shade_number !== null && src!.sku_shade_number !== ""
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
    "seed must provide a second active floor to receive into",
  ).not.toBeNull();

  // ── Step 0a: warping JW-Challan-Out on the raw lot (jw-out.spec.ts
  //    pattern, operation = Warping) — opens the at-JW position the
  //    following JW-In drains.
  await gotoAndExpect(page, "/jw-challans-out/new");
  await selectByLabel(
    page,
    "Job worker",
    `${jobWorkerA!.code} – ${jobWorkerA!.name}`,
  );
  await page.getByRole("checkbox", { name: "Warping", exact: true }).check();
  await selectByAriaLabel(
    page,
    "Quality for line 1",
    `${src!.quality_code} – ${src!.quality_name}`,
  );
  await selectByAriaLabel(page, "Select SKU", skuOptionLabel);
  await selectByAriaLabel(page, "Source lot for line 1", src!.lot_number);
  await fillByLabel(page, "Net weight for line 1", String(Q_WARP));
  await clickButton(page, "Add placement");
  await selectByAriaLabel(
    page,
    "Select floor and location",
    `${src!.loc_name} · ${src!.floor_name}`,
  );
  await fillByLabelExact(page, "placement quantity 1", String(Q_WARP));
  await clickButton(page, "Save challan");
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
  const warpOutChallanNo = await captureDocNo(
    page.getByRole("main"),
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
  expect(
    warpOutItem,
    "the warping OUT challan must have exactly one item",
  ).not.toBeNull();

  const cookies = await page.context().cookies();
  const csrfCookie = cookies.find((c) => c.name === "fabtraq_csrf");
  expect(
    csrfCookie,
    "fabtraq_csrf cookie must be present for an authenticated session",
  ).toBeDefined();
  const csrfToken = decodeURIComponent(csrfCookie!.value).split("|")[0] ?? "";

  const jwInRes = await page.request.post(`${env.API_URL}/jw-challans-in`, {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      date: new Date().toISOString().slice(0, 10),
      yarnItems: [
        {
          qualityId: src!.quality_id,
          skuId: src!.sku_id,
          netWeight: Q_WARP,
          unit: "KG",
          sources: [
            {
              jwChallanOutItemId: warpOutItem!.id,
              consumedQty: Q_WARP,
              wastage: 0,
              stillAtJwQty: 0,
              // D2 (spec 2026-07-22): processedTypes is DERIVED server-side —
              // union of source priors ∪ completed=true completions — and no
              // longer accepted on the item. The warped state must therefore
              // arrive via this completion; an empty completions array mints
              // the lot with processed_types = {} and the sizing OUT picker
              // silently excludes it (needs 'warping' present).
              completions: [{ jobWorkType: "warping", completed: true }],
            },
          ],
          placements: [
            {
              locationId: receivingFloor!.loc_id,
              floorId: receivingFloor!.floor_id,
              quantity: Q_WARP,
              unit: "KG",
            },
          ],
        },
      ],
    },
  });
  expect(jwInRes.status(), await jwInRes.text()).toBe(201);
  const jwInBody = (await jwInRes.json()) as { yarnItems: { lotNo: string }[] };
  const mintedLotNo = jwInBody.yarnItems[0]?.lotNo;
  expect(
    mintedLotNo,
    "the JW-in response must carry the newly minted warped lot number",
  ).toBeTruthy();
  const warpedLot: string = mintedLotNo!;

  // ── Step 1: two sizing OUT challans off the SAME warped lot, one item
  //    each, sent to DIFFERENT job workers (see top-of-block note).
  async function createSizingOutChallan(
    jobWorker: { code: string; name: string },
    qty: number,
  ): Promise<string> {
    await gotoAndExpect(page, "/jw-challans-out/new");
    await selectByLabel(
      page,
      "Job worker",
      `${jobWorker.code} – ${jobWorker.name}`,
    );
    await page.getByRole("checkbox", { name: "Sizing", exact: true }).check();
    await selectByAriaLabel(
      page,
      "Quality for line 1",
      `${src!.quality_code} – ${src!.quality_name}`,
    );
    await selectByAriaLabel(page, "Select SKU", skuOptionLabel);
    await selectByAriaLabel(page, "Source lot for line 1", warpedLot);
    await fillByLabel(page, "Net weight for line 1", String(qty));
    await clickButton(page, "Add placement");
    await selectByAriaLabel(
      page,
      "Select floor and location",
      `${receivingFloor!.loc_name} · ${receivingFloor!.floor_name}`,
    );
    await fillByLabelExact(page, "placement quantity 1", String(qty));
    await clickButton(page, "Save challan");
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
    return captureDocNo(page.getByRole("main"), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
  }

  const challanNoA = await createSizingOutChallan(jobWorkerA!, Q_SENT_A);
  const challanNoB = await createSizingOutChallan(jobWorkerB!, Q_SENT_B);

  // ── Step 2: /beam-receipts/new -> origin "Sizing JW". The header
  //    "Challan Out ID" field is GONE (M5) — the per-row picker is the
  //    only challan linkage anywhere on the page.
  await gotoAndExpect(page, "/beam-receipts/new");
  await page
    .getByRole("group", { name: "beam origin" })
    .getByRole("button", { name: "Sizing JW", exact: true })
    .click();
  await expect(page.getByLabel("Challan Out ID")).toHaveCount(0);

  const beamNumberA = `BM-SZ-A-${Date.now()}`;
  const beamNumberB = `BM-SZ-B-${Date.now()}`;

  // Beam row 1 -> challan A's out item, full receive.
  await fillByLabel(page, "beam number, items.0", beamNumberA);
  await fillByLabel(page, "net weight, items.0", String(Q_RECV_A));
  await page
    .getByRole("button", { name: "Pick eligible out item" })
    .nth(0)
    .click();
  await page
    .getByRole("option")
    .filter({ hasText: challanNoA })
    .first()
    .click();

  // Beam row 2 -> challan B's out item, partial receive.
  await clickButton(page, "+ Add beam item");
  await fillByLabel(page, "beam number, items.1", beamNumberB);
  await fillByLabel(page, "net weight, items.1", String(Q_RECV_B));
  await page
    .getByRole("button", { name: "Pick eligible out item" })
    .nth(1)
    .click();
  await page
    .getByRole("option")
    .filter({ hasText: challanNoB })
    .first()
    .click();

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

  await clickButton(page, "Save beam receipt");
  // useCreateBeamReceipt onSuccess toast: `Saved ${data.entryNo}`.
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);

  const entryNo = await captureDocNo(
    page.getByRole("main"),
    /\bBRC-\d{4}-\d{2}-\d{3,}\b/,
  );
  const receiptId = page.url().split("/").pop();

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
  expect(
    ledgerRowA,
    "beam A must drain a beam_receipt ledger row",
  ).not.toBeNull();
  expect(
    ledgerRowB,
    "beam B must drain a beam_receipt ledger row",
  ).not.toBeNull();
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
  expect(challanStatusA!.status).toBe("fully_received");
  expect(challanStatusB!.status).toBe("partially_received");

  // ── Detail page: both challan numbers rendered on the beam item cards
  //    (label "OUT Challan", per-beam Field — M6). Fresh navigation, not
  //    just client-side post-Save state.
  await gotoAndExpect(page, `/beam-receipts/${receiptId}`);
  await expect(page.getByRole("heading", { name: entryNo })).toBeVisible();
  await expect(page.getByText("OUT Challan")).toHaveCount(2);
  await expect(page.getByText(challanNoA, { exact: true })).toBeVisible();
  await expect(page.getByText(challanNoB, { exact: true })).toBeVisible();

  // ── Cancel: reverses the ledger and rolls both challans back to 'sent'.
  // The detail page now interposes a ConfirmDialog (2026-08-22 UI wave) —
  // same alertdialog-confirm shape as weaving-in/fabric-taka, so drive it
  // via the shared confirmDialogAndWait helper. Still no success toast.
  const cancelResponse = await confirmDialogAndWait(
    page,
    "Cancel receipt",
    /\/beam-receipts\/[^/]+\/cancel$/,
  );
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
  expect(finalStatusA!.status).toBe("sent");
  expect(finalStatusB!.status).toBe("sent");
});

// E5 (spec 2026-07-27 D2a) — the per-beam yarn row's SKU answer is REQUIRED
// (a real SKU or the "No shade / greige" sentinel), enforced by a per-row
// `beamReceiptYarnInputSchema.safeParse` inside `validateInHouseComposition`
// (FE plan Task 6/F3) — a client-side gate, same shape as yarn-purchase's.
//
// E5 Test A — leaving the SKU unanswered blocks the save. Section B derives
// its "needed" total from this same yarn row regardless of the SKU answer, so
// with zero pull rows entered, rule 5's exact-coverage check ALSO fires on the
// same click — assert both messages, since asserting only one would tolerate
// the form regressing to accept either failure alone as "the" error.
test("in_house beam receipt blocks a yarn row with no SKU answer", async ({
  page,
  db,
}) => {
  const Q = 8;

  // A real floor-held lot — used only to prove the block is real (zero
  // ledger delta), not to fill the form (which never reaches Section B's
  // pull table here).
  const src = await db.queryOne<{
    quality_id: string;
    quality_code: string;
    quality_name: string;
    lot_number: string;
    loc_id: string;
    floor_id: string;
  }>(
    `SELECT s.quality_id, q.code AS quality_code, q.name AS quality_name,
              s.lot_number, l.id AS loc_id, f.id AS floor_id
       FROM stock_ledger s
       JOIN location_floors f ON f.id = s.floor_id
       JOIN locations l ON l.id = f.location_id
       JOIN yarn_qualities q ON q.id = s.quality_id
       WHERE s.lot_number IS NOT NULL AND s.sku_id IS NOT NULL AND s.job_worker_id IS NULL
         AND l.status = 'active' AND f.status = 'active' AND q.status = 'active'
       GROUP BY s.quality_id, q.code, q.name, s.lot_number, l.id, f.id
       HAVING SUM(s.in_quantity - s.out_quantity) >= $1
       ORDER BY s.lot_number
       LIMIT 1`,
    [Q],
  );
  expect(
    src,
    "seed must provide a floor-held yarn lot with >= Q balance",
  ).not.toBeNull();

  const beamNumber = `BM-NOSKU-${Date.now()}`;
  await gotoAndExpect(page, "/beam-receipts/new");
  await page
    .getByRole("group", { name: "beam origin" })
    .getByRole("button", { name: "In-house", exact: true })
    .click();
  await fillByLabel(page, "beam number, items.0", beamNumber);
  await fillByLabel(page, "net weight, items.0", String(Q));

  await clickButton(page, "add yarn to item 1");
  await selectByAriaLabel(
    page,
    "yarn quality, items.0.yarns.0",
    `${src!.quality_code} – ${src!.quality_name}`,
  );
  await fillByLabel(page, "yarn quantity, items.0.yarns.0", String(Q));
  // SKU deliberately left unanswered — no click on `yarn sku, items.0.yarns.0`.

  const blockKey = {
    qualityId: src!.quality_id,
    lotNumber: src!.lot_number,
    locationId: src!.loc_id,
    floorId: src!.floor_id,
  };
  const { delta } = await db.ledgerDelta(blockKey, async () => {
    await clickButton(page, "Save beam receipt");
    await expect(page.getByText(SKU_ANSWER_REQUIRED).first()).toBeVisible();
    // Rule 5 (exact coverage): no pulls exist for this yarn key either —
    // both errors must render from the same blocked click.
    await expect(
      page.getByText("No pulls recorded for this yarn").first(),
    ).toBeVisible();
  });
  expect(delta).toBe(0);
  await expect(page).toHaveURL(/\/beam-receipts\/new$/);
});

// E5 Test B — the SKU-less pull, end-to-end. This is the headline new
// coverage: it exercises D2a's required enabler (the aggregated-lots query's
// `skuId: null` ⇒ IS NULL, `inventoryQuerySchema` at shared's
// `src/schemas/inventory/index.ts`). If that enabler were missing, the
// "No shade" yarn row's pull picker would show nothing and this test fails by
// design — the fix is the enabler landing, never giving the row a real SKU.
test('in_house beam receipt: a "No shade" yarn row pulls SKU-less stock end-to-end (D2a IS-NULL enabler)', async ({
  page,
  db,
}) => {
  const Q = 25;

  // Produce SKU-less stock via the real production path (yarn purchase
  // answered with the sentinel) — the seed carries none. Fully placed onto
  // one floor by the helper (support/sentinel-purchase.ts).
  const sentinel = await createSentinelPurchase(page, db, Q);

  const quality = await db.queryOne<{ code: string; name: string }>(
    `SELECT code, name FROM yarn_qualities WHERE id = $1`,
    [sentinel.qualityId],
  );
  expect(
    quality,
    "the sentinel purchase must reference a real quality",
  ).not.toBeNull();

  // The differential control: a real-SKU lot of the SAME quality, already
  // on-hand from the seed. The picker must offer the sentinel's lot and
  // must NOT offer this one — proof the IS-NULL filter is actually
  // filtering, not just "happening to return everything".
  const realSkuLot = await db.queryOne<{ lot_number: string }>(
    `SELECT s.lot_number
       FROM stock_ledger s
       JOIN location_floors f ON f.id = s.floor_id
       JOIN locations l ON l.id = f.location_id
       WHERE s.quality_id = $1 AND s.sku_id IS NOT NULL AND s.job_worker_id IS NULL
         AND l.status = 'active' AND f.status = 'active'
       GROUP BY s.lot_number
       HAVING SUM(s.in_quantity - s.out_quantity) > 0
       ORDER BY s.lot_number
       LIMIT 1`,
    [sentinel.qualityId],
  );
  expect(
    realSkuLot,
    "seed must carry a real-SKU lot of the sentinel quality for the differential assertion",
  ).not.toBeNull();

  const beamNumber = `BM-NS-${Date.now()}`;
  await gotoAndExpect(page, "/beam-receipts/new");
  await page
    .getByRole("group", { name: "beam origin" })
    .getByRole("button", { name: "In-house", exact: true })
    .click();
  await fillByLabel(page, "beam number, items.0", beamNumber);
  await fillByLabel(page, "net weight, items.0", String(Q));

  await clickButton(page, "add yarn to item 1");
  await selectByAriaLabel(
    page,
    "yarn quality, items.0.yarns.0",
    `${quality!.code} – ${quality!.name}`,
  );
  await selectByAriaLabel(
    page,
    "yarn sku, items.0.yarns.0",
    SENTINEL_OPTION_LABEL,
  );
  await fillByLabel(page, "yarn quantity, items.0.yarns.0", String(Q));

  // Adding the pull row is what mounts CompositionSourcePicker for this
  // group (StockPullTable.tsx) and fires the aggregated-lots query — the
  // no-shade bucket forwards shared's NO_SHADE token as `skuId` (D2a wire
  // encoding: a query string can't carry `null`). Intercept before the
  // click that fires it.
  //
  // A freshly-appended pull row's CompositionSourcePicker first mounts with
  // an empty qualityId prop for one render (before the field-array watch
  // syncs), firing the "disabled" page=1&pageSize=1 no-op query with no
  // qualityId at all — require `qualityId=<real id>` in the matched request
  // so that transient request isn't mistaken for the real one.
  const lotsReqPromise = page.waitForRequest(
    (req) =>
      req.method() === "GET" &&
      req.url().includes("/inventory/lots/aggregated") &&
      req.url().includes(`qualityId=${sentinel.qualityId}`),
  );
  await clickButton(page, `add pull for ${quality!.code}`);
  const lotsReq = await lotsReqPromise;
  const lotsUrl = new URL(lotsReq.url());
  // Assert the token, not `null` — the wire cannot carry null, and an
  // implementer who asserts `skuId=null` here is testing a shape that
  // cannot exist (plan's explicit warning).
  expect(lotsUrl.searchParams.get("skuId")).toBe("NO_SHADE");

  await page.locator('[aria-label="pull lot, pulls.0"]').click();
  await expect(
    page.getByRole("option", { name: new RegExp(`^${sentinel.lotNumber}\\b`) }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", {
      name: new RegExp(`^${realSkuLot!.lot_number}\\b`),
    }),
  ).toHaveCount(0);
  await page
    .getByRole("option", { name: new RegExp(`^${sentinel.lotNumber}\\b`) })
    .click();

  await selectByAriaLabel(
    page,
    "pull floor, pulls.0",
    `${sentinel.location.name} · ${sentinel.floor.name}`,
  );
  await fillByLabel(page, "pull quantity, pulls.0", String(Q));

  // Ledger key — EXACTLY the row applyBeamCompositionLedger writes for this
  // slice. Non-tautological: the sentinel purchase's own placement already
  // carries +Q under this exact (qualityId, skuId:null, lotNumber,
  // locationId, floorId) key before Save — the delta below proves the SAVE
  // action drained it, not that the row merely exists. `skuId: null`
  // (never `undefined`, which means "no filter" in fixtures/db.ts and would
  // make this vacuous).
  const ledgerKey = {
    qualityId: sentinel.qualityId,
    skuId: null,
    lotNumber: sentinel.lotNumber,
    locationId: sentinel.location.id,
    floorId: sentinel.floor.id,
    jobWorkerId: null,
  };
  const { delta } = await db.ledgerDelta(ledgerKey, async () => {
    await clickButton(page, "Save beam receipt");
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);
  });
  expect(delta).toBeCloseTo(-Q, 3);

  // arch-fe's flagged silent failure: the yarnKey bucketing bug does not
  // throw — a no-shade beam receipt can save successfully having allocated
  // ZERO composition slices, so a spec that only checks "saved + toast +
  // URL" (and even the ledger delta above, on a different bug shape) can
  // pass while the feature is entirely broken. Assert the persisted slice
  // directly — the thing `allocatePulls` is supposed to produce.
  const receiptId = page.url().split("/").pop();
  const slices = await db.queryMany<{
    sku_id: string | null;
    lot_number: string;
    quantity: string;
  }>(
    `SELECT bcs.sku_id, bcs.lot_number, bcs.quantity
       FROM beam_composition_sources bcs
       JOIN beam_receipt_items bri ON bri.id = bcs.beam_item_id
       WHERE bri.beam_receipt_id = $1 AND bri.beam_number = $2`,
    [receiptId, beamNumber],
  );
  expect(slices).toHaveLength(1);
  expect(slices[0]!.sku_id).toBeNull();
  expect(slices[0]!.lot_number).toBe(sentinel.lotNumber);
  expect(Number(slices[0]!.quantity)).toBeCloseTo(Q, 3);
});

// E5 Test C — Task 7 regression, the D3-unchanged contract.
//
// The plan's Test C asked for a real-SKU yarn row's picker to OFFER a
// SKU-less lot of the same quality ("D2a's differ-allowance"). That is not
// reachable through the shipped UI, and is not what FE plan Task 7 built —
// verified by tracing, not guessed:
//   1. `StockPullTable.tsx`'s groupMap sets
//      `pullSkuId: need.skuId ?? (need.noShadeAnswered ? NO_SHADE : undefined)`
//      — a SKU'd row's `need.skuId` is that real skuId, so `pullSkuId` is
//      NEVER `undefined` or `NO_SHADE` for a SKU'd row.
//   2. `prisma-inventory.repository.ts`'s `findLotLedgerRowsForAggregation`
//      applies `skuId` as EXACT equality when given a value — a
//      `sku_id IS NULL` row can never match a uuid filter.
//   3. FE plan Task 7's own test list requires "a SKU'd row still sends its
//      `skuId`" as a REGRESSION (the D3 reference-path behaviour, explicitly
//      unchanged by this workstream) — the strict filter is the specified
//      behaviour, not an oversight to relax.
// F1's "the beam's declared SKU and a pulled legacy null-SKU position may
// differ" is a statement about NOT cross-checking the two client-side
// (D2a) — it is not a claim that the picker will surface a mismatched-SKU
// lot; the picker's query scope makes that unreachable by construction.
//
// Reported to lead separately: because `applyBeamCompositionLedger` writes
// `skuId: slice.skuId ?? null` (the DECLARED row's SKU, per
// `allocate-pulls.ts`) and `findLotLocationBalance` is called from
// `createInHouse` WITHOUT qualityId/skuId (balance-checks by lot+floor only),
// nothing but this client-side picker filter stands between a SKU'd row and
// a cross-bucket ledger write (the same class of bug as B-012) if a slice
// ever named a lot whose real balance sits under a different/null SKU. Not
// fixed here — out of this task's scope, and the design (D2a) explicitly
// assumes the picker constrains the input rather than adding a BE guard.
//
// This test pins the actual, narrower contract instead: a SKU'd yarn row's
// pull query sends that exact `skuId`, and the SKU-less lot minted by the
// sentinel is excluded from its picker.
test("in_house beam receipt: a SKU'd yarn row's pull query excludes SKU-less stock of the same quality", async ({
  page,
  db,
}) => {
  const Q = 14;
  const sentinel = await createSentinelPurchase(page, db, Q);

  const quality = await db.queryOne<{ code: string; name: string }>(
    `SELECT code, name FROM yarn_qualities WHERE id = $1`,
    [sentinel.qualityId],
  );
  expect(
    quality,
    "the sentinel purchase must reference a real quality",
  ).not.toBeNull();

  const sku = await db.queryOne<{
    id: string;
    name: string;
    shade_number: string | null;
  }>(
    `SELECT id, name, shade_number FROM yarn_skus
       WHERE status = 'active' AND quality_id = $1
       ORDER BY code LIMIT 1`,
    [sentinel.qualityId],
  );
  expect(
    sku,
    "seed must provide a real SKU for the sentinel quality",
  ).not.toBeNull();
  const skuOptionLabel =
    sku!.shade_number !== null && sku!.shade_number !== ""
      ? `${sku!.name} — ${sku!.shade_number}`
      : sku!.name;

  const beamNumber = `BM-SKUD-${Date.now()}`;
  await gotoAndExpect(page, "/beam-receipts/new");
  await page
    .getByRole("group", { name: "beam origin" })
    .getByRole("button", { name: "In-house", exact: true })
    .click();
  await fillByLabel(page, "beam number, items.0", beamNumber);
  await fillByLabel(page, "net weight, items.0", String(Q));

  await clickButton(page, "add yarn to item 1");
  await selectByAriaLabel(
    page,
    "yarn quality, items.0.yarns.0",
    `${quality!.code} – ${quality!.name}`,
  );
  await selectByAriaLabel(page, "yarn sku, items.0.yarns.0", skuOptionLabel);
  await fillByLabel(page, "yarn quantity, items.0.yarns.0", String(Q));

  // See Test B's comment: a fresh pull row's picker first fires a
  // transient no-op query with no `qualityId` at all — require the real
  // qualityId in the matched request.
  const lotsReqPromise = page.waitForRequest(
    (req) =>
      req.method() === "GET" &&
      req.url().includes("/inventory/lots/aggregated") &&
      req.url().includes(`qualityId=${sentinel.qualityId}`),
  );
  await clickButton(page, `add pull for ${quality!.code}`);
  const lotsReq = await lotsReqPromise;
  const lotsUrl = new URL(lotsReq.url());
  expect(lotsUrl.searchParams.get("skuId")).toBe(sku!.id);

  await page.locator('[aria-label="pull lot, pulls.0"]').click();
  await expect(
    page.getByRole("option", { name: new RegExp(`^${sentinel.lotNumber}\\b`) }),
  ).toHaveCount(0);
});

test("receipt register rows are clickable through to the detail page (spec 2026-07-30)", async ({
  page,
  db,
}) => {
  const receipt = await db.queryOne<{ id: string; entry_no: string }>(
    `SELECT id, entry_no FROM beam_receipts ORDER BY created_at DESC LIMIT 1`,
  );
  expect(receipt, "seed must provide at least one beam receipt").not.toBeNull();

  await gotoAndExpect(page, "/beam-receipts");
  const row = page.getByRole("row", { name: receipt!.entry_no });
  await expect(row).toBeVisible();
  // The whole row is clickable — the per-row View link/button was removed.
  await row.getByText(receipt!.entry_no, { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/beam-receipts/${receipt!.id}$`));
  await expect(
    page.getByRole("heading", { name: receipt!.entry_no }),
  ).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// B-037 / B-038 / B-039 — beam-cancellation gaps
// (spec docs/brainstorms/2026-08-26-beam-cancel-gaps.md)
//
// These own their fixtures: every beam number is codes.unique(), so nothing
// here depends on "the first" seeded receipt or collides with a sibling spec.
// ─────────────────────────────────────────────────────────────────────────────

/** Creates a purchase-origin beam receipt over the API. Returns its ids. */
async function createPurchaseReceipt(
  page: import("@playwright/test").Page,
  beamNumber: string,
): Promise<{ status: number; id?: string }> {
  const cookies = await page.context().cookies();
  const csrfCookie = cookies.find((c) => c.name === "fabtraq_csrf");
  if (!csrfCookie)
    throw new Error(
      "fabtraq_csrf cookie must be present for an authenticated session",
    );
  const csrfToken = decodeURIComponent(csrfCookie.value).split("|")[0] ?? "";

  const res = await page.request.post(`${env.API_URL}/beam-receipts`, {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      date: new Date().toISOString().slice(0, 10),
      beamOrigin: "purchase",
      items: [{ beamNumber, netWeight: 50 }],
    },
  });
  if (res.status() !== 201) return { status: res.status() };
  return { status: 201, id: ((await res.json()) as { id: string }).id };
}

// E1 — the headline regression: cancel, see it, then re-use the number.
test("a cancelled beam receipt is visibly cancelled and frees its beam number", async ({
  page,
  db,
}) => {
  const beamNumber = codes.unique("BM-REUSE");

  const first = await createPurchaseReceipt(page, beamNumber);
  expect(first.status, "first receipt must be accepted").toBe(201);

  // While live, the number is taken.
  const blocked = await createPurchaseReceipt(page, beamNumber);
  expect(blocked.status, "a live beam must still block its number").toBe(409);

  // ── Cancel through the UI, and assert the state the reporter could not see.
  await gotoAndExpect(page, `/beam-receipts/${first.id}`);
  const cancelResponse = await confirmDialogAndWait(
    page,
    "Cancel receipt",
    /\/beam-receipts\/[^/]+\/cancel$/,
  );
  expect(cancelResponse.status()).toBe(200);

  // B-038: a Cancelled badge appears and the action disappears. Before this
  // change the page looked identical to an active receipt and still offered
  // "Cancel receipt" a second time.
  await expect(page.getByText("Cancelled").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel receipt" }),
  ).toHaveCount(0);

  // …and on the register, which is where the reporter was actually looking.
  const entryNo = await db.queryOne<{ entry_no: string }>(
    `SELECT entry_no FROM beam_receipts WHERE id = $1`,
    [first.id],
  );
  await gotoAndExpect(page, "/beam-receipts");
  const row = page.getByRole("row", { name: entryNo!.entry_no });
  await expect(row).toBeVisible();
  await expect(row.getByText("Cancelled")).toBeVisible();

  // B-037: the number is now re-usable.
  const reused = await createPurchaseReceipt(page, beamNumber);
  expect(reused.status, "a cancelled beam must release its number").toBe(201);

  // Both rows coexist — the cancelled one keeps its number, the live one owns it.
  const beams = await db.queryMany<{ status: string }>(
    `SELECT status FROM beams WHERE beam_number = $1 ORDER BY created_at`,
    [beamNumber],
  );
  expect(beams.map((b) => b.status)).toEqual(["cancelled", "received"]);
});

// E2 — purchase origin on purpose: it writes NO ledger rows, so the old
// ledger-based guard was structurally false for it and let a repeat cancel
// through. A sizing_jw case would pass even against the unfixed code.
test("cancelling an already-cancelled purchase receipt is refused", async ({
  page,
}) => {
  const beamNumber = codes.unique("BM-DBL");
  const created = await createPurchaseReceipt(page, beamNumber);
  expect(created.status).toBe(201);

  const cookies = await page.context().cookies();
  const csrfToken =
    decodeURIComponent(
      cookies.find((c) => c.name === "fabtraq_csrf")!.value,
    ).split("|")[0] ?? "";
  const cancelUrl = `${env.API_URL}/beam-receipts/${created.id}/cancel`;

  const first = await page.request.post(cancelUrl, {
    headers: { "X-CSRF-Token": csrfToken },
  });
  expect(first.status()).toBe(200);
  expect(((await first.json()) as { cancelled: boolean }).cancelled).toBe(true);

  const second = await page.request.post(cancelUrl, {
    headers: { "X-CSRF-Token": csrfToken },
  });
  expect(
    second.status(),
    "a second cancel must be refused, not silently repeated",
  ).toBe(409);
});

// E3 — B-039. No existing spec typed into the old "Transporter ID" box, so
// there is no interaction to swap; this is purely new coverage that the
// picker works end to end rather than merely rendering.
test("the beam-receipt form picks a transporter by name and stores it", async ({
  page,
  db,
}) => {
  const transporter = await db.queryOne<{
    id: string;
    code: string;
    name: string;
  }>(
    `SELECT id, code, name FROM transporters WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(transporter, "seed must provide an active transporter").not.toBeNull();

  await gotoAndExpect(page, "/beam-receipts/new");
  await page
    .getByRole("group", { name: "beam origin" })
    .getByRole("button", { name: "Sizing JW", exact: true })
    .click();

  // Previously a free-text uuid field: typing a NAME returned "valid uuid is
  // required". It is a combobox now, so the name is selectable.
  await selectByAriaLabel(
    page,
    "Select transporter",
    `${transporter!.code} – ${transporter!.name}`,
  );

  await expect(page.getByText("valid uuid is required")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Select transporter" }),
  ).toContainText(transporter!.name);
});
