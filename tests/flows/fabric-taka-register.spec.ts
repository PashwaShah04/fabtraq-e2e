import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import { confirmDialogAndWait } from '../../support/api';
import { codes } from '../../fixtures/codes';
import { createFabricDesign, createReceivedBeam } from '../../support/weaving-in-fixtures';
import type { Page } from '@playwright/test';

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
  await gotoAndExpect(page, '/inventory?tab=fabric');
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
    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide an active job worker').not.toBeNull();

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

    // Weft source — same derivation as weaving-in.spec.ts (any non-beam-track
    // floor lot, active masters, >= Q_WEFT balance). Reusing the identical
    // beam/taka math (100m/15kg + 80m/12kg beams, 30/40/20m taka) means this
    // spec's derivedWeftKg is the already-hand-verified 9.0 from that spec —
    // no new arithmetic to re-derive here.
    const Q_WEFT = 15;
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
    }>(
      `SELECT s.lot_number, s.sku_id, s.quality_id,
              q.code AS quality_code, q.name AS quality_name,
              sku.name AS sku_name, sku.shade_number AS sku_shade_number,
              l.name AS loc_name, f.name AS floor_name
       FROM stock_ledger s
       JOIN location_floors f ON f.id = s.floor_id
       JOIN locations l ON l.id = f.location_id
       JOIN yarn_qualities q ON q.id = s.quality_id
       JOIN yarn_skus sku ON sku.id = s.sku_id
       WHERE s.lot_number IS NOT NULL
         AND s.sku_id IS NOT NULL
         AND l.status = 'active' AND f.status = 'active'
         AND q.status = 'active' AND sku.status = 'active'
       GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
                sku.name, sku.shade_number, l.name, f.name
       HAVING SUM(s.in_quantity - s.out_quantity) >= $1
       ORDER BY s.lot_number
       LIMIT 1`,
      [Q_WEFT],
    );
    expect(src, 'seed must provide a lot with >= Q_WEFT balance on an active floor').not.toBeNull();

    // Distinct prefix from weaving-in.spec.ts's FABD-WVI so the two specs'
    // rows stay visually distinguishable in the DB even though codes.unique
    // already guarantees no real collision.
    const fabricDesign = await createFabricDesign(page, db, src!.quality_id, { prefix: 'FABD-FTR' });

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
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
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
    await selectByAriaLabel(page, 'Quality for weft line 1', `${src!.quality_code} – ${src!.quality_name}`);
    const skuOptionLabel =
      src!.sku_shade_number !== null && src!.sku_shade_number !== ''
        ? `${src!.sku_name} — ${src!.sku_shade_number}`
        : src!.sku_name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await selectByAriaLabel(page, 'Source lot for weft line 1', src!.lot_number);
    await fillByLabel(page, 'Net weight for weft line 1', String(Q_WEFT));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select floor and location', `${src!.loc_name} · ${src!.floor_name}`);
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
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
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
      const checkbox = page.getByRole('checkbox', { name: `Select taka, paper serial ${serial}` });
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
    const s3Checkbox = page.getByRole('checkbox', { name: `Select taka, paper serial ${s3}` });
    await expect(s3Checkbox).toBeVisible();
    await expect(page.getByRole('checkbox', { name: `Select taka, paper serial ${s1}` })).toHaveCount(0);
    await page.getByLabel('Search records').fill('');

    // SELECT TWO (S1, S2) AND MOVE THEM to a different floor. Back on the
    // weavingInId-scoped view so all three rows are visible together.
    await gotoAndExpect(page, `/fabric-takas?weavingInId=${receiptId}`);
    await page.getByRole('checkbox', { name: `Select taka, paper serial ${s1}` }).check();
    await page.getByRole('checkbox', { name: `Select taka, paper serial ${s2}` }).check();
    // Running totals: 30+40=70m, 7.5+10=17.5kg over the 2 selected taka.
    await expect(page.getByText(/2 taka · 70(\.0+)? m · 17\.5(\.0+)? kg/)).toBeVisible();

    await clickButton(page, 'Place selected (2)');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await selectByAriaLabel(page, 'Select location', `${moveTo.location_code} – ${moveTo.location_name}`);
    await selectByAriaLabel(page, 'Select floor', moveTo.floor_name);
    const [placeRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/fabric-takas/place',
      ),
      dialog.getByRole('button', { name: 'Place taka' }).click(),
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
    const beamsSection = page.locator('section', { has: page.getByRole('heading', { name: 'Beams' }) });
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
      page.getByRole('checkbox', { name: `Select taka, paper serial ${s1}` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('checkbox', { name: `Select taka, paper serial ${s3}` }),
    ).toHaveCount(0);
  },
);
