import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
// algorithm (fabtraq-shared/src/primitives/distribute.ts) — sums to EXACTLY
// 30.000 by construction (its documented rounding-residual tie-break lands
// on the largest weight's slot). The per-group quantities themselves
// (14.816 / 4.964 / 4.595 / 5.625) are pinned by FE unit/integration tests
// (DesignPrefillDialog, allocate-pulls); this e2e only needs the exact-total
// invariant, below.
const NET_WEIGHT = 30;

// Consolidated-pull redesign (docs/specs/2026-07-21-beam-receipt-
// consolidated-pull-design.md, fabtraq-fe, Addendum v4 finding V1): every
// warp group in this design maps to the SAME (quality, sku) pair (this seed
// only has one quality/SKU pair), so the design-prefill dialog's
// duplicate-yarn-key merge collapses all 4 warp-group rows into a SINGLE
// Section-A yarn row for the beam, quantity = Σ of the 4 = NET_WEIGHT
// exactly. The per-warp split therefore no longer exists as a distinct FE
// state to observe here — it's proven by the unit suite instead. What this
// e2e still proves end-to-end against the real BE: PDF -> design ->
// colour-way -> prefilled beam -> a SPLIT-ACROSS-TWO-LOTS consolidated pull
// (Section B allows multiple pull rows per yarn key) -> exact per-lot ledger
// drains on save.
const SPLIT_LOT_A_QTY = 20;
const SPLIT_LOT_B_QTY = NET_WEIGHT - SPLIT_LOT_A_QTY; // 10

interface SourcePos {
  readonly lotNumber: string;
  readonly locationId: string;
  readonly locationName: string;
  readonly floorId: string;
  readonly floorName: string;
}

test(
  'PDF import maps a design with colour-ways, then a colour-way-2 beam prefill merges to one yarn row and drains via a two-lot consolidated pull',
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

    // ── STEP 4: /beam-receipts/new, in-house, design prefill, colour-way 2 ───
    // Resolve 2 DISTINCT-lot-NUMBER floor-held positions for (quality, sku)
    // with enough balance for the two-way pull split — the bigger split
    // (SPLIT_LOT_A_QTY) is reserved first so it doesn't get starved by the
    // smaller one. Two lines may legitimately share a lot NUMBER as long as
    // the FLOOR differs (the ledger key is (lot, quality, sku, floor) —
    // CompositionSourcePicker deliberately drops the isValidInputState
    // filter, so any processed type is eligible; see beam-receipt.spec.ts's
    // note on the same picker) — but this test explicitly excludes the first
    // pull's lot NUMBER for the second, so the split provably spans two
    // distinct lots, not two floors of one lot.
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
    //
    // Positions are picked JUST BEFORE they're used (not batched upfront) —
    // this dev DB is shared with other agents concurrently exercising the
    // SAME (and only) seeded quality/SKU, so a position resolved long before
    // it's used can go stale by submit time. A +20kg safety margin on top of
    // each pull's own requirement absorbs small concurrent nibbles.
    const MARGIN_KG = 20;
    const excluded: { lotNumber: string; floorId: string }[] = [];
    async function pickPosition(
      minBalance: number,
      excludeLotNumbers: readonly string[] = [],
    ): Promise<SourcePos> {
      const excludeClauses = excluded
        .map((_, i) => `NOT (sl.lot_number = $${4 + i * 2} AND sl.floor_id = $${5 + i * 2})`)
        .join(' AND ');
      const lotExclusionClause =
        excludeLotNumbers.length > 0
          ? `AND sl.lot_number <> ALL($${4 + excluded.length * 2})`
          : '';
      const params: unknown[] = [quality!.id, sku!.id, minBalance];
      for (const e of excluded) params.push(e.lotNumber, e.floorId);
      if (excludeLotNumbers.length > 0) params.push([...excludeLotNumbers]);
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
           ${lotExclusionClause}
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

    // Net weight MUST be set BEFORE opening the design-prefill dialog: the
    // dialog's "Total yarn used" defaults from `items.0.netWeight` once, at
    // open time, and the redesign deliberately deleted every v3 auto-resync
    // effect (Addendum v4 / spec A-4 "Deliberate behavior change") — there is
    // no live rescale if net weight changes afterwards.
    await fillByLabel(page, 'net weight, items.0', String(NET_WEIGHT));

    await clickButton(page, 'prefill from design, item 1');
    await selectByAriaLabel(page, 'select design', designName);

    await expect(page.getByRole('radiogroup', { name: 'colour-way' })).toBeVisible();
    await page.getByRole('radio', { name: 'Colour-way 2', exact: false }).click();

    // Total yarn used already defaults to NET_WEIGHT (set above) — confirm
    // before Apply rather than assume it.
    await expect(page.getByLabel('total yarn used', { exact: false })).toHaveValue(
      String(NET_WEIGHT),
    );

    await clickButton(page, 'Apply');

    // Apply replaces items.0.yarns with one row per warp group, THEN merges
    // rows sharing a yarn key (V1) — since all 4 warp groups here map to the
    // SAME (quality, sku), Apply collapses them into exactly ONE Section-A
    // yarn row, quantity === NET_WEIGHT (distributeByWeight's exact-sum
    // invariant — see NET_WEIGHT's doc comment above).
    const yarnQtyInput = page.getByLabel('yarn quantity, items.0.yarns.0', { exact: false });
    await expect(yarnQtyInput).toHaveValue(String(NET_WEIGHT));
    await expect(
      page.locator('[aria-label="yarn quantity, items.0.yarns.1"]'),
    ).toHaveCount(0);

    // Section B group label is SKU-qualified (Addendum v4 finding V2):
    // `<quality code> – <quality name> · <sku name> (<sku code>)`.
    const groupLabel = `${quality!.code} – ${quality!.name} · ${sku!.name} (${sku!.code})`;

    // ── STEP 4b: split the consolidated pull across TWO distinct lots
    // (Section B allows multiple pull rows per yarn key) — the receipt-level
    // equivalent of the old nested multi-lot model, now expressed as two
    // `pulls[]` rows instead of a per-source lot sub-target.
    const posBig = await pickPosition(SPLIT_LOT_A_QTY + MARGIN_KG);
    const posSmall = await pickPosition(SPLIT_LOT_B_QTY + MARGIN_KG, [posBig.lotNumber]);

    await clickButton(page, `add pull for ${quality!.code}`);
    await selectByAriaLabel(page, 'pull lot, pulls.0', posBig.lotNumber);
    await selectByAriaLabel(
      page,
      'pull floor, pulls.0',
      `${posBig.locationName} · ${posBig.floorName}`,
    );
    await fillByLabel(page, 'pull quantity, pulls.0', String(SPLIT_LOT_A_QTY));

    await clickButton(page, `add pull for ${quality!.code}`);
    await selectByAriaLabel(page, 'pull lot, pulls.1', posSmall.lotNumber);
    await selectByAriaLabel(
      page,
      'pull floor, pulls.1',
      `${posSmall.locationName} · ${posSmall.floorName}`,
    );
    await fillByLabel(page, 'pull quantity, pulls.1', String(SPLIT_LOT_B_QTY));

    // The two pulls must exactly cover the yarn's need (B-3 exact-coverage
    // gate) — cross-check via the group's own coverage badge rather than
    // re-summing in JS, so this is a real read of the rendered UI.
    await expect(page.getByLabel(`pull coverage, ${groupLabel}`, { exact: false })).toHaveText(
      '✓ covered',
    );

    const pullEntries = [
      { pos: posBig, qty: SPLIT_LOT_A_QTY },
      { pos: posSmall, qty: SPLIT_LOT_B_QTY },
    ].map(({ pos, qty }) => ({
      qty,
      key: {
        qualityId: quality!.id,
        skuId: sku!.id,
        lotNumber: pos.lotNumber,
        locationId: pos.locationId,
        floorId: pos.floorId,
      },
    }));
    const before = await Promise.all(pullEntries.map((e) => db.ledgerBalance(e.key)));

    await clickButton(page, 'Save beam receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);

    // ── STEP 5: ledger oracle — each pull drained exactly its own quantity,
    // including both halves of the two-lot split ───────────────────────────
    const after = await Promise.all(pullEntries.map((e) => db.ledgerBalance(e.key)));
    pullEntries.forEach((e, i) => {
      expect(after[i] - before[i]).toBeCloseTo(-e.qty, 3);
    });

    // The two pulls landed in two DISTINCT lots — the split's whole point.
    expect(posBig.lotNumber).not.toBe(posSmall.lotNumber);

    // ── STEP 6: display denormalizations (2026-07-19 fixes) ─────────────────
    // Receipt detail shows the design NAME (mapper previously hardcoded
    // designName: null, so this field rendered blank for every design beam).
    await expect(page.getByText(designName)).toBeVisible();

    // Beam register row derives its Quality from the composition's quality
    // names (in_house beams have no operator-typed qualityText).
    await gotoAndExpect(page, '/beams');
    const registerRow = page.getByRole('row', { name: new RegExp(beamNumber) });
    await expect(registerRow).toBeVisible();
    await expect(registerRow).toContainText(quality!.name);

    const beamItem = await db.queryOne<{ colourway_id: string; design_id: string }>(
      `SELECT colourway_id, design_id FROM beam_receipt_items WHERE beam_number = $1`,
      [beamNumber],
    );
    expect(beamItem, 'the created beam receipt item must be found by its beam number').not.toBeNull();
    expect(beamItem!.colourway_id).toBe(cw2!.id);
    expect(beamItem!.design_id).toBe(designId);
  },
);
