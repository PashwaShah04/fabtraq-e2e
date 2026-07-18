import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

// ---------------------------------------------------------------------------
// PDF -> mapped design -> colour-way beam -> exact ledger drains (design-v2
// spec §8, plan docs/plans/2026-07-17-design-v2-e2e.md task E1).
//
// Fixture: fixtures/pdfs/gr=17545-b.pdf, copied verbatim from
// ../fabtraq-pdf-parser/tests/fixtures/gr=17545-b.pdf. Its parsed shape is a
// GOLDEN fixture pinned by fabtraq-pdf-parser's
// tests/unit/design-sheet-parser.test.ts ("parses gr=17545-b.pdf exactly") —
// every value asserted below (reed count, 4 warp + 1 weft group, per-group
// weightKg, per-cell shade text) is that pinned parse output, not a guess.
// The live seed (fabtraq-be prisma/seed.ts Part C) already creates a
// DSN-001 "SEED-DESIGN-V2" fixture in this exact shape for OTHER purposes —
// this spec drives its OWN import through the UI instead of reusing that row,
// per the task brief ("create its own design via the import dialog").
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, '../../fixtures/pdfs/gr=17545-b.pdf');

// Per-warp-group weight (kg), sheet order A/B/C/D — parser golden values.
const WARP_WEIGHTS: Record<'A' | 'B' | 'C' | 'D', number> = {
  A: 8.228,
  B: 2.757,
  C: 2.552,
  D: 3.124,
};

// distributeByWeight(30, [8.228, 2.757, 2.552, 3.124]) — shared's real
// algorithm (fabtraq-shared/src/primitives/distribute.ts), re-run by hand for
// this exact input: raw shares round to [14.815, 4.964, 4.595, 5.625] (3 dp),
// summing to 29.999; the +0.001 rounding residual is added to the LARGEST
// weight's slot (warp A, 8.228 — distributeByWeight's documented tie-break),
// giving a FINAL sum of exactly 30.000. This corrects the task brief's
// suggested array (which put the residual on warp D instead) — verified
// against the real source, not assumed.
const EXPECTED_QTY: Record<'A' | 'B' | 'C' | 'D', number> = {
  A: 14.816,
  B: 4.964,
  C: 4.595,
  D: 5.625,
};

const WARP_ORDER: readonly ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];

interface SourcePos {
  readonly lotNumber: string;
  readonly locationId: string;
  readonly locationName: string;
  readonly floorId: string;
  readonly floorName: string;
}

// SourceRow (InHouseCompositionSection.tsx) has no row-level aria-label of
// its own, and several of its controls (the floor select, "Add placement",
// "placement quantity 1") are NOT indexed by source — each source's
// placements live in their own field array, so "placement quantity 1" (the
// first placement of THAT source) repeats identically across all 4 design-mode
// rows. Scope on the one thing that IS uniquely indexed per row — the "remove
// source N" button — via a `:has()`-style locator filter, so every other
// lookup inside a row is unambiguous.
function sourceRowLocator(page: Page, sourceIndex: number): Locator {
  return page
    .locator('div.rounded-md.border.border-border.bg-background.p-3')
    .filter({
      has: page.getByRole('button', { name: `remove source ${sourceIndex + 1}`, exact: true }),
    });
}

test(
  'PDF import maps a design with colour-ways, then a colour-way-2 beam drains the exact per-group ledger positions',
  async ({ page, db }) => {
    const uniqueSuffix = Date.now();
    const designName = `E2E Design v2 ${uniqueSuffix}`;
    const beamNumber = `BM-DSV2-${uniqueSuffix}`;

    // The live seed's ONLY quality (QTY-001 "20s CP", fabtraq-be prisma/seed.ts)
    // carries exactly 2 SKUs (SKU-001 RED, SKU-002 BLUE) — "first active"
    // resolves deterministically to these, same convention as every other
    // spec in this repo (e.g. placement.spec.ts, beam-receipt.spec.ts).
    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

    const sku = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_skus WHERE status = 'active' AND quality_id = $1 ORDER BY code LIMIT 1`,
      [quality!.id],
    );
    expect(sku, 'seed must provide at least one active SKU for the chosen quality').not.toBeNull();

    // ── STEP 1: /designs/new -> Import from PDF -> mapping grid shape ─────────
    // Type the unique name into the OUTER form's "Name" field BEFORE opening
    // the import dialog: ImportRecipeDialog's own scratch form always carries
    // the PDF's own designName ("gr=17545-b") through Apply; DesignFormPage's
    // handleImportApply only overrides that with our typed name when the
    // outer field was non-empty at Apply time (design-form.page.tsx).
    await gotoAndExpect(page, '/designs/new');
    await fillByLabel(page, 'design name', designName);

    await clickButton(page, 'Import from PDF');
    await page.getByLabel('Upload design PDF', { exact: false }).setInputFiles(FIXTURE_PDF);

    // Parsing can take up to ~60s for AI-scanned sheets per the dialog's own
    // copy; this fixture is a real text layer (fast path), but budget
    // generously anyway.
    await expect(page.getByRole('heading', { name: 'Assign quality per group' })).toBeVisible({
      timeout: 60_000,
    });

    // Shape: 4 warp rows + 1 weft row, 3 colour-way columns.
    await expect(page.locator('[aria-label^="quality, warp group "]')).toHaveCount(4);
    await expect(page.locator('[aria-label^="quality, weft group "]')).toHaveCount(1);
    await expect(page.locator('[aria-label^="colour-way name "]')).toHaveCount(3);

    // Flat cell index = groupIndex * 3 + colourwayIndex (recipe-import.ts
    // parsedToFormValues — rows.flatMap(group => colourways.map(...))).
    // Group order: warp A(0) B(1) C(2) D(3), weft A(4).
    await expect(page.getByLabel('shade text, cell 0', { exact: false })).toHaveValue('cream'); // warp A, cw1
    await expect(page.getByLabel('shade text, cell 3', { exact: false })).toHaveValue('BLACK'); // warp B, cw1
    await expect(page.getByLabel('shade text, cell 8', { exact: false })).toHaveValue('RUST**'); // warp C, cw3

    // ── STEP 2: assign quality per group, map colour-way 1 + 2 (AMENDMENT: ──
    // both columns get mapped — colour-way 2 is what the beam step below
    // drains, and its cells need real skuIds for the ledger-oracle
    // assertions). Colour-way 3 is left unmapped, per the original brief.
    const qualityOption = `${quality!.code} – ${quality!.name}`;
    const groupRows: { readonly section: 'warp' | 'weft'; readonly label: string }[] = [
      { section: 'warp', label: 'A' },
      { section: 'warp', label: 'B' },
      { section: 'warp', label: 'C' },
      { section: 'warp', label: 'D' },
      { section: 'weft', label: 'A' },
    ];
    for (const g of groupRows) {
      await selectByAriaLabel(page, `quality, ${g.section} group ${g.label}`, qualityOption);
    }

    const skuOption = `${sku!.name} (${sku!.code})`;
    // Colour-way 1 cells: groupIndex*3+0 for groups 0..4 -> 0,3,6,9,12.
    // Colour-way 2 cells: groupIndex*3+1 for groups 0..4 -> 1,4,7,10,13.
    // Colour-way 3 cells (2,5,8,11,14) are deliberately left untouched.
    const cellsToMap = [0, 3, 6, 9, 12, 1, 4, 7, 10, 13];
    for (const idx of cellsToMap) {
      await selectByAriaLabel(page, `sku, cell ${idx}`, skuOption);
    }

    await clickButton(page, 'Apply');
    await clickButton(page, 'Create design');
    await expectToast(page, /Design DSN-\d{3,} created/);
    await expect(page).toHaveURL(/\/designs\/[^/]+$/);
    const designId = page.url().split('/').pop() as string;

    // DETAIL — reed count + name (code)-labelled grid, as the mapping made it.
    await expect(page.getByRole('heading', { name: designName })).toBeVisible();
    await expect(page.getByText('36/2')).toBeVisible();
    await expect(page.getByText(skuOption).first()).toBeVisible();
    await expect(page.getByText('unmapped').first()).toBeVisible();

    // ── STEP 3: DB oracle — group count, colour-way-3 nulls, warp A weight ───
    const groupCount = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM design_yarn_groups WHERE design_id = $1`,
      [designId],
    );
    expect(Number(groupCount!.n)).toBe(5);

    const warpA = await db.queryOne<{ weight_kg: string }>(
      `SELECT weight_kg FROM design_yarn_groups WHERE design_id = $1 AND section = 'warp' AND label = 'A'`,
      [designId],
    );
    expect(Number(warpA!.weight_kg)).toBeCloseTo(WARP_WEIGHTS.A, 3);

    // Every colour-way-3 cell has sku_id IS NULL (5 rows: 4 warp + 1 weft) —
    // and, confirming the amendment actually took, every colour-way-1/2 cell
    // (10 rows) does NOT.
    const cw3Null = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM design_shade_cells dsc
       JOIN design_yarn_groups dyg ON dyg.id = dsc.group_id
       JOIN design_colourways dc ON dc.id = dsc.colourway_id
       WHERE dyg.design_id = $1 AND dc.position = 3 AND dsc.sku_id IS NULL`,
      [designId],
    );
    expect(Number(cw3Null!.n)).toBe(5);

    const cw12Mapped = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM design_shade_cells dsc
       JOIN design_yarn_groups dyg ON dyg.id = dsc.group_id
       JOIN design_colourways dc ON dc.id = dsc.colourway_id
       WHERE dyg.design_id = $1 AND dc.position IN (1, 2) AND dsc.sku_id IS NOT NULL`,
      [designId],
    );
    expect(Number(cw12Mapped!.n)).toBe(10);

    const cw2 = await db.queryOne<{ id: string }>(
      `SELECT id FROM design_colourways WHERE design_id = $1 AND position = 2`,
      [designId],
    );
    expect(cw2, 'design must have a colour-way at position 2').not.toBeNull();

    // ── STEP 4: /beam-receipts/new, in-house, design mode, colour-way 2 ──────
    // Resolve 4 DISTINCT (lot, floor) floor-held positions for (quality, sku)
    // with enough balance for each warp group's drain — processed
    // largest-requirement-first so the biggest lot is reserved for warp A
    // (14.816 kg) before smaller lots are claimed by the others. Two lines may
    // legitimately share a lot NUMBER as long as the FLOOR differs (the
    // ledger key is (lot, quality, sku, floor) — CompositionSourcePicker
    // deliberately drops the isValidInputState filter, so any processed type
    // is eligible; see beam-receipt.spec.ts's note on the same picker).
    //
    // Deliberately NOT filtering job_worker_id here: a floor's TRUE available
    // balance, as enforced by beam-receipt.service.ts's per-slice guard
    // (findLotLocationBalance, prisma-inventory.service.ts), sums every
    // stock_ledger row for the exact (lotNumber, locationId, floorId) —
    // job_worker_id is just provenance metadata on some debit rows (e.g. a
    // prior job-work challan-out FROM this same floor still carries this
    // floor's own floorId, not floorId=null), not a separate bucket to
    // exclude. Filtering `job_worker_id IS NULL` here (as this repo's Db
    // fixture convention does for distinguishing a floor row from an
    // AT-JOB-WORKER position row, which uses floorId=null) previously caused
    // this query to under-count a real debit and pick a lot the app then
    // rejected as under-balance at submit time — verified against the live
    // seed (LOT-260415-0001 has 47kg in via challan_in, 44kg out via a
    // challan_out tagged with a job_worker_id but a REAL floor_id, so its true
    // balance is 3kg, not 47).
    const excluded: { lotNumber: string; floorId: string }[] = [];
    async function pickPosition(minBalance: number): Promise<SourcePos> {
      const excludeClauses = excluded
        .map((_, i) => `NOT (sl.lot_number = $${4 + i * 2} AND sl.floor_id = $${5 + i * 2})`)
        .join(' AND ');
      const params: unknown[] = [quality!.id, sku!.id, minBalance];
      for (const e of excluded) params.push(e.lotNumber, e.floorId);
      const row = await db.queryOne<{
        lot_number: string;
        floor_id: string;
        floor_name: string;
        location_id: string;
        location_name: string;
      }>(
        `SELECT sl.lot_number, f.id AS floor_id, f.name AS floor_name,
                l.id AS location_id, l.name AS location_name
         FROM stock_ledger sl
         JOIN location_floors f ON f.id = sl.floor_id
         JOIN locations l ON l.id = f.location_id
         WHERE sl.quality_id = $1 AND sl.sku_id = $2
           AND l.status = 'active' AND f.status = 'active'
           ${excluded.length > 0 ? `AND ${excludeClauses}` : ''}
         GROUP BY sl.lot_number, f.id, f.name, l.id, l.name
         HAVING SUM(sl.in_quantity - sl.out_quantity) >= $3
         ORDER BY SUM(sl.in_quantity - sl.out_quantity) DESC
         LIMIT 1`,
        params,
      );
      expect(
        row,
        `seed must provide a floor-held (quality, sku) lot with >= ${minBalance} kg balance`,
      ).not.toBeNull();
      excluded.push({ lotNumber: row!.lot_number, floorId: row!.floor_id });
      return {
        lotNumber: row!.lot_number,
        locationId: row!.location_id,
        locationName: row!.location_name,
        floorId: row!.floor_id,
        floorName: row!.floor_name,
      };
    }

    await gotoAndExpect(page, '/beam-receipts/new');
    await page
      .getByRole('group', { name: 'beam origin' })
      .getByRole('button', { name: 'In-house', exact: true })
      .click();

    await fillByLabel(page, 'beam number, items.0', beamNumber);

    await page
      .getByRole('group', { name: 'composition mode' })
      .getByRole('button', { name: 'Design', exact: true })
      .click();
    await selectByAriaLabel(page, 'select design', designName);

    await expect(page.getByRole('radiogroup', { name: 'colour-way' })).toBeVisible();
    await page.getByRole('radio', { name: 'Colour-way 2', exact: false }).click();

    // Net weight is DELIBERATELY typed after the design + colour-way pick,
    // keystroke by keystroke (pressSequentially, NOT fill — fill sets the
    // value in one input event and can't reproduce this) — regression for the
    // 2026-07-18 bug where the prefill guard keyed on `netWeight > 0` and
    // froze every target quantity at the value computed from the FIRST
    // positive keystroke ('3' of '30'), never rescaling to the full figure.
    const netWeightInput = page.getByLabel('net weight, items.0', { exact: false });
    await netWeightInput.click();
    await netWeightInput.pressSequentially('30');

    // One composition line per warp group, quantity pre-filled by
    // distributeByWeight(netWeight, warpWeights) — read + assert against
    // EXPECTED_QTY (±0.001), then pick lot/floor per line and add the
    // matching placement so wastage stays at 0 (Σ placements === netWeight).
    //
    // Positions are picked JUST BEFORE each row is driven (not batched
    // upfront) — this dev DB is shared with other agents concurrently
    // exercising the SAME (and only) seeded quality/SKU, so a position
    // resolved long before it's used can go stale by submit time (observed
    // live: a first pass batching all 4 lookups upfront picked a lot whose
    // balance had swung from 3kg to 47kg and back to 3kg between the query
    // and the actual POST, a few seconds later). A +20kg safety margin on
    // top of each line's own requirement absorbs small concurrent nibbles;
    // processing largest-requirement-first still reserves the biggest lot
    // for warp A.
    const MARGIN_KG = 20;
    const positions: Partial<Record<'A' | 'B' | 'C' | 'D', SourcePos>> = {};
    const byRequirementDesc = [...WARP_ORDER].sort(
      (a, b) => EXPECTED_QTY[b] - EXPECTED_QTY[a],
    );
    for (const label of byRequirementDesc) {
      const i = WARP_ORDER.indexOf(label);
      const sourceLabel = `source ${i + 1}`;
      const qty = EXPECTED_QTY[label];

      const targetInput = page.getByLabel(`${sourceLabel} target quantity`, { exact: false });
      await expect(targetInput).toBeVisible();
      const targetValue = Number.parseFloat((await targetInput.inputValue()) || '0');
      expect(targetValue).toBeCloseTo(qty, 3);

      const pos = await pickPosition(qty + MARGIN_KG);
      positions[label] = pos;

      await selectByAriaLabel(page, `source lot for ${sourceLabel}`, pos.lotNumber);

      const row = sourceRowLocator(page, i);
      await row.getByRole('button', { name: 'Add placement', exact: false }).click();
      await row.locator('[aria-label="Select floor and location"]').click();
      await page
        .getByRole('option', { name: `${pos.locationName} · ${pos.floorName}` })
        .click();
      await row.getByLabel('placement quantity 1', { exact: false }).fill(String(qty));
    }

    // Sum of the 4 lines must equal netWeight exactly (distributeByWeight's
    // own invariant) — cross-check via the conservation bar rather than
    // re-summing in JS, so this is a real read of the rendered UI.
    await expect(page.getByLabel('placement conservation').first()).toContainText('Balanced');

    // jobWorkerId deliberately omitted (undefined = no filter, per Db's
    // whereFor) — see pickPosition's doc comment above: the true floor
    // balance for this (lot, location, floor) may include a legitimate
    // debit row that happens to carry a job_worker_id, and the new beam
    // drain row we're about to write also lands at this exact key, so an
    // unfiltered read is the one that matches what the app itself enforces
    // and what the delta below actually measures.
    const ledgerKeys = WARP_ORDER.map((label) => ({
      qualityId: quality!.id,
      skuId: sku!.id,
      lotNumber: positions[label]!.lotNumber,
      locationId: positions[label]!.locationId,
      floorId: positions[label]!.floorId,
    }));
    const before = await Promise.all(ledgerKeys.map((k) => db.ledgerBalance(k)));

    await clickButton(page, 'Save beam receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);

    // ── STEP 5: ledger oracle — each line drained exactly its own quantity ───
    const after = await Promise.all(ledgerKeys.map((k) => db.ledgerBalance(k)));
    WARP_ORDER.forEach((label, i) => {
      expect(after[i] - before[i]).toBeCloseTo(-EXPECTED_QTY[label], 3);
    });

    const beamItem = await db.queryOne<{ colourway_id: string; design_id: string }>(
      `SELECT colourway_id, design_id FROM beam_receipt_items WHERE beam_number = $1`,
      [beamNumber],
    );
    expect(beamItem, 'the created beam receipt item must be found by its beam number').not.toBeNull();
    expect(beamItem!.colourway_id).toBe(cw2!.id);
    expect(beamItem!.design_id).toBe(designId);
  },
);
