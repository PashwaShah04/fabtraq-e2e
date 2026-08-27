import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';

// Grouped beam rollups on the hub's Beams tab (Inventory Rewoven Phase 2b,
// spec §6.4 / R9). The oracle is the beams table itself: one group per design,
// cancelled excluded, plus the "No design" bucket for purchase-origin beams
// (legitimate roots, R9 — never a blank label).
//
// SEED REALITY, stated up front because it bounds what these tests prove: a
// freshly seeded fabtraq_dev holds 4 beams, ALL with `design_id IS NULL` and
// `colourway_id IS NULL`, all `received`, none cancelled. So:
//
//   - the DESIGN-LINKED grouping path has NO live coverage here. The drill
//     test below exercises the full depth through the `no-design` bucket
//     instead of skipping (which is what the brief's draft did, leaving the
//     beam drill with zero live coverage at all) — but a design group that
//     resolves its NAME is exercised only by the unit tests, whose MSW
//     fixture is design-bearing on purpose.
//   - the cancelled-exclusion filter is UNFALSIFIABLE on this seed: with zero
//     cancelled rows the `status <> 'cancelled'` clause is a no-op on both
//     sides of the assertion. Annotated per run rather than passing silently.
//
// Not touched, deliberately: `mockBeamsGrouped`'s empty `colourway.beams[]`
// arrays diverge from the live endpoint's populated ones (Task 13). Nothing
// here — and nothing in the drill, whose deepest level reads `statusCounts` —
// consumes that array, so the mock stays as it is.

interface DesignRollup {
  design_name: string | null;
  beam_count: string;
  net_weight_kg: string;
  colourways: string;
}

/** Mirrors `beam-drill.ts`'s `kgLabel`. */
const kgLabel = (kg: number): string =>
  `${kg.toLocaleString('en-US', { maximumFractionDigits: 3 })} KG`;

const NO_DESIGN = 'no-design';

const DESIGN_ROLLUPS = `
  SELECT d.name AS design_name,
         COUNT(*)::text AS beam_count,
         SUM(b.net_weight)::text AS net_weight_kg,
         COUNT(DISTINCT COALESCE(bri.colourway_id::text, '${NO_DESIGN}'))::text AS colourways
    FROM beams b
    JOIN beam_receipt_items bri ON bri.id = b.beam_receipt_item_id
    LEFT JOIN designs d ON d.id = bri.design_id
   WHERE b.status <> 'cancelled'
   GROUP BY bri.design_id, d.name
   ORDER BY d.name NULLS LAST`;

test('the beams tab rolls beams up by design with a kg subtotal, excluding cancelled', async ({
  page,
  db,
}) => {
  const rollups = await db.queryMany<DesignRollup>(DESIGN_ROLLUPS);
  expect(rollups.length, 'seed must provide non-cancelled beams').toBeGreaterThan(0);

  const cancelled = await db.queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM beams WHERE status = 'cancelled'`,
  );
  if (Number(cancelled?.n ?? '0') === 0) {
    test.info().annotations.push({
      type: 'skip',
      description:
        'no cancelled beams in the seed: the cancelled-exclusion filter is a no-op on both ' +
        'sides of this assertion and is therefore not exercised.',
    });
  }

  await gotoAndExpect(page, '/inventory?tab=beams');

  const panel = page.getByRole('tabpanel');
  // One bar per rollup — asserted as a COUNT so an extra or missing group reds,
  // which a per-rollup visibility loop alone would not catch.
  await expect(panel.getByRole('img')).toHaveCount(rollups.length);

  for (const rollup of rollups) {
    const label = rollup.design_name ?? 'No design';
    // The bar's accessible name is `${label}: ${kgLabel}` — the D7 kg subtotal
    // rendered verbatim in place of the summed count. Asserted against the
    // ledger's own SUM(net_weight), not a literal.
    await expect(
      panel.getByLabel(`${label}: ${kgLabel(Number(rollup.net_weight_kg))}`, { exact: true }),
    ).toBeVisible();
  }
});

test('drilling a design opens its colour-ways, and the status level is terminal', async ({
  page,
  db,
}) => {
  const rollups = await db.queryMany<DesignRollup>(DESIGN_ROLLUPS);
  const target = rollups[0];
  expect(target, 'seed must provide at least one beam group').toBeDefined();
  if (target === undefined) return;

  // `beamDrillView` keys a null design as the literal `no-design`; a design
  // group keys on its own id.
  const designKey = await db.queryOne<{ key: string }>(
    `SELECT COALESCE(bri.design_id::text, '${NO_DESIGN}') AS key
       FROM beams b
       JOIN beam_receipt_items bri ON bri.id = b.beam_receipt_item_id
       LEFT JOIN designs d ON d.id = bri.design_id
      WHERE b.status <> 'cancelled'
      GROUP BY bri.design_id, d.name
      ORDER BY d.name NULLS LAST
      LIMIT 1`,
  );
  expect(designKey).not.toBeNull();
  if (designKey === null) return;

  if (designKey.key === NO_DESIGN) {
    test.info().annotations.push({
      type: 'skip',
      description:
        'the seed has no design-linked beams, so this drill runs through the No-design bucket. ' +
        'The design-NAME crumb and a design-id drill value are not exercised live.',
    });
  }

  await gotoAndExpect(page, '/inventory?tab=beams');
  const panel = page.getByRole('tabpanel');
  const crumb = panel.locator('[data-drill-crumb]');
  const designLabel = target.design_name ?? 'No design';

  // ---- Level 0 → 1: design → colour-ways --------------------------------
  await panel.locator(`[data-chart-segment^="${designKey.key}:"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`drill=design%3A${designKey.key}`));
  await expect(crumb.last()).toContainText(designLabel);
  // Colour-way bars: one per distinct colourway in this design group.
  await expect(panel.getByRole('img')).toHaveCount(Number(target.colourways));

  // ---- Level 1 → 2: colour-way → status ---------------------------------
  const colourwayKey = await db.queryOne<{ key: string; name: string | null }>(
    `SELECT COALESCE(bri.colourway_id::text, '${NO_DESIGN}') AS key, dc.name
       FROM beams b
       JOIN beam_receipt_items bri ON bri.id = b.beam_receipt_item_id
       LEFT JOIN design_colourways dc ON dc.id = bri.colourway_id
      WHERE b.status <> 'cancelled'
        AND COALESCE(bri.design_id::text, '${NO_DESIGN}') = $1
      GROUP BY bri.colourway_id, dc.name
      ORDER BY dc.name NULLS LAST
      LIMIT 1`,
    [designKey.key],
  );
  expect(colourwayKey).not.toBeNull();
  if (colourwayKey === null) return;

  await panel.locator(`[data-chart-segment^="${colourwayKey.key}:"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`%2Fcolourway%3A${colourwayKey.key}`));
  await expect(crumb.last()).toContainText(colourwayKey.name ?? 'No colour-way');

  // Status is the LEAF: segments render as <span>, not <button>, so there is
  // nothing further to click. All three are asserted by count, never by
  // visibility — an all-`received` seed leaves two of them at width 0%, and a
  // zero-width flex child has no bounding box for Playwright to see.
  await expect(panel.locator('button[data-chart-segment]')).toHaveCount(0);
  await expect(panel.locator('span[data-chart-segment]')).toHaveCount(3);

  // Back to the top clears the whole drill.
  await panel.locator('[data-drill-crumb="0"]').click();
  await expect(page).not.toHaveURL(/drill=/);
});

test('purchase-origin beams land in the No-design bucket, not a blank label', async ({
  page,
  db,
}) => {
  const orphans = await db.queryOne<{ n: string; kg: string }>(
    `SELECT COUNT(*)::text AS n, SUM(b.net_weight)::text AS kg
       FROM beams b
       JOIN beam_receipt_items bri ON bri.id = b.beam_receipt_item_id
      WHERE b.status <> 'cancelled' AND bri.design_id IS NULL`,
  );
  test.skip(Number(orphans?.n ?? '0') === 0, 'seed has no design-less beams');
  if (orphans === null) return;

  await gotoAndExpect(page, '/inventory?tab=beams');
  const panel = page.getByRole('tabpanel');

  // The property under test is that a NULL design renders as the words "No
  // design" and keys as the `no-design` token — not as an empty string that
  // would produce a nameless bar and a `?drill=design:` the codec drops.
  await expect(
    panel.getByLabel(`No design: ${kgLabel(Number(orphans.kg))}`, { exact: true }),
  ).toBeVisible();
  await expect(
    panel.locator(`[data-chart-segment^="${NO_DESIGN}:"]`),
    'the No-design bar must key on the token',
  ).not.toHaveCount(0);
  // A blank key would emit `:<segment>`, which `decodeDrill` discards
  // (`separator <= 0`) — the drill would then silently do nothing.
  await expect(panel.locator('[data-chart-segment^=":"]')).toHaveCount(0);
});
