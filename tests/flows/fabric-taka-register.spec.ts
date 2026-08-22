import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import { confirmDialogAndWait, getCsrfToken } from '../../support/api';
import { codes } from '../../fixtures/codes';
import { createFabricDesign, createReceivedBeam } from '../../support/weaving-in-fixtures';
import type { Db } from '../../fixtures/db';
import type { Page } from '@playwright/test';

// This spec's OWN job worker (API-driven, same pattern as createReceivedBeam)
// instead of the shared "first active job worker" weaving-in.spec.ts also
// picks. Sharing a weaver is a second, subtler contention: cancelling this
// spec's receipt (FTR-L12) credits weft back to an at-JW position for that
// weaver that outlives the test (the dispatch itself is never cancelled).
// weaving-in.spec.ts's own weft receive auto-allocates FIFO across ALL open
// at-JW positions for its weaver — if that weaver is shared, a leftover
// position from this spec's cancel can absorb weaving-in.spec.ts's drain
// instead of the position its own ledger-key assertion is watching.
async function createJobWorker(page: Page, db: Db): Promise<{ id: string; code: string; name: string }> {
  const csrfToken = await getCsrfToken(page);
  const name = codes.unique('E2E FTR Weaver');
  const res = await page.request.post(`${env.API_URL}/job-workers`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { name, stateCode: '27', jobWorkTypes: ['weaving'] },
  });
  if (res.status() !== 201) throw new Error(`job worker create failed: ${await res.text()}`);
  const row = await db.queryOne<{ id: string; code: string }>(
    `SELECT id, code FROM job_workers WHERE name = $1`,
    [name],
  );
  if (!row) throw new Error('the job worker create must register a job_workers row');
  return { id: row.id, code: row.code, name };
}

// Funds this test's OWN weft lot via a direct API-driven yarn purchase
// (same "BE-validated request, no bespoke UI drive" pattern as
// weaving-in-fixtures.ts's createReceivedBeam) instead of drawing balance
// off whatever shared seed lot jw-out.spec.ts's own query also targets —
// two specs racing the same seed lot's balance is exactly the kind of
// cross-spec depletion this suite's "own data" rule (README.md /
// context-doc) exists to prevent. SKU-bearing (unlike
// support/sentinel-purchase.ts's SKU-less stock): the weaving-dispatch weft
// line drives an explicit "Select SKU" field, so the funded lot must carry
// a real skuId.
async function fundWeftLot(
  page: Page,
  db: Db,
  opts: { quantity: number; locationId: string; floorId: string },
): Promise<{
  lotNumber: string;
  skuId: string;
  qualityId: string;
  qualityCode: string;
  qualityName: string;
  skuName: string;
  skuShadeNumber: string | null;
}> {
  const vendor = await db.queryOne<{ id: string }>(
    `SELECT id FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(vendor, 'seed must provide an active vendor').not.toBeNull();

  const qualitySku = await db.queryOne<{
    quality_id: string;
    quality_code: string;
    quality_name: string;
    sku_id: string;
    sku_name: string;
    sku_shade_number: string | null;
  }>(
    `SELECT q.id AS quality_id, q.code AS quality_code, q.name AS quality_name,
            sku.id AS sku_id, sku.name AS sku_name, sku.shade_number AS sku_shade_number
     FROM yarn_qualities q
     JOIN yarn_skus sku ON sku.quality_id = q.id AND sku.status = 'active'
     WHERE q.status = 'active'
     ORDER BY q.code, sku.code
     LIMIT 1`,
  );
  expect(qualitySku, 'seed must provide an active quality with an active SKU').not.toBeNull();

  const csrfToken = await getCsrfToken(page);
  const res = await page.request.post(`${env.API_URL}/yarn-purchases`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      date: new Date().toISOString(),
      vendorId: vendor!.id,
      items: [
        {
          qualityId: qualitySku!.quality_id,
          skuId: qualitySku!.sku_id,
          quantity: opts.quantity,
          unit: 'KG',
          placements: [
            {
              locationId: opts.locationId,
              floorId: opts.floorId,
              quantity: opts.quantity,
              unit: 'KG',
            },
          ],
        },
      ],
    },
  });
  if (res.status() !== 201) throw new Error(`yarn purchase create failed: ${await res.text()}`);
  const row = await db.queryOne<{ lot_number: string }>(
    `SELECT lot_number FROM stock_ledger WHERE sku_id = $1 AND quality_id = $2 AND floor_id = $3
     ORDER BY created_at DESC LIMIT 1`,
    [qualitySku!.sku_id, qualitySku!.quality_id, opts.floorId],
  );
  if (!row) throw new Error('the yarn purchase must register a stock_ledger row');

  return {
    lotNumber: row.lot_number,
    skuId: qualitySku!.sku_id,
    qualityId: qualitySku!.quality_id,
    qualityCode: qualitySku!.quality_code,
    qualityName: qualitySku!.quality_name,
    skuName: qualitySku!.sku_name,
    skuShadeNumber: qualitySku!.sku_shade_number,
  };
}

// Reads the Stock Balance Fabric tab's placed/unplaced pair for one design,
// straight off the rendered table row (inventory-balance.page.tsx:224-233:
// `Placed ${n} · Unplaced ${m}`). A design with zero taka yet renders NO row
// at all (the tbody maps over fabricRows, which the aggregate query never
// returns a zero-taka design in) — treat "row absent" as {placed:0,
// unplaced:0} rather than failing, so this helper works both before AND
// after this test's own receive step creates the row.
async function readFabricTabCounts(
  page: Page,
  designCode: string,
  designName: string,
): Promise<{ placed: number; unplaced: number }> {
  // useFabricStockAggregate carries staleTime: 30_000 — reading the DOM
  // right after gotoAndExpect (which only waits for the nav landmark, not
  // this data fetch) races a still-loading/empty table against the actual
  // GET /weaving-ins/fabric-stock response. Wait for that response before
  // reading so before/after pairs in the same test (well within 30s of each
  // other) never race the fetch this table depends on.
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === '/weaving-ins/fabric-stock',
    ),
    gotoAndExpect(page, '/inventory?tab=fabric'),
  ]);
  const row = page.getByRole('row', { name: new RegExp(`${designCode} .* ${designName}`) });
  if ((await row.count()) === 0) return { placed: 0, unplaced: 0 };
  const text = (await row.first().textContent()) ?? '';
  const m = /Placed (\d+) · Unplaced (\d+)/.exec(text);
  if (!m) throw new Error(`Fabric tab row did not match "Placed n · Unplaced m": "${text}"`);
  return { placed: Number(m[1]), unplaced: Number(m[2]) };
}

test(
  'fabric taka register: receive with a header location, find by paper serial, move floors, detail provenance, cancel clears placement',
  async ({ page, db }) => {
    const jobWorker = await createJobWorker(page, db);

    // Two distinct active (location, floor) pairs — pair[0] is the header
    // location applied at receipt (FTR-L9), pair[1] is where two of the
    // three taka get moved to via the register. Deliberately NOT constrained
    // to share a location: the register's move action only needs the floor
    // to belong to the CHOSEN location (design spec §3.4 step 3), and
    // requiring two floors under one location would assume seed shape this
    // suite otherwise never assumes.
    const floorPairs = await db.queryMany<{
      location_id: string;
      location_code: string;
      location_name: string;
      floor_id: string;
      floor_name: string;
    }>(
      `SELECT l.id AS location_id, l.code AS location_code, l.name AS location_name,
              f.id AS floor_id, f.name AS floor_name
       FROM location_floors f
       JOIN locations l ON l.id = f.location_id
       WHERE f.status = 'active' AND l.status = 'active'
       ORDER BY f.id
       LIMIT 2`,
    );
    expect(
      floorPairs.length,
      'seed must provide at least two active (location, floor) pairs',
    ).toBeGreaterThanOrEqual(2);
    const [placeAt, moveTo] = floorPairs as [(typeof floorPairs)[0], (typeof floorPairs)[0]];

    // Weft source — this test's OWN funded lot (fundWeftLot), not a draw
    // against the shared seed lot weaving-in.spec.ts's identical query also
    // targets: two specs racing the same seed balance is the exact
    // cross-spec depletion this suite's "own data" rule exists to prevent
    // (it once starved jw-out.spec.ts's own >=10-balance requirement on a
    // full-suite run). Reuses placeAt's (location, floor) purely to avoid a
    // second DB round trip — no domain meaning is shared between "where the
    // weft lot sits" and "where the receipt places taka".
    const Q_WEFT = 15;
    const src = await fundWeftLot(page, db, {
      quantity: Q_WEFT,
      locationId: placeAt.location_id,
      floorId: placeAt.floor_id,
    });

    // Distinct prefix from weaving-in.spec.ts's FABD-WVI so the two specs'
    // rows stay visually distinguishable in the DB even though codes.unique
    // already guarantees no real collision.
    const fabricDesign = await createFabricDesign(page, db, src.qualityId, { prefix: 'FABD-FTR' });

    const beam1 = await createReceivedBeam(page, db, { netWeight: 15, setLength: 100 });
    const beam2 = await createReceivedBeam(page, db, { netWeight: 12, setLength: 80 });

    // BASELINE — Fabric tab placed/unplaced BEFORE this test's receive.
    // fabricDesign was just created with zero taka, so this is {0, 0} today,
    // but the assertion below is a DELTA regardless (e2e/README.md:77 /
    // context-doc's e2e section) — it must hold even if a future change adds
    // taka to a design before its own receive step.
    const fabricBefore = await readFabricTabCounts(page, fabricDesign.code, `E2E ${fabricDesign.code}`);

    // DISPATCH both beams + weft to the weaver — identical UI-drive to
    // weaving-in.spec.ts (its own selectors, not new contract).
    await gotoAndExpect(page, '/weaving-dispatches/new');
    // Dispatch form's Job worker is a Combobox since the 2026-08-22 redesign — click-driven, not a native select.
    await selectByLabel(page, 'Job worker', `${jobWorker.code} – ${jobWorker.name}`);
    await page.getByLabel('Show beams for all weavers').check();
    await page.getByLabel('Search beams').fill(beam1.beamNumber);
    await page.getByLabel(`Select beam ${beam1.beamNumber}`).check();
    await page.getByLabel(`Gross weight for beam ${beam1.beamNumber}`).fill('17');
    await page.getByLabel(`Pipe weight for beam ${beam1.beamNumber}`).fill('2');
    await page.getByLabel('Search beams').fill(beam2.beamNumber);
    await page.getByLabel(`Select beam ${beam2.beamNumber}`).check();
    await page.getByLabel(`Gross weight for beam ${beam2.beamNumber}`).fill('14');
    await page.getByLabel(`Pipe weight for beam ${beam2.beamNumber}`).fill('2');
    await fillByLabel(page, 'Beam Value of Goods', '5000');
    await selectByAriaLabel(page, 'Quality for weft line 1', `${src.qualityCode} – ${src.qualityName}`);
    const skuOptionLabel =
      src.skuShadeNumber !== null && src.skuShadeNumber !== ''
        ? `${src.skuName} — ${src.skuShadeNumber}`
        : src.skuName;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await selectByAriaLabel(page, 'Source lot for weft line 1', src.lotNumber);
    await fillByLabel(page, 'Net weight for weft line 1', String(Q_WEFT));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select floor and location',
      `${placeAt.location_name} · ${placeAt.floor_name}`,
    );
    await fillByLabel(page, 'placement quantity 1', String(Q_WEFT));
    await fillByLabel(page, 'Weft Value of Goods', '3000');
    await clickButton(page, 'Save dispatch');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/weaving-dispatches\/[^/]+$/);

    // RECEIVE — header gains the new, optional LocationFloorSelect (FTR-L9).
    // Three taka, each given a unique paper serial so the "find by the
    // weaver's paper serial" step has a deterministic target, and one taka
    // (S3) split across both beams so the "detail shows beam provenance"
    // step has real multi-beam data to assert.
    const s1 = codes.unique('S');
    const s2 = codes.unique('S');
    const s3 = codes.unique('S');

    await gotoAndExpect(page, '/weaving-ins/new');
    // Weaving-in form's Job worker is a Combobox since the 2026-08-22 redesign — click-driven, not a native select.
    await selectByLabel(page, 'Job worker', `${jobWorker.code} – ${jobWorker.name}`);
    await fillByLabel(page, 'Paper challan no', '149');
    await page.getByLabel(`Select beam ${beam1.beamNumber}`).check();
    await page.getByLabel(`Select beam ${beam2.beamNumber}`).check();

    // New FTR-L9 header field. Optional on the schema, but this test sets it
    // — the whole point of this spec is proving the receipt-time placement
    // path, not the "still Unplaced" fallback (which is a BE/FE integration
    // test's job per design spec §5).
    await selectByAriaLabel(page, 'Select location', `${placeAt.location_code} – ${placeAt.location_name}`);
    await selectByAriaLabel(page, 'Select floor', placeAt.floor_name);

    const fillTaka = async (
      n: number,
      opts: {
        paperSerial: string;
        meters: number;
        weightKg: number;
        attribution: Array<{ beamNumber: string; meters: number }>;
      },
    ) => {
      if (n > 0) await clickButton(page, 'Add taka');
      await fillByLabel(page, `paper serial, takas.${n}`, opts.paperSerial);
      await selectByAriaLabel(page, `fabric design, takas.${n}`, fabricDesign.code);
      await fillByLabel(page, `meters, takas.${n}`, String(opts.meters));
      await fillByLabel(page, `weight, takas.${n}`, String(opts.weightKg));
      await clickButton(page, `Set beam allocation, takas.${n}`);
      for (const alloc of opts.attribution) {
        await fillByLabel(
          page,
          `attributed meters for beam ${alloc.beamNumber}, takas.${n}`,
          String(alloc.meters),
        );
      }
      await clickButton(page, `Done, takas.${n}`);
      await expect(page.locator(`[data-cell="glm"][data-row="${n}"]`)).toContainText(/250(\.0+)?/);
    };

    await fillTaka(0, {
      paperSerial: s1,
      meters: 30,
      weightKg: 7.5,
      attribution: [{ beamNumber: beam1.beamNumber, meters: 30 }],
    });
    await fillTaka(1, {
      paperSerial: s2,
      meters: 40,
      weightKg: 10,
      attribution: [{ beamNumber: beam1.beamNumber, meters: 40 }],
    });
    await fillTaka(2, {
      paperSerial: s3,
      meters: 20,
      weightKg: 5,
      attribution: [
        { beamNumber: beam1.beamNumber, meters: 10 },
        { beamNumber: beam2.beamNumber, meters: 10 },
      ],
    });

    await expect(page.locator('[aria-label="derived weft kg"]')).toContainText(/9(\.0+)?/);
    await fillByLabel(page, 'Entered weft kg', '9');

    await clickButton(page, 'Save receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/weaving-ins\/[^/]+$/);
    const receiptId = page.url().split('/').pop() as string;
    const frcNo = await captureDocNo(page.getByRole('main'), /\bFRC-\d{4}-\d{2}-\d{3,}\b/);
    expect(frcNo).toMatch(/^FRC-\d{4}-\d{2}-\d{3,}$/);

    // ASSERT — Fabric tab placed/unplaced DELTA around the receive. Exactly
    // 3 taka move to "placed" (header location applied to every row per
    // §3.0), zero to "unplaced". Never an absolute — see Global Constraints.
    const fabricAfterReceive = await readFabricTabCounts(
      page,
      fabricDesign.code,
      `E2E ${fabricDesign.code}`,
    );
    expect(fabricAfterReceive.placed - fabricBefore.placed).toBe(3);
    expect(fabricAfterReceive.unplaced - fabricBefore.unplaced).toBe(0);

    // ASSERT — register lists these taka as PLACED. Deep-link via
    // ?weavingInId=<id> (§3.1's weavingInId filter, exercised here through
    // the same URL-param deep-link machinery the Fabric tab already uses for
    // ?fabricDesignId=<id> — "these 13 taka" per design spec §3.1).
    await gotoAndExpect(page, `/fabric-takas?weavingInId=${receiptId}`);
    for (const serial of [s1, s2, s3]) {
      const checkbox = page.getByRole('checkbox', { name: `Select ${frcNo} / ${serial}` });
      await expect(checkbox).toBeVisible();
      const row = checkbox.locator('xpath=ancestor::tr[1]');
      await expect(row).toContainText(placeAt.floor_name);
    }

    // FIND ONE BY THE WEAVER'S PAPER SERIAL — the register-wide search box
    // (DataTable's own 'Search records' input), not the weavingInId filter.
    // §3.2's parse falls back to a substring match on paperSerialNo, so the
    // full unique serial narrows to exactly this one taka across the whole
    // register, not just this receipt.
    await gotoAndExpect(page, '/fabric-takas');
    await page.getByLabel('Search records').fill(s3);
    const s3Checkbox = page.getByRole('checkbox', { name: `Select ${frcNo} / ${s3}` });
    await expect(s3Checkbox).toBeVisible();
    await expect(page.getByRole('checkbox', { name: `Select ${frcNo} / ${s1}` })).toHaveCount(0);
    await page.getByLabel('Search records').fill('');

    // SELECT TWO (S1, S2) AND MOVE THEM to a different floor. Back on the
    // weavingInId-scoped view so all three rows are visible together.
    await gotoAndExpect(page, `/fabric-takas?weavingInId=${receiptId}`);
    await page.getByRole('checkbox', { name: `Select ${frcNo} / ${s1}` }).check();
    await page.getByRole('checkbox', { name: `Select ${frcNo} / ${s2}` }).check();
    // Running totals: 30+40=70m, 7.5+10=17.5kg over the 2 selected taka.
    // Weight renders via format.kg (fixed 3 decimals, e.g. "17.500 kg" — the
    // same formatter the Fabric tab's "22.500 kg" total already uses).
    await expect(page.getByText(/2 taka · 70(\.0+)? m · 17\.500 kg/)).toBeVisible();

    await clickButton(page, 'Place selected (2)');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await selectByAriaLabel(page, 'Select location', `${moveTo.location_code} – ${moveTo.location_name}`);
    await selectByAriaLabel(page, 'Select floor', moveTo.floor_name);
    const [placeRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/fabric-takas/place',
      ),
      dialog.getByRole('button', { name: 'Place', exact: true }).click(),
    ]);
    expect(placeRes.status()).toBe(200);
    await expect(dialog).not.toBeVisible();

    // ASSERT — the underlying state, not just on-screen text (this suite's
    // standing rule for anything a number depends on). Exactly the 2 moved
    // taka carry the new floor; S3 is untouched.
    const movedRows = await db.queryMany<{ paper_serial_no: string; floor_id: string }>(
      `SELECT paper_serial_no, floor_id FROM fabric_takas WHERE weaving_in_id = $1 ORDER BY paper_serial_no`,
      [receiptId],
    );
    const byserial = new Map(movedRows.map((r) => [r.paper_serial_no, r.floor_id] as const));
    expect(byserial.get(s1)).toBe(moveTo.floor_id);
    expect(byserial.get(s2)).toBe(moveTo.floor_id);
    expect(byserial.get(s3)).toBe(placeAt.floor_id);

    // ASSERT — Fabric tab placed/unplaced is UNCHANGED by a same-status
    // move (still all 3 placed, still 0 unplaced) — proves the register's
    // move action is a relocation, not a placement-state transition.
    const fabricAfterMove = await readFabricTabCounts(
      page,
      fabricDesign.code,
      `E2E ${fabricDesign.code}`,
    );
    expect(fabricAfterMove.placed).toBe(fabricAfterReceive.placed);
    expect(fabricAfterMove.unplaced).toBe(fabricAfterReceive.unplaced);

    // DETAIL PAGE — beam provenance. S3 is the split taka (beam1 + beam2).
    const s3Row = await db.queryOne<{ id: string }>(
      `SELECT id FROM fabric_takas WHERE weaving_in_id = $1 AND paper_serial_no = $2`,
      [receiptId, s3],
    );
    expect(s3Row, 'S3 taka must exist').not.toBeNull();
    await gotoAndExpect(page, `/fabric-takas/${s3Row!.id}`);
    const beamsSection = page.locator('section', {
      has: page.getByRole('heading', { name: 'Beam Provenance' }),
    });
    await expect(beamsSection).toContainText(beam1.beamNumber);
    await expect(beamsSection).toContainText(beam2.beamNumber);

    // CANCEL the receipt — same alertdialog-confirm shape as
    // weaving-in.spec.ts, via the shared confirmDialogAndWait helper.
    await gotoAndExpect(page, `/weaving-ins/${receiptId}`);
    const cancelRes = await confirmDialogAndWait(
      page,
      'Cancel receipt',
      /\/weaving-ins\/[^/]+\/cancel$/,
    );
    expect(cancelRes.status()).toBe(200);
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

    // ASSERT — locationId/floorId nulled for ALL THREE taka (design spec
    // §3.5), regardless of which floor each currently sits on.
    const afterCancel = await db.queryMany<{ paper_serial_no: string; location_id: string | null }>(
      `SELECT paper_serial_no, location_id FROM fabric_takas WHERE weaving_in_id = $1`,
      [receiptId],
    );
    expect(afterCancel).toHaveLength(3);
    for (const row of afterCancel) {
      expect(row.location_id, `${row.paper_serial_no} must have locationId cleared`).toBeNull();
    }

    // ASSERT — the taka leave the DEFAULT register view (status omitted ⇒
    // 'received', which now excludes this cancelled receipt's rows).
    await gotoAndExpect(page, `/fabric-takas?weavingInId=${receiptId}`);
    await expect(
      page.getByRole('checkbox', { name: `Select ${frcNo} / ${s1}` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('checkbox', { name: `Select ${frcNo} / ${s3}` }),
    ).toHaveCount(0);
  },
);
