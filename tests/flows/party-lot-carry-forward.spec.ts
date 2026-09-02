import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel, fillByLabelExact,
  selectByAriaLabel,
  selectByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// E2E proof for the party-lot carry-forward feature (Plan B, spec
// 2026-08-20-party-lot-carry-forward): a vendor's party lot number, entered
// once on a yarn purchase, must survive TWO job-work hops — including a hop
// minted from a lot that was itself minted by a prior receipt (the single
// "resolve through a receipt-minted lot" property the whole design rests
// on) — and surface on both the lot listing and a source-lot picker with the
// lot number as the label's leading token (spec L2/L5, lot-label invariant).
//
// This spec owns its fixtures end to end (own purchase, own party lot value)
// rather than reusing "first active" anything shared with other specs.
//
// `openJwPosition` / `receiveLot` are modeled on (copied from, not imported
// from) tests/flows/jw-in-yarn.spec.ts so this file owns its own fixtures.

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
  await selectByLabel(page, 'Job worker', `${jobWorker.code} – ${jobWorker.name}`);
  await page.getByRole('checkbox', { name: jobWorkTypeLabel }).check();
  await selectByAriaLabel(page, 'Quality for line 1', `${src.quality_code} – ${src.quality_name}`);
  await selectByAriaLabel(page, 'Select SKU', skuLabelOf(src));
  await selectByAriaLabel(page, 'Source lot for line 1', src.lot_number);
  await fillByLabel(page, 'Net weight for line 1', String(q));
  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select floor and location', `${src.loc_name} · ${src.floor_name}`);
  await fillByLabelExact(page, 'placement quantity 1', String(q));
  await clickButton(page, 'Save challan');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
  return captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
}

/**
 * Drives the per-lot-sources JW-In form for the single-source case (same
 * shape as jw-in-yarn.spec.ts's `receiveLot`): one received lot, one source
 * row pulling the full out-challan quantity, fully placed onto `floor`.
 * Returns the id of the saved JW-In challan so callers can resolve the
 * freshly minted lot via `jw_challan_in_yarn_item`.
 */
async function receiveLot(
  page: import('@playwright/test').Page,
  src: SourceLotRow,
  outChallanNo: string,
  floor: { loc_code: string; loc_name: string; floor_name: string },
  q: number,
): Promise<string> {
  await gotoAndExpect(page, '/jw-challans-in/new');
  await expect(page.getByRole('heading', { name: 'New Job Work Challan In' })).toBeVisible();

  await selectByAriaLabel(page, 'quality, lots.0', `${src.quality_code} – ${src.quality_name}`);
  await selectByAriaLabel(page, 'sku, lots.0', skuLabelOf(src));
  await fillByLabel(page, 'net weight, lots.0', String(q));

  await page.getByLabel('add source, lots.0').click();
  await page.getByLabel('source, lots.0.sources.0', { exact: true }).click();
  await fillByLabel(page, 'Search OUT challan no', outChallanNo);
  const eligibleOption = page.getByRole('option', { name: outChallanNo });
  await expect(eligibleOption).toBeVisible();
  await eligibleOption.click();
  await expect(page.getByLabel('consumed quantity, lots.0.sources.0')).toHaveValue(String(q));
  await expect(page.getByLabel('work done, lots.0')).toBeVisible();

  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select location', `${floor.loc_code} – ${floor.loc_name}`);
  await selectByAriaLabel(page, 'Select floor', floor.floor_name);
  await fillByLabelExact(page, 'placement quantity 1', String(q));

  await clickButton(page, 'Save receipt');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-in\/[^/]+$/);
  return page.url().split('/').pop()!;
}

/**
 * Creates a yarn purchase carrying a distinctive, fully-placed party lot.
 * The Party Lot No input (`PurchaseLineItemRow.tsx`, registers
 * `items.N.partyLotNo`) renders with aria-label "Party lot number for line
 * N", not the register name. Party lot is strictly derived/read-only
 * everywhere downstream (spec L2) — this purchase form is the ONLY place it
 * is ever typed.
 */
async function createPurchaseWithPartyLot(
  page: import('@playwright/test').Page,
  db: import('../../fixtures/db').Db,
  partyLot: string,
  q: number,
): Promise<SourceLotRow> {
  const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(vendor, 'seed must provide at least one active vendor').not.toBeNull();

  const quality = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

  const sku = await db.queryOne<{ id: string; name: string; shade_number: string | null }>(
    `SELECT id, name, shade_number FROM yarn_skus
     WHERE status = 'active' AND quality_id = $1
     ORDER BY code LIMIT 1`,
    [quality!.id],
  );
  expect(sku, 'seed must provide at least one active SKU for the chosen quality').not.toBeNull();

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
  const skuOptionLabel =
    sku!.shade_number !== null && sku!.shade_number !== ''
      ? `${sku!.name} — ${sku!.shade_number}`
      : sku!.name;
  await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
  await fillByLabel(page, 'Quantity for line 1', String(q));
  await fillByLabel(page, 'Party lot number for line 1', partyLot);
  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
  await selectByAriaLabel(page, 'Select floor', floor!.name);
  await fillByLabelExact(page, 'placement quantity 1', String(q));

  await clickButton(page, 'Save purchase');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);

  const purchaseId = page.url().split('/').pop()!;
  const mintedRow = await db.queryOne<{ lot_number: string | null }>(
    `SELECT lot_number FROM stock_ledger WHERE transaction_id = $1 LIMIT 1`,
    [purchaseId],
  );
  expect(mintedRow, 'the purchase must mint a stock_ledger row').not.toBeNull();
  expect(mintedRow!.lot_number).not.toBeNull();

  return {
    lot_number: mintedRow!.lot_number!,
    sku_id: sku!.id,
    quality_id: quality!.id,
    quality_code: quality!.code,
    quality_name: quality!.name,
    sku_name: sku!.name,
    sku_shade_number: sku!.shade_number,
    loc_name: location!.name,
    floor_name: floor!.name,
    floor_id: floor!.id,
  };
}

test(
  'the party lot survives two job-work hops and reaches the lot listing',
  async ({ page, db }) => {
    const PARTY_LOT = `PL-E2E-${Date.now() % 100000}`;
    const Q = 20;

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    // Hop 0 — purchase carrying a distinctive party lot, fully placed.
    const purchaseSrc = await createPurchaseWithPartyLot(page, db, PARTY_LOT, Q);

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
      [purchaseSrc.floor_id],
    );
    expect(receivingFloor, 'seed must provide a second active floor to receive into').not.toBeNull();

    // Hop 1 — out for twisting, received back.
    const out1 = await openJwPosition(page, jobWorker!, purchaseSrc, 'Twisting', Q);
    const in1Id = await receiveLot(page, purchaseSrc, out1, receivingFloor!, Q);

    const item1 = await db.queryOne<{ lot_no: string; party_lot_no: string | null }>(
      `SELECT lot_no, party_lot_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [in1Id],
    );
    expect(item1, 'hop 1 must mint exactly one yarn item row').not.toBeNull();
    expect(item1!.party_lot_no).toBe(PARTY_LOT);
    expect(item1!.lot_no).not.toBe(purchaseSrc.lot_number);

    // Hop 2 — that new lot out again for dyeing, received back. The party
    // lot must survive a lot minted from a lot that was itself minted by a
    // receipt — the crux of the whole carry-forward chain.
    const srcB: SourceLotRow = {
      ...purchaseSrc,
      lot_number: item1!.lot_no,
      loc_name: receivingFloor!.loc_name,
      floor_name: receivingFloor!.floor_name,
      floor_id: receivingFloor!.floor_id,
    };
    const out2 = await openJwPosition(page, jobWorker!, srcB, 'Dyeing', Q);
    const in2Id = await receiveLot(page, srcB, out2, receivingFloor!, Q);

    const item2 = await db.queryOne<{ lot_no: string; party_lot_no: string | null }>(
      `SELECT lot_no, party_lot_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [in2Id],
    );
    expect(item2, 'hop 2 must mint exactly one yarn item row').not.toBeNull();
    expect(item2!.party_lot_no).toBe(PARTY_LOT);
    expect(item2!.lot_no).not.toBe(srcB.lot_number);

    // Visible in the lot listing — the surface a user actually reads. The
    // inventory overview redesign (B-015) moved the per-lot list to
    // /inventory/lots (/inventory is now the quality+SKU overview); the
    // exact lotNumber filter isolates this row regardless of other DB
    // activity (same idiom as placement.spec.ts).
    await gotoAndExpect(page, `/inventory/lots?lotNumber=${item2!.lot_no}`);
    const lotRows = page.getByRole('row', { name: item2!.lot_no });
    await expect(lotRows).toHaveCount(1);
    await expect(lotRows.first()).toContainText(PARTY_LOT);

    // And in a picker, appended AFTER the lot number (label invariant,
    // formatLotIdentity/formatAggregatedLotLabel in lot-labels.ts): open a
    // fresh JW-Out and drive the source-lot picker up to (but not past) the
    // option list. Gassing is picked deliberately — item2's lot already
    // carries twisting+dyeing, and isValidInputState rejects a job-work type
    // the lot has already been through, so re-requesting Twisting or Dyeing
    // here would filter the lot OUT of its own picker.
    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await page.getByRole('checkbox', { name: 'Gassing' }).check();
    await selectByAriaLabel(
      page,
      'Quality for line 1',
      `${purchaseSrc.quality_code} – ${purchaseSrc.quality_name}`,
    );
    await selectByAriaLabel(page, 'Select SKU', skuLabelOf(purchaseSrc));
    await page.locator('[aria-label="Source lot for line 1"]').click();
    const option = page.getByRole('option', { name: item2!.lot_no });
    await expect(option).toContainText(`${item2!.lot_no} — ${PARTY_LOT}`);
  },
);

/**
 * Drives the per-lot-sources JW-In form for the MULTI-source case: one
 * received lot fed by N source rows under `lots.0`, fully placed. Same shape
 * as the single-source `receiveLot` above but generalized over `sources` —
 * modeled on the RED/BLUE cross-SKU test in tests/flows/jw-in-yarn.spec.ts
 * (copied, not imported).
 */
async function receiveMergedLot(
  page: import('@playwright/test').Page,
  lotSrc: SourceLotRow,
  sources: readonly { outChallanNo: string; q: number }[],
  floor: { loc_code: string; loc_name: string; floor_name: string },
  netWeight: number,
): Promise<string> {
  await gotoAndExpect(page, '/jw-challans-in/new');
  await expect(page.getByRole('heading', { name: 'New Job Work Challan In' })).toBeVisible();

  await selectByAriaLabel(page, 'quality, lots.0', `${lotSrc.quality_code} – ${lotSrc.quality_name}`);
  await selectByAriaLabel(page, 'sku, lots.0', skuLabelOf(lotSrc));
  await fillByLabel(page, 'net weight, lots.0', String(netWeight));

  for (const [i, s] of sources.entries()) {
    await page.getByLabel('add source, lots.0').click();
    await page.getByLabel(`source, lots.0.sources.${i}`, { exact: true }).click();
    await fillByLabel(page, 'Search OUT challan no', s.outChallanNo);
    const option = page.getByRole('option', { name: s.outChallanNo });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.getByLabel(`consumed quantity, lots.0.sources.${i}`)).toHaveValue(String(s.q));
  }

  await expect(page.locator('[aria-label="source coverage, lots.0"]')).toHaveText('✓ Covered');

  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select location', `${floor.loc_code} – ${floor.loc_name}`);
  await selectByAriaLabel(page, 'Select floor', floor.floor_name);
  await fillByLabelExact(page, 'placement quantity 1', String(netWeight));

  await clickButton(page, 'Save receipt');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-in\/[^/]+$/);
  return page.url().split('/').pop()!;
}

// I1 (final-review.md, 2026-08-20): the merge path — two source lots with
// DIFFERENT party lots combined into one received lot — had no non-mock
// coverage; jw-challan-in.service.test.ts's "combines distinct party lots
// when sources disagree" mocks findPartyLotsByLotNumbers and never proves
// the resolution against a real DB. This test also exercises the exact
// shape of C1 (shared/src/primitives/party-lot.ts, fixed in 1.19.1): a
// combined value re-entering combinePartyLots at a later hop, alongside one
// of its own ancestors, must not duplicate that ancestor or lose the sort.
test(
  'a merge combines two source party lots into one sorted, deduped string, and a third hop reintroducing one ancestor stays clean',
  async ({ page, db }) => {
    const now = Date.now() % 100000;
    const PARTY_A = `PL-M1-${now}`;
    const PARTY_B = `PL-M2-${now}`;
    const Q = 20;

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    // Purchase A carries 2Q so half survives hop 1 untouched, to serve as the
    // repeated ancestor at hop 3. Both purchases resolve the same "first
    // active" vendor/quality/sku/location (deterministic seed query,
    // createPurchaseWithPartyLot above) — the merge under test is about
    // party lots, not cross-SKU sourcing (jw-in-yarn.spec.ts covers that).
    const srcA = await createPurchaseWithPartyLot(page, db, PARTY_A, Q * 2);
    const srcB = await createPurchaseWithPartyLot(page, db, PARTY_B, Q);

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
      [srcA.floor_id],
    );
    expect(receivingFloor, 'seed must provide a second active floor to receive into').not.toBeNull();

    // Hop 1 — Q of A and all of B out for Twisting, received back as ONE lot
    // drawing from BOTH sources.
    const outA1 = await openJwPosition(page, jobWorker!, srcA, 'Twisting', Q);
    const outB = await openJwPosition(page, jobWorker!, srcB, 'Twisting', Q);
    const in1Id = await receiveMergedLot(
      page,
      srcA,
      [
        { outChallanNo: outA1, q: Q },
        { outChallanNo: outB, q: Q },
      ],
      receivingFloor!,
      Q * 2,
    );

    const item1 = await db.queryOne<{ lot_no: string; party_lot_no: string | null }>(
      `SELECT lot_no, party_lot_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [in1Id],
    );
    expect(item1, 'hop 1 must mint exactly one yarn item row').not.toBeNull();
    const combined = [PARTY_A, PARTY_B].sort().join(' / ');
    expect(item1!.party_lot_no).toBe(combined);

    await gotoAndExpect(page, `/jw-challans-in/${in1Id}`);
    await expect(page.getByTestId('party-lot-0')).toContainText(combined);

    // Hop 3 — the merged lot goes out again (Dyeing: it already carries
    // Twisting from hop 1's default-ticked work-done chip), alongside the
    // REMAINING half of source A's own raw lot (untouched, still
    // Twisting-eligible — a separate JW-Out challan, so it's fine to reuse
    // the same job-work type). Receiving both together is exactly the C1
    // shape: PARTY_A is already present inside the merged lot's own combined
    // string when it reappears as a second source's atomic party lot.
    const mergedSrc: SourceLotRow = {
      ...srcA,
      lot_number: item1!.lot_no,
      loc_name: receivingFloor!.loc_name,
      floor_name: receivingFloor!.floor_name,
      floor_id: receivingFloor!.floor_id,
    };
    const outMerged = await openJwPosition(page, jobWorker!, mergedSrc, 'Dyeing', Q * 2);

    // L3 (spec 2026-09-02-party-lot-on-jw-out-challan-design) — a merged lot's
    // combined party-lot string reaches the JW-Out response VERBATIM: the BE
    // resolves it in a single hop from jw_challan_in_yarn_item.party_lot_no
    // (2026-08-20 L10, denormalized per generation), never re-deriving or
    // re-joining it. Asserted here rather than in jw-out.spec because this
    // spec already owns the two-purchase → merged-receipt round trip that
    // produces a combined value; jw-out.spec keeps a 2-lot fixture.
    //
    // openJwPosition returns the minted challan NUMBER (format-only per I6);
    // the id comes from the row, not from an assertion on that number.
    const outMergedRow = await db.queryOne<{ id: string }>(
      `SELECT id FROM jw_challans_out WHERE challan_no = $1`,
      [outMerged],
    );
    expect(outMergedRow, 'the merged-lot JW-Out must resolve to a jw_challans_out row').not.toBeNull();
    const outWire = await page.request.get(`${env.API_URL}/jw-challans-out/${outMergedRow!.id}`);
    expect(outWire.ok()).toBe(true);
    const outBody = (await outWire.json()) as {
      items: { sourceLotNumber: string; partyLotNo: string | null }[];
    };
    const mergedItem = outBody.items.find((item) => item.sourceLotNumber === item1!.lot_no);
    expect(mergedItem, 'the JW-Out must carry an item for the merged lot').toBeDefined();
    expect(
      mergedItem!.partyLotNo,
      'the combined party-lot string must print verbatim, joined exactly once',
    ).toBe(combined);
    const outARemainder = await openJwPosition(page, jobWorker!, srcA, 'Dyeing', Q);

    const in3Id = await receiveMergedLot(
      page,
      srcA,
      [
        { outChallanNo: outMerged, q: Q * 2 },
        { outChallanNo: outARemainder, q: Q },
      ],
      receivingFloor!,
      Q * 3,
    );

    const item3 = await db.queryOne<{ lot_no: string; party_lot_no: string | null }>(
      `SELECT lot_no, party_lot_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [in3Id],
    );
    expect(item3, 'hop 3 must mint exactly one yarn item row').not.toBeNull();
    // NOT "PL-M1-... / PL-M1-... / PL-M2-..." — the exact bug C1 fixed.
    expect(item3!.party_lot_no).toBe(combined);
    const tokens = item3!.party_lot_no!.split(' / ');
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens).toEqual([...tokens].sort());
  },
);

// I2/I3 (final-review.md, 2026-08-20): beamCompositionSourceResponseSchema
// gained a required partyLotNo field with no live or response-validated
// exercise — `npm test` in the FE never runs the smoke/contract suite, so a
// mapper that failed to project the field would only be caught by a real
// wire round-trip. Reuses the in_house beam receipt pattern from
// beam-receipt.spec.ts (copied, not imported) with a party-lot-carrying
// source instead of a bare seed lot, so the composition table cell being
// asserted is never '—'.
test(
  'an in_house beam receipt composition slice carries its source lot party lot number, end to end',
  async ({ page, db }) => {
    const PARTY = `PL-BEAM-${Date.now() % 100000}`;
    const Q = 6;

    const src = await createPurchaseWithPartyLot(page, db, PARTY, Q);

    const beamNumber = `BM-PL-${Date.now()}`;

    await gotoAndExpect(page, '/beam-receipts/new');
    await page
      .getByRole('group', { name: 'beam origin' })
      .getByRole('button', { name: 'In-house', exact: true })
      .click();

    await fillByLabel(page, 'beam number, items.0', beamNumber);
    await fillByLabel(page, 'net weight, items.0', String(Q));

    await clickButton(page, 'add yarn to item 1');
    await selectByAriaLabel(
      page,
      'yarn quality, items.0.yarns.0',
      `${src.quality_code} – ${src.quality_name}`,
    );
    await selectByAriaLabel(page, 'yarn sku, items.0.yarns.0', skuLabelOf(src));
    await fillByLabel(page, 'yarn quantity, items.0.yarns.0', String(Q));

    await clickButton(page, `add pull for ${src.quality_code}`);
    await page.locator('[aria-label="pull lot, pulls.0"]').click();
    const pullLotOption = page.getByRole('option', { name: src.lot_number });
    await expect(pullLotOption).toContainText(/· \d+\.\d{3} KG · Raw$/);
    await pullLotOption.click();

    await selectByAriaLabel(page, 'pull floor, pulls.0', `${src.loc_name} · ${src.floor_name}`);
    await fillByLabel(page, 'pull quantity, pulls.0', String(Q));

    await clickButton(page, 'Save beam receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);

    const receiptId = page.url().split('/').pop()!;

    const compRow = await db.queryOne<{ party_lot_no: string | null }>(
      `SELECT bcs.party_lot_no
       FROM beam_composition_sources bcs
       JOIN beam_receipt_items bri ON bri.id = bcs.beam_item_id
       WHERE bri.beam_receipt_id = $1
       LIMIT 1`,
      [receiptId],
    );
    expect(compRow, 'the beam receipt must write one composition source row').not.toBeNull();
    expect(compRow!.party_lot_no).toBe(PARTY);

    // Live rendering — the one live load that both closes I3's visual gap
    // for this surface and is the only response-validation exercise of
    // beamCompositionSourceResponseSchema against a real backend response.
    await gotoAndExpect(page, `/beam-receipts/${receiptId}`);
    await expect(page.getByRole('cell', { name: PARTY, exact: true })).toBeVisible();
  },
);
