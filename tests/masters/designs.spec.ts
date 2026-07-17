import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

// Designs have NO edit route (recipe is immutable after create — BR-S4, see
// createDesignSchema's doc comment in fabtraq-shared). The row leads to a
// read-only detail page, so this spec is create → detail, not the usual
// master-CRUD create → list → edit → persist shape.
//
// REWRITTEN for design-v2 (2026-07-18): the v1 flat-recipe form
// ("Add ingredient", `quality, recipe row 1`, `percentage, recipe row 1`,
// single implicit colour-way) no longer exists on the FE — it was replaced by
// `design-form.page.tsx` + `<GroupsFieldArray>` (warp/weft groups, each with
// its own quality/percentage/weight) + `<ColourwayGrid>` (N colour-way
// columns, one shade-cell per group × colour-way). Same test *intent*
// preserved (owner-authored create → list → detail), now exercising the
// richer v2 shape end-to-end: 2 warp groups + 1 weft group, 2 colour-ways,
// one shade cell mapped to a seeded SKU, the D9 mapping-correction affordance
// on the detail page, and the active/inactive status toggle.
test('create a v2 design (warp/weft groups + colour-ways), view its rich detail, correct a shade-cell mapping, and retire it', async ({
  page,
  db,
}) => {
  // The live seed's ONLY quality (QTY-001 "20s CP") carries exactly 2 SKUs
  // (SKU-001 RED, SKU-002 BLUE) — same "first active" convention as every
  // other spec in this repo (placement.spec.ts, design-v2.spec.ts, …).
  const quality = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

  const skus = await db.queryOne<{ red_id: string; red_name: string; red_code: string }>(
    `SELECT id AS red_id, name AS red_name, code AS red_code FROM yarn_skus
     WHERE status = 'active' AND quality_id = $1 ORDER BY code LIMIT 1`,
    [quality!.id],
  );
  expect(skus, 'seed must provide at least one active SKU for the chosen quality').not.toBeNull();
  const blueSku = await db.queryOne<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM yarn_skus
     WHERE status = 'active' AND quality_id = $1 AND id <> $2 ORDER BY code LIMIT 1`,
    [quality!.id, skus!.red_id],
  );
  expect(blueSku, 'seed must provide a second active SKU for the chosen quality').not.toBeNull();

  // codes.designCode() alone is NOT unique across separate process runs (its
  // counter has no runTag, unlike codes.qualityName()/etc.) — reruns of this
  // spec against a non-reset dev DB can otherwise collide with an earlier
  // run's leftover design of the same name, breaking the by-name row lookup
  // below with a strict-mode violation (found live: two "E2E-DSN-901" rows
  // after a second run). A Date.now() suffix keeps it unique per run.
  const name = `${codes.designCode()}-${Date.now()}`;
  const qualityOption = `${quality!.code} – ${quality!.name}`;

  // ── CREATE — design-form.page.tsx has no "code" input (server-generated,
  // designCodeSchema) — "Name" (aria-label="design name") is the only free
  // text field, same as the v1 spec's convention.
  await gotoAndExpect(page, '/designs/new');
  await fillByLabel(page, 'design name', name);

  // 2 warp groups (A, B) + 1 weft group (A) — GroupsFieldArray relabels each
  // section contiguously as rows are added (design-form-groups.ts's
  // relabelSection), so labels are always A, B, … regardless of add order.
  await clickButton(page, 'Add warp group');
  await clickButton(page, 'Add warp group');
  await clickButton(page, 'Add weft group');

  await selectByAriaLabel(page, 'quality, warp group A', qualityOption);
  await selectByAriaLabel(page, 'quality, warp group B', qualityOption);
  await selectByAriaLabel(page, 'quality, weft group A', qualityOption);

  // Percentages sum to 100 within each section (not schema-required in v2,
  // but keeps GroupsFieldArray's cosmetic "deviates from 100%" warning quiet).
  await fillByLabel(page, 'percentage, warp group A', '60');
  await fillByLabel(page, 'percentage, warp group B', '40');
  await fillByLabel(page, 'percentage, weft group A', '100');

  // weightKg is all-or-none PER SECTION (createDesignSchema invariant 3) —
  // every group in both sections gets one, so the design carries real
  // beam-drain ratios (asserted below via the DB oracle).
  await fillByLabel(page, 'weight, warp group A', '6');
  await fillByLabel(page, 'weight, warp group B', '4');
  await fillByLabel(page, 'weight, weft group A', '10');

  // 2nd colour-way — ColourwayGrid.appendColourwayCells appends one new cell
  // PER EXISTING GROUP at the END of the flat shadeCells array (colour-way-
  // major order), so with 3 groups already present, the flat cell index for
  // (group, colour-way) is: colour-way 0 cells first (idx 0=warpA, 1=warpB,
  // 2=weftA), then colour-way 1 cells (idx 3=warpA, 4=warpB, 5=weftA).
  await clickButton(page, 'Add colour-way');

  // Give the one cell we're going to map a distinctive, human-typed shade
  // text — every other cell keeps the field's own default ("Colour"), which
  // is fine (shadeText only needs to be non-empty), but a shared default
  // would make the D9 edit-select below (aria-label keyed on shadeText)
  // ambiguous across all 6 cells.
  await fillByLabel(page, 'shade text, cell 0', 'Red Shade');
  await selectByAriaLabel(page, 'sku, cell 0', `${skus!.red_name} (${skus!.red_code})`);

  await clickButton(page, 'Create design');
  await expectToast(page, /Design DSN-\d{3,} created/);
  await expect(page).toHaveURL(/\/designs\/[^/]+$/);
  const designId = page.url().split('/').pop() as string;

  // ── DB ORACLE — groups/colourways/cells persisted exactly as mapped.
  const groupCount = await db.queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM design_yarn_groups WHERE design_id = $1`,
    [designId],
  );
  expect(Number(groupCount!.n)).toBe(3);

  const colourwayCount = await db.queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM design_colourways WHERE design_id = $1`,
    [designId],
  );
  expect(Number(colourwayCount!.n)).toBe(2);

  const cellCount = await db.queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM design_shade_cells dsc
     JOIN design_yarn_groups dyg ON dyg.id = dsc.group_id
     WHERE dyg.design_id = $1`,
    [designId],
  );
  expect(Number(cellCount!.n)).toBe(6);

  const warpA = await db.queryOne<{ weight_kg: string; percentage: string }>(
    `SELECT weight_kg, percentage FROM design_yarn_groups
     WHERE design_id = $1 AND section = 'warp' AND label = 'A'`,
    [designId],
  );
  expect(Number(warpA!.weight_kg)).toBeCloseTo(6, 3);
  expect(Number(warpA!.percentage)).toBeCloseTo(60, 3);

  const warpB = await db.queryOne<{ weight_kg: string; percentage: string }>(
    `SELECT weight_kg, percentage FROM design_yarn_groups
     WHERE design_id = $1 AND section = 'warp' AND label = 'B'`,
    [designId],
  );
  expect(Number(warpB!.weight_kg)).toBeCloseTo(4, 3);
  expect(Number(warpB!.percentage)).toBeCloseTo(40, 3);

  const weftA = await db.queryOne<{ weight_kg: string; percentage: string }>(
    `SELECT weight_kg, percentage FROM design_yarn_groups
     WHERE design_id = $1 AND section = 'weft' AND label = 'A'`,
    [designId],
  );
  expect(Number(weftA!.weight_kg)).toBeCloseTo(10, 3);
  expect(Number(weftA!.percentage)).toBeCloseTo(100, 3);

  // Scoped by THIS design's id, not shade_text alone — reruns of this spec
  // against a non-reset dev DB leave earlier iterations' own "Red Shade"
  // cells lying around (unique names avoid a colliding design row, but not a
  // colliding shade_text), and an unscoped query can silently pick up a
  // stale one instead of the row this run just created.
  const mappedCell = await db.queryOne<{ id: string; sku_id: string }>(
    `SELECT dsc.id, dsc.sku_id FROM design_shade_cells dsc
     JOIN design_yarn_groups dyg ON dyg.id = dsc.group_id
     WHERE dyg.design_id = $1 AND dsc.shade_text = 'Red Shade'`,
    [designId],
  );
  expect(mappedCell, 'the "Red Shade" cell must exist').not.toBeNull();
  expect(mappedCell!.sku_id).toBe(skus!.red_id);

  // ── LIST — new design appears; follow its row into the detail page (no
  // edit route exists — columns.tsx renders a "View" link to /designs/:id).
  await gotoAndExpect(page, '/designs');
  await page.getByRole('row', { name }).getByRole('link', { name: 'View' }).click();
  await expect(page).toHaveURL(/\/designs\/[^/]+$/);

  // ── DETAIL — design-detail.page.tsx renders PageHeader title=name,
  // subtitle=code, an attributes block, warp/weft group tables, and the
  // colour-way grid with "name (code)" SKU labels + an "unmapped" badge for
  // every cell with no SKU.
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText(/^DSN-\d{3,}$/)).toBeVisible();

  await expect(page.locator('[aria-label="sheet attributes"]')).toBeVisible();

  // getByRole('row', {name}) matches by the WHOLE row's accessible name with
  // Playwright's default case-insensitive substring rule — "A" would also
  // match the header row (its "Rate" column contains a lowercase "a"). Scope
  // to actual body rows and require an EXACT match on the row's own Label
  // cell instead.
  const warpTable = page.locator('[aria-label="Warp groups"]');
  await expect(warpTable).toBeVisible();
  const warpRowA = warpTable
    .locator('tbody tr')
    .filter({ has: page.getByRole('cell', { name: 'A', exact: true }) });
  const warpRowB = warpTable
    .locator('tbody tr')
    .filter({ has: page.getByRole('cell', { name: 'B', exact: true }) });
  await expect(warpRowA).toContainText('6');
  await expect(warpRowB).toContainText('4');

  const weftTable = page.locator('[aria-label="Weft groups"]');
  await expect(weftTable).toBeVisible();
  const weftRowA = weftTable
    .locator('tbody tr')
    .filter({ has: page.getByRole('cell', { name: 'A', exact: true }) });
  await expect(weftRowA).toContainText('10');

  await expect(page.locator('[aria-label="colour-way grid"]')).toBeVisible();
  // Two elements legitimately render "RED (SKU-001)" for a mapped, canManage
  // cell: the read-only <span> label AND the D9 ShadeCellEditor combobox's
  // own displayed value (design-detail.page.tsx's ColourwayGrid renders both
  // side by side for owner/storekeeper) — .first() picks either, both prove
  // the label is showing.
  await expect(page.getByText(`${skus!.red_name} (${skus!.red_code})`).first()).toBeVisible();
  await expect(page.getByText('unmapped').first()).toBeVisible();

  // ── D9 — mapping-correction affordance: re-map "Red Shade" from RED to
  // BLUE via the detail page's own ShadeCellEditor (owner/storekeeper only —
  // this session is authed as owner), then confirm the new SKU renders and
  // persists (usePatchShadeCell has no success toast, only a query
  // invalidation — the UI updating IS the observable success signal here).
  await selectByAriaLabel(
    page,
    'edit mapping for Red Shade',
    `${blueSku!.name} (${blueSku!.code})`,
  );
  await expect(page.getByText(`${blueSku!.name} (${blueSku!.code})`).first()).toBeVisible();

  const remappedCell = await db.queryOne<{ sku_id: string }>(
    `SELECT sku_id FROM design_shade_cells WHERE id = $1`,
    [mappedCell!.id],
  );
  expect(remappedCell!.sku_id).toBe(blueSku!.id);

  // ── STATUS — retire the design; Badge flips to "Inactive", persisted.
  await clickButton(page, 'Retire design');
  await expectToast(page, 'Design retired');
  await expect(page.getByText('Inactive')).toBeVisible();

  const statusRow = await db.queryOne<{ status: string }>(
    `SELECT status FROM designs WHERE id = $1`,
    [designId],
  );
  expect(statusRow!.status).toBe('inactive');
});

// v2's createDesignSchema hard-requires >= 1 warp group (invariant 1) — a
// design with zero groups must be blocked client-side, never reach the API.
test('creating a design with no groups is blocked by client-side validation', async ({ page }) => {
  await gotoAndExpect(page, '/designs/new');
  await fillByLabel(page, 'design name', codes.designCode());

  // No "Add warp/weft group" clicks at all — groups stays [] (colourways
  // still has its default "Colour-way 1", shadeCells stays [] too, which
  // independently violates its own min(1) — either error surfacing is
  // sufficient proof the submit was blocked).
  await clickButton(page, 'Create design');

  // Still on the create page — no navigation to a new /designs/:id happened.
  await expect(page).toHaveURL(/\/designs\/new$/);
  // At least one field-error region rendered (the `data-field-error` marker
  // this repo's transactional forms use for every surfaced validation issue).
  await expect(page.locator('[data-field-error]').first()).toBeVisible();
});
