import { type Locator, type Page } from '@playwright/test';

import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, fillByLabelExact, selectByAriaLabel, selectByLabel, clickButton } from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// Beam Register (`/beams`) is READ-ONLY — list + detail, no create/edit. Beams are
// registered as a side effect of the beam-receipt flow (see beam-receipt.spec.ts,
// Task 16): tx.beam.create runs per item with status: 'received'
// (BeamReceiptService.createInHouse, beam-receipt.service.ts). There is no
// `/beams/new` route — do not drive one.
//
// Precondition — a received beam. The seed (prisma/seed.ts, "Scenario 4 — beam
// register") reliably creates one on every fresh reseed: a sizing_jw BeamReceipt
// whose item registers `beams` row { beamNumber: 'BEAM-2026-001', status:
// 'received' }. That satisfies this spec's precondition without needing to drive
// the beam-receipt flow inline (Task 16 already covers that path end-to-end), so
// this spec queries the DB to confirm ≥1 received beam exists and reads its real
// beamNumber/id back — it does not hardcode the seed's literal value, so it stays
// correct if the seed data changes, and does not assert a minted document number
// (beamNumber here is a fixed seed fixture, not an FY sequence counter).

// ── "Sourced From" derivation (this workstream, prisma-beam.repository.ts
// BEAM_SELECT / beam.mapper.ts): the BE resolves `sourcedFrom` by joining
// beam_receipt_items.out_item_id -> jw_challan_out_items -> jw_challans_out
// -> job_workers.name. `sourcedFromDisplay` (fabtraq-fe
// src/features/beams/lib/sourced-from.ts) then renders:
//   sourcedFrom !== null            -> that job worker's name
//   sourcedFrom === null && in_house -> ORIGIN_LABEL.in_house ("In-house")
//   otherwise (purchase, or sizing_jw with no resolvable out item)
//                                    -> "—"
// ORIGIN_LABEL (fabtraq-fe src/shared/lib/beam-origin.ts) is the single
// source of truth for the Origin badge text: purchase="Purchase",
// in_house="In-house", sizing_jw="Sizing JW". Mirrored here (read from the FE
// source, not guessed) so this spec fails if either file's copy drifts.
const ORIGIN_LABEL: Record<string, string> = {
  purchase: 'Purchase',
  in_house: 'In-house',
  sizing_jw: 'Sizing JW',
};

function expectedSourcedFrom(beamOrigin: string, jobWorkerName: string | null): string {
  if (jobWorkerName !== null) return jobWorkerName;
  if (beamOrigin === 'in_house') return ORIGIN_LABEL.in_house;
  return '—';
}

// DataTable cells carry no test id / column-scoped attribute, and several
// beam-register columns (Quality, Cut, Sourced From, Remaining (m)) can all
// independently render the bare "—" placeholder — a row-scoped
// `getByText('—')` would strict-mode-collide across them. Resolve the column
// index from the live header row instead, so the assertion stays correct
// regardless of column order.
async function cellInColumn(page: Page, row: Locator, columnName: string): Promise<Locator> {
  const headers = page.getByRole('columnheader');
  const idx = await headers.evaluateAll(
    (els, name) => els.findIndex((el) => el.textContent?.trim() === name),
    columnName,
  );
  expect(idx, `beam register must have a "${columnName}" column`).toBeGreaterThanOrEqual(0);
  return row.getByRole('cell').nth(idx);
}

test('beam register lists a received beam and its detail renders', async ({ page, db }) => {
  // Extended (this workstream) with a LEFT JOIN through the OUT-challan chain
  // that resolves `sourcedFrom` — same joins as prisma-beam.repository.ts's
  // BEAM_SELECT. LEFT JOIN (not JOIN): purchase/in_house beams and a
  // sizing_jw beam with no out_item_id (e.g. BEAM-C-002, see the dedicated
  // test below) must still be selectable here, with job_worker_name coming
  // back NULL for them.
  const seededBeam = await db.queryOne<{
    id: string;
    beam_number: string;
    status: string;
    beam_origin: string;
    receipt_entry_no: string;
    job_worker_name: string | null;
  }>(
    `SELECT b.id, b.beam_number, b.status, b.beam_origin, br.entry_no AS receipt_entry_no,
            jw.name AS job_worker_name
     FROM beams b
     JOIN beam_receipt_items bri ON bri.id = b.beam_receipt_item_id
     JOIN beam_receipts br ON br.id = bri.beam_receipt_id
     LEFT JOIN jw_challan_out_items jcoi ON jcoi.id = bri.out_item_id
     LEFT JOIN jw_challans_out jco ON jco.id = jcoi.challan_out_id
     LEFT JOIN job_workers jw ON jw.id = jco.job_worker_id
     WHERE b.status = 'received'
     ORDER BY b.created_at ASC
     LIMIT 1`,
  );
  expect(seededBeam, 'seed must provide at least one received beam (Scenario 4)').not.toBeNull();

  const expectedOrigin = ORIGIN_LABEL[seededBeam!.beam_origin] ?? seededBeam!.beam_origin;
  const expectedSourced = expectedSourcedFrom(seededBeam!.beam_origin, seededBeam!.job_worker_name);

  // LIST — filter the status Select to "Received" (beam-list.page.tsx:
  // SelectTrigger aria-label="Filter by status", option label "Received" for the
  // 'received' BeamStatus value). The generic selectByAriaLabel helper does a
  // substring option match, which is ambiguous here ("Received" also matches the
  // "Fabric Received" option) — select with an exact option-name match instead.
  await gotoAndExpect(page, '/beams');

  // SEARCH — beam-number substring search (shared 1.21.0 beamListQuerySchema
  // `search`; BE ILIKE on beam_number; FE DataTable search box, 250ms debounce).
  // Lowercased query proves the case-insensitive path.
  await page.getByRole('textbox', { name: 'Search beams' }).fill(seededBeam!.beam_number.toLowerCase());
  await expect(page.getByRole('row', { name: seededBeam!.beam_number })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search beams' }).clear();

  await page.locator('[aria-label="Filter by status"]').click();
  await page.getByRole('option', { name: 'Received', exact: true }).click();

  const row = page.getByRole('row', { name: seededBeam!.beam_number });
  await expect(row).toBeVisible();
  // Status badge cell renders the human label (columns.tsx STATUS_LABEL.received).
  await expect(row.getByText('Received')).toBeVisible();

  // Origin badge + Sourced From (this workstream) — asserted against the
  // FETCHED value, never a hardcoded literal, so this stays correct for
  // whichever received beam the seed happens to surface first.
  await expect(await cellInColumn(page, row, 'Origin')).toHaveText(expectedOrigin);
  await expect(await cellInColumn(page, row, 'Sourced From')).toHaveText(expectedSourced);

  // DETAIL — the whole row is clickable (spec 2026-07-30); the per-row View
  // link/button was removed — DataTable's onRowClick is the only affordance.
  //
  // Click a NON-number cell. The beam-number cell is a trace link as of the
  // Inventory Rewoven Phase 1 work (design spec §5.1: every lot/beam/taka
  // number in Lots / Beam Register / Fabric Takas becomes a link to
  // `/inventory/trace?ref=`, cell-level, with stopPropagation where rows
  // navigate). Both affordances are intended and coexist — number to trace,
  // rest of the row to detail — so this assertion has to target the row, not
  // the number, or it silently tests the link instead of onRowClick.
  await (await cellInColumn(page, row, 'Origin')).click();
  await expect(page).toHaveURL(new RegExp(`/beams/${seededBeam!.id}$`));

  // Detail page renders the beam's key fields (beam-detail.page.tsx): heading
  // "Beam <beamNumber>", the Beam No field, and the Received status badge.
  await expect(
    page.getByRole('heading', { name: `Beam ${seededBeam!.beam_number}` }),
  ).toBeVisible();
  await expect(page.getByText(seededBeam!.beam_number, { exact: true })).toBeVisible();
  await expect(page.getByText('Received', { exact: true })).toBeVisible();

  // Provenance section (spec 2026-07-30): the receipt entry-no renders as a
  // link to the receipt page — present for every beam (FK is required).
  const provenanceSection = page.locator('section').filter({ hasText: 'Provenance' });
  await expect(provenanceSection).toBeVisible();
  await expect(
    page.getByRole('link', { name: seededBeam!.receipt_entry_no }),
  ).toBeVisible();

  // Sourced From (this workstream) lives in Provenance, beside Source Challan
  // — not in Movement, which now covers physical custody only (storage /
  // weaver / issued / created / updated; beam-detail.page.tsx).
  await expect(provenanceSection.getByText('Sourced From')).toBeVisible();
  await expect(provenanceSection.getByText('Source Challan')).toBeVisible();
  const sourcedFromStat = provenanceSection.locator('div').filter({ hasText: 'Sourced From' }).last();
  await expect(sourcedFromStat).toContainText(expectedSourced);

  const movementSection = page.locator('section').filter({ hasText: 'Movement' });
  await expect(movementSection.getByText('Sourced From')).toHaveCount(0);
});

// The "—" path. BEAM-C-002 (prisma/seed.ts "Scenario Part-C", ~line 1435-1472)
// is a sizing_jw beam whose item carries NO out_item_id, recreated on every
// fresh reseed — sourcedFromDisplay has nothing to resolve for it, so it must
// render "—" on both the register and the detail page. Selected by querying
// for that exact shape (sizing_jw + out_item_id IS NULL), never by the seed's
// literal beam number — see the file-level trap note: the OLD unqualified
// "first received beam" query could silently land on this very row and assert
// "Warp Masters" against a beam that legitimately shows "—".
test('a sizing_jw beam with no resolvable OUT item shows "—" for Sourced From', async ({ page, db }) => {
  const beam = await db.queryOne<{ id: string; beam_number: string }>(
    `SELECT b.id, b.beam_number
     FROM beams b
     JOIN beam_receipt_items bri ON bri.id = b.beam_receipt_item_id
     WHERE b.beam_origin = 'sizing_jw' AND bri.out_item_id IS NULL
     ORDER BY b.created_at ASC
     LIMIT 1`,
  );
  expect(
    beam,
    'seed must provide a sizing_jw beam with no out_item_id (BEAM-C-002)',
  ).not.toBeNull();

  await gotoAndExpect(page, '/beams');
  await page.getByRole('textbox', { name: 'Search beams' }).fill(beam!.beam_number);
  const row = page.getByRole('row', { name: beam!.beam_number });
  await expect(row).toBeVisible();
  await expect(await cellInColumn(page, row, 'Sourced From')).toHaveText('—');

  // Non-number cell again — the number cell is a trace link (see the note on
  // the first detail assertion above).
  await (await cellInColumn(page, row, 'Sourced From')).click();
  await expect(page).toHaveURL(new RegExp(`/beams/${beam!.id}$`));
  const provenanceSection = page.locator('section').filter({ hasText: 'Provenance' });
  const sourcedFromStat = provenanceSection.locator('div').filter({ hasText: 'Sourced From' }).last();
  await expect(sourcedFromStat).toContainText('—');
});

// The per-item regression guard. `out_item_id` lives on beam_receipt_items,
// not on the receipt header (prisma/schema.prisma BeamReceiptItem), so one
// beam receipt can legitimately carry beams sourced from TWO DIFFERENT job
// workers. A header-level implementation (e.g. resolving `sourcedFrom` once
// per receipt instead of once per item) would pass every single-beam
// assertion above and only fail here.
//
// The seed provides no such receipt (its one sizing_jw receipt with a
// resolvable source, Scenario 4, has exactly one item), so this test builds
// its own — same fixture-creation idiom as beam-receipt.spec.ts's "sizing_jw
// beam receipt mixes beams from two OUT challans" test: a raw lot -> warping
// JW-Challan-Out -> JW-Challan-In (yarn, processedTypes=['warping']) mints a
// warped lot -> two sizing JW-Challan-Out challans off that lot, sent to two
// DIFFERENT job workers (not two different lots) so their resolved
// `sourcedFrom` names are distinct -> one beam receipt with one item per
// challan.
test('a beam receipt with beams sourced from two different job workers shows the correct name on each item', async ({
  page,
  db,
}) => {
  const Q_WARP = 30;
  const Q_SENT_A = 12;
  const Q_SENT_B = 10;

  const jobWorkerA = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  const jobWorkerB = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code OFFSET 1 LIMIT 1`,
  );
  expect(jobWorkerA, 'seed must provide an active job worker').not.toBeNull();
  expect(
    jobWorkerB,
    'seed must provide a second active job worker (distinct sourcedFrom names)',
  ).not.toBeNull();

  // Raw (unprocessed) floor lot with enough balance to warp — same
  // derivation as beam-receipt.spec.ts / jw-out.spec.ts.
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
    loc_id: string;
  }>(
    `SELECT s.lot_number, s.sku_id, s.quality_id,
            q.code AS quality_code, q.name AS quality_name,
            sku.name AS sku_name, sku.shade_number AS sku_shade_number,
            l.id AS loc_id, l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
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
              sku.name, sku.shade_number, l.id, l.name, f.name, f.id
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

  const receivingFloor = await db.queryOne<{
    loc_id: string;
    loc_name: string;
    floor_name: string;
    floor_id: string;
  }>(
    `SELECT l.id AS loc_id, l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
     FROM location_floors f JOIN locations l ON l.id = f.location_id
     WHERE f.id <> $1 AND l.status = 'active' AND f.status = 'active'
     ORDER BY f.id LIMIT 1`,
    [src!.floor_id],
  );
  expect(receivingFloor, 'seed must provide a second active floor to receive into').not.toBeNull();

  // ── Step 0a: warping JW-Challan-Out on the raw lot — opens the at-JW
  //    position the following JW-In drains.
  await gotoAndExpect(page, '/jw-challans-out/new');
  await selectByLabel(page, 'Job worker', `${jobWorkerA!.code} – ${jobWorkerA!.name}`);
  await page.getByRole('checkbox', { name: 'Warping', exact: true }).check();
  await selectByAriaLabel(page, 'Quality for line 1', `${src!.quality_code} – ${src!.quality_name}`);
  await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
  await selectByAriaLabel(page, 'Source lot for line 1', src!.lot_number);
  await fillByLabel(page, 'Net weight for line 1', String(Q_WARP));
  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select floor and location', `${src!.loc_name} · ${src!.floor_name}`);
  await fillByLabelExact(page, 'placement quantity 1', String(Q_WARP));
  await clickButton(page, 'Save challan');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
  const warpOutChallanNo = await captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);

  // ── Step 0b: JW-Challan-In (yarn) receiving the warping challan fully,
  //    processedTypes=['warping'], crediting `receivingFloor` with a freshly
  //    minted warped lot. Driven via a direct API call — findEligibleOutItems
  //    deliberately excludes beam-track (warping/sizing/weaving) OUT
  //    challans from the "Pick eligible out item" picker's candidate list, so
  //    a warping challan can't be selected there by design (same pattern as
  //    beam-receipt.spec.ts's mixed-challan test).
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
          netWeight: Q_WARP,
          unit: 'KG',
          sources: [
            {
              jwChallanOutItemId: warpOutItem!.id,
              consumedQty: Q_WARP,
              wastage: 0,
              stillAtJwQty: 0,
              completions: [{ jobWorkType: 'warping', completed: true }],
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

  // ── Step 1: two sizing OUT challans off the SAME warped lot, sent to
  //    DIFFERENT job workers.
  async function createSizingOutChallan(
    jobWorker: { code: string; name: string },
    qty: number,
  ): Promise<string> {
    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectByLabel(page, 'Job worker', `${jobWorker.code} – ${jobWorker.name}`);
    await page.getByRole('checkbox', { name: 'Sizing', exact: true }).check();
    await selectByAriaLabel(page, 'Quality for line 1', `${src!.quality_code} – ${src!.quality_name}`);
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await selectByAriaLabel(page, 'Source lot for line 1', warpedLot);
    await fillByLabel(page, 'Net weight for line 1', String(qty));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select floor and location', `${receivingFloor!.loc_name} · ${receivingFloor!.floor_name}`);
    await fillByLabelExact(page, 'placement quantity 1', String(qty));
    await clickButton(page, 'Save challan');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
    return captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
  }

  const challanNoA = await createSizingOutChallan(jobWorkerA!, Q_SENT_A);
  const challanNoB = await createSizingOutChallan(jobWorkerB!, Q_SENT_B);

  // ── Step 2: one beam receipt (origin "Sizing JW"), one item per challan.
  await gotoAndExpect(page, '/beam-receipts/new');
  await page.getByRole('group', { name: 'beam origin' }).getByRole('button', { name: 'Sizing JW', exact: true }).click();

  const beamNumberA = codes.unique('BM-SRC-A');
  const beamNumberB = codes.unique('BM-SRC-B');

  await fillByLabel(page, 'beam number, items.0', beamNumberA);
  await fillByLabel(page, 'net weight, items.0', String(Q_SENT_A));
  await page.getByRole('button', { name: 'Pick eligible out item' }).nth(0).click();
  await page.getByRole('option').filter({ hasText: challanNoA }).first().click();

  await clickButton(page, '+ Add beam item');
  await fillByLabel(page, 'beam number, items.1', beamNumberB);
  await fillByLabel(page, 'net weight, items.1', String(Q_SENT_B));
  await page.getByRole('button', { name: 'Pick eligible out item' }).nth(1).click();
  await page.getByRole('option').filter({ hasText: challanNoB }).first().click();

  await clickButton(page, 'Save beam receipt');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);
  const receiptId = page.url().split('/').pop();

  // ── Assert: /beam-receipts/:id shows BOTH distinct job worker names, each
  //    on its own beam item card — not one name collapsed onto both, and not
  //    the challan number substituting for the resolved party name.
  await gotoAndExpect(page, `/beam-receipts/${receiptId}`);

  const cardA = page.locator('div.p-5').filter({ hasText: beamNumberA });
  const cardB = page.locator('div.p-5').filter({ hasText: beamNumberB });
  await expect(cardA).toBeVisible();
  await expect(cardB).toBeVisible();

  const sourcedFromA = cardA.locator('div').filter({ hasText: 'Sourced From' }).last();
  const sourcedFromB = cardB.locator('div').filter({ hasText: 'Sourced From' }).last();
  await expect(sourcedFromA).toContainText(jobWorkerA!.name);
  await expect(sourcedFromB).toContainText(jobWorkerB!.name);
  // Non-tautological: a header-level bug (one resolved name applied to every
  // item) would make these equal.
  expect(jobWorkerA!.name).not.toBe(jobWorkerB!.name);
});

// The beam-number cell is a TRACE link, not a detail link (Inventory Rewoven
// design spec §5.1: every lot/beam/taka number in the Lots page, Beam Register
// and Fabric Takas register becomes a `<Link to="/inventory/trace?ref=…">`,
// cell-level, with stopPropagation where the row itself navigates).
//
// This is the lockstep partner of the two detail assertions above, which now
// click a non-number cell. Without this test, changing the number cell back to
// a detail link would break no e2e assertion — the branch has already shipped
// one semantic merge conflict here that git reported no textual conflict for.
test('the beam-number cell links to trace, while the rest of the row opens the detail page', async ({
  page,
  db,
}) => {
  const beam = await db.queryOne<{ beam_number: string }>(
    `SELECT beam_number FROM beams WHERE status <> 'cancelled' ORDER BY created_at ASC LIMIT 1`,
  );
  expect(beam, 'seed must provide at least one non-cancelled beam').not.toBeNull();

  await gotoAndExpect(page, '/beams');
  await page.getByRole('textbox', { name: 'Search beams' }).fill(beam!.beam_number);
  const row = page.getByRole('row', { name: beam!.beam_number });
  await expect(row).toBeVisible();

  await row.getByRole('link', { name: beam!.beam_number, exact: true }).click();
  await expect(page).toHaveURL(`/inventory/trace?ref=${encodeURIComponent(beam!.beam_number)}`);
});
