import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';

// Grouped beam rollups on the hub's Beams tab (Inventory Rewoven Phase 2b,
// spec §6.4 / R9). The oracle is the beams table itself: one group per design,
// cancelled excluded, plus the "No design" bucket for purchase-origin beams
// (legitimate roots, R9 — never a blank label).
//
// THE BARS MEASURE BEAM COUNT, NOT KG. `StackedBar` is given
// `unitLabel="beams"` and each segment's `value` is `colourway.count`; the D7
// kg subtotal rides ALONGSIDE on `totalLabel`, which is why the bar's
// accessible name reads in kg while its width reads in beams. Both axes are
// asserted here — the kg subtotal through the bar's aria-label, the count
// through each segment's `title` (StackedBar.tsx:88, set on the <button> and
// the <span> branch alike).
//
// SEED REALITY, stated up front because it bounds what these tests prove. A
// freshly seeded fabtraq_dev holds FIVE beams: four live and one cancelled
// (BEAM-C-004). Two of the live ones (BEAM-C-002/003) link design DSN-001 on
// two DIFFERENT colour-ways; the other two carry no design at all. So there are
// two design groups — `SEED-DESIGN-V2` (2 colour-ways) and `No design` (1) —
// and every count assertion below is 2-versus-2 or 2-versus-1 rather than the
// 1-versus-1 it used to be. Concretely, that seed shape is what makes these
// falsifiable:
//
//   - `groups.slice(0, 1)` and `colourways.slice(0, 1)` in `beamDrillView` both
//     RED the bar-count assertions. With one group each they were no-ops.
//   - the `status <> 'cancelled'` filter is a real filter: dropping it on the
//     application side (`prisma-beam.repository.ts` `findGrouped`) pulls
//     BEAM-C-004 into the No-design bucket and reds the design rollup.
//   - the drill runs through a NAMED design, so the design-name crumb and a
//     UUID drill value are exercised live.
//
// Still unfalsifiable here, and annotated per run rather than passing silently:
// every live beam is `received`, so `issued_to_weaver` and `fabric_received`
// hold nothing. Since `StackedBar` drops zero-value segments, they are asserted
// ABSENT from the bar and PRESENT in the legend — a swap between those two
// empty buckets would still not be caught.
//
// Not touched, deliberately: `mockBeamsGrouped`'s empty `colourway.beams[]`
// arrays diverge from the live endpoint's populated ones (Task 13). Nothing
// here — and nothing in the drill, whose deepest level reads `statusCounts` —
// consumes that array, so the mock stays as it is.

/**
 * One row per (design, colour-way) bucket — the finest grain the chart draws.
 * The design level is rolled up from these in the spec rather than by a second
 * query, so the two levels cannot disagree about what a group holds.
 */
interface GroupRow {
  design_key: string;
  design_name: string | null;
  colourway_key: string;
  colourway_name: string | null;
  beam_count: string;
  net_weight_kg: string;
  received: string;
  issued_to_weaver: string;
  fabric_received: string;
}

interface DesignRollup {
  key: string;
  label: string;
  netWeightKg: number;
  colourways: GroupRow[];
}

/** Mirrors `beam-drill.ts`'s `kgLabel`. */
const kgLabel = (kg: number): string =>
  `${kg.toLocaleString('en-US', { maximumFractionDigits: 3 })} KG`;

/** Mirrors StackedBar's segment value formatting. */
const num = (n: number): string => n.toLocaleString('en-US');

// `beam-drill.ts` reuses ONE sentinel for a null design AND a null colour-way
// (`colourway.colourwayId ?? NO_DESIGN`), so the oracle does too — a distinct
// NO_COLOURWAY token here would key differently from the code under test.
const NO_DESIGN = 'no-design';

/**
 * The beam pipeline stages, in `beam-drill.ts`'s `STATUS_SEGMENTS` order. Order
 * matters here: these are ordinal stages sharing one lightness ramp, so a
 * reordering changes what the chart says and the legend must keep declaring
 * all three regardless of counts.
 */
const STATUS_KEYS = ['received', 'issued_to_weaver', 'fabric_received'] as const;

/**
 * `StackedBar` renders only `value > 0` segments. Which stages a colour-way
 * actually holds is therefore the DOM's segment count — derived from the DB
 * row, never hard-coded, so the assertion tracks the seed instead of pinning a
 * literal that a seed change silently invalidates.
 */
const presentStatuses = (c: GroupRow): readonly string[] =>
  STATUS_KEYS.filter((k) => Number(c[k]) > 0);

const absentStatuses = (c: GroupRow): readonly string[] =>
  STATUS_KEYS.filter((k) => Number(c[k]) === 0);

const GROUP_ROLLUPS = `
  SELECT COALESCE(bri.design_id::text, '${NO_DESIGN}') AS design_key,
         d.name AS design_name,
         COALESCE(bri.colourway_id::text, '${NO_DESIGN}') AS colourway_key,
         dc.name AS colourway_name,
         COUNT(*)::text AS beam_count,
         SUM(b.net_weight)::text AS net_weight_kg,
         COUNT(*) FILTER (WHERE b.status = 'received')::text AS received,
         COUNT(*) FILTER (WHERE b.status = 'issued_to_weaver')::text AS issued_to_weaver,
         COUNT(*) FILTER (WHERE b.status = 'fabric_received')::text AS fabric_received
    FROM beams b
    JOIN beam_receipt_items bri ON bri.id = b.beam_receipt_item_id
    LEFT JOIN designs d ON d.id = bri.design_id
    LEFT JOIN design_colourways dc ON dc.id = bri.colourway_id
   WHERE b.status <> 'cancelled'
   GROUP BY bri.design_id, d.name, bri.colourway_id, dc.name
   ORDER BY d.name NULLS LAST, dc.name NULLS LAST`;

/** Rolls the buckets up by design, preserving the SQL's name-NULLS-LAST order. */
function byDesign(rows: readonly GroupRow[]): DesignRollup[] {
  const designs = new Map<string, DesignRollup>();
  for (const row of rows) {
    const design = designs.get(row.design_key) ?? {
      key: row.design_key,
      label: row.design_name ?? 'No design',
      netWeightKg: 0,
      colourways: [],
    };
    design.netWeightKg += Number(row.net_weight_kg);
    design.colourways.push(row);
    designs.set(row.design_key, design);
  }
  return [...designs.values()];
}

const colourwayLabel = (row: GroupRow): string => row.colourway_name ?? 'No colour-way';

function maxBy<T>(values: readonly T[], score: (value: T) => number): T | undefined {
  return values.length === 0 ? undefined : values.reduce((a, b) => (score(b) > score(a) ? b : a));
}

/**
 * The status bucket holding the most beams. Click targets are derived, never
 * `.first()` (D4): `pushDrill` passes the ROW key so the choice cannot change
 * the outcome, but a 1-of-N bucket can be a few pixels wide at a position this
 * spec does not control.
 */
function widestStatus(row: GroupRow): string {
  const buckets = [
    ['received', Number(row.received)],
    ['issued_to_weaver', Number(row.issued_to_weaver)],
    ['fabric_received', Number(row.fabric_received)],
  ] as const;
  return (maxBy(buckets, ([, n]) => n) ?? buckets[0])[0];
}

test('the beams tab rolls beams up by design with a kg subtotal, excluding cancelled', async ({
  page,
  db,
}) => {
  const designs = byDesign(await db.queryMany<GroupRow>(GROUP_ROLLUPS));
  expect(designs.length, 'seed must provide non-cancelled beams').toBeGreaterThan(0);

  const cancelled = await db.queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM beams WHERE status = 'cancelled'`,
  );
  if (Number(cancelled?.n ?? '0') === 0) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'no cancelled beams in the seed: the cancelled-exclusion filter is a no-op on both ' +
        'sides of this assertion and is therefore not exercised.',
    });
  }
  if (designs.length === 1) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'one design group on this seed, so the bar COUNT below is 1-versus-1: a view rendering ' +
        'only the first design would pass it. The per-colour-way counts and the kg subtotal are ' +
        'still asserted by value.',
    });
  }

  await gotoAndExpect(page, '/inventory?tab=beams');

  const panel = page.getByRole('tabpanel');
  // One bar per rollup — asserted as a COUNT so an extra or missing group reds,
  // which a per-rollup visibility loop alone would not catch.
  await expect(panel.getByRole('img')).toHaveCount(designs.length);

  for (const [index, design] of designs.entries()) {
    // The bar's accessible name is `${label}: ${kgLabel}` — the D7 kg subtotal
    // rendered verbatim in place of the summed count. Asserted against the
    // ledger's own SUM(net_weight), not a literal.
    //
    // Located by INDEX and asserted with toHaveAccessibleName rather than
    // looked up with getByLabel(name): a wrong subtotal must red with an
    // Expected/Received value, not with a locator that stops resolving. That
    // matters for the cancelled-exclusion mutant specifically — dropping the
    // filter changes this bar's kg, and a getByLabel would have died on
    // "element(s) not found", which says nothing about WHICH number moved.
    // The order is safe: BeamService sorts designs by name with the null bucket
    // last (`byNameNullsLast`), byte-for-byte what GROUP_ROLLUPS orders by.
    // Declared limit on that claim: the two sorts are INDEPENDENT — Postgres
    // collation on one side, `localeCompare` on the other — and with exactly
    // one NAMED design only the null-bucket half of the rule is exercised. A
    // second named design would exercise the comparison itself.
    await expect(panel.getByRole('img').nth(index)).toHaveAccessibleName(
      `${design.label}: ${kgLabel(design.netWeightKg)}`,
    );

    // The axis the bar actually DRAWS, which the kg accessible name says
    // nothing about: each segment is one colour-way and its value is that
    // colour-way's beam COUNT. The segment `title` is the only place that
    // number is rendered.
    for (const colourway of design.colourways) {
      await expect(
        panel.locator(`[data-chart-segment="${design.key}:${colourway.colourway_key}"]`),
        `beam count for ${design.label} / ${colourwayLabel(colourway)}`,
      ).toHaveAttribute(
        'title',
        `${colourwayLabel(colourway)}: ${num(Number(colourway.beam_count))} beams`,
      );
    }
  }
});

test('drilling a design opens its colour-ways, and the status level is terminal', async ({
  page,
  db,
}) => {
  const designs = byDesign(await db.queryMany<GroupRow>(GROUP_ROLLUPS));
  const target = designs[0];
  expect(target, 'seed must provide at least one beam group').toBeDefined();
  if (target === undefined) return;
  const colourway = maxBy(target.colourways, (c) => Number(c.beam_count));
  expect(colourway, 'a design group must hold at least one colour-way').toBeDefined();
  if (colourway === undefined) return;

  // `beamDrillView` keys a null design as the literal `no-design`; a design
  // group keys on its own id.
  if (target.key === NO_DESIGN) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'the seed has no design-linked beams, so this drill runs through the No-design bucket. ' +
        'The design-NAME crumb and a design-id drill value are not exercised live.',
    });
  }
  if (target.colourways.length === 1) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'this design holds one colour-way, so the colour-way bar COUNT is 1-versus-1: a view ' +
        'rendering only the first colour-way would pass it.',
    });
  }

  await gotoAndExpect(page, '/inventory?tab=beams');
  const panel = page.getByRole('tabpanel');
  const crumb = panel.locator('[data-drill-crumb]');

  // ---- Level 0 → 1: design → colour-ways --------------------------------
  await panel.locator(`[data-chart-segment="${target.key}:${colourway.colourway_key}"]`).click();
  await expect(page).toHaveURL(new RegExp(`drill=design%3A${target.key}`));
  await expect(crumb.last()).toContainText(target.label);
  // Colour-way bars: one per distinct colourway in this design group.
  await expect(panel.getByRole('img')).toHaveCount(target.colourways.length);

  // ---- Level 1 → 2: colour-way → status ---------------------------------
  await panel
    .locator(`[data-chart-segment="${colourway.colourway_key}:${widestStatus(colourway)}"]`)
    .click();
  await expect(page).toHaveURL(new RegExp(`%2Fcolourway%3A${colourway.colourway_key}`));
  await expect(crumb.last()).toContainText(colourwayLabel(colourway));

  // Status is the LEAF: segments render as <span>, not <button>, so there is
  // nothing further to click.
  //
  // `StackedBar` drops zero-value segments outright (it gives every surviving
  // segment `min-w-[2px]`, so a zero would otherwise draw a tick claiming beams
  // that do not exist). The count is therefore the number of statuses this
  // colour-way actually holds — read from the DB, never hard-coded — and the
  // empty ones are asserted ABSENT. Asserting a flat 3 encoded the old
  // render-all-then-zero-width behaviour and would now be red for the right
  // reason; asserting only the survivors would let a vanished segment pass.
  //
  // Identity does not go missing with them: the legend names all three stages
  // whatever the counts are, which is the whole reason it exists.
  await expect(panel.locator('button[data-chart-segment]')).toHaveCount(0);
  await expect(panel.locator('span[data-chart-segment]')).toHaveCount(
    presentStatuses(colourway).length,
  );
  for (const key of absentStatuses(colourway)) {
    await expect(
      panel.locator(`span[data-chart-segment="${colourway.colourway_key}:${key}"]`),
      `${key} holds no beams and must not draw a segment`,
    ).toHaveCount(0);
  }
  await expect(panel.locator('[data-chart-legend] li')).toHaveCount(STATUS_KEYS.length);

  // Back to the top clears the whole drill.
  await panel.locator('[data-drill-crumb="0"]').click();
  await expect(page).not.toHaveURL(/drill=/);
});

test('the terminal status level splits the colour-way by beam status', async ({ page, db }) => {
  const designs = byDesign(await db.queryMany<GroupRow>(GROUP_ROLLUPS));
  const target = designs[0];
  expect(target, 'seed must provide at least one beam group').toBeDefined();
  if (target === undefined) return;
  const colourway = maxBy(target.colourways, (c) => Number(c.beam_count));
  expect(colourway, 'a design group must hold at least one colour-way').toBeDefined();
  if (colourway === undefined) return;

  const statuses = [
    ['received', 'Received', Number(colourway.received)],
    ['issued_to_weaver', 'Issued to weaver', Number(colourway.issued_to_weaver)],
    ['fabric_received', 'Fabric received', Number(colourway.fabric_received)],
  ] as const;

  const zeroed = statuses.filter(([, , n]) => n === 0).map(([, label]) => label);
  if (zeroed.length > 0) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        `empty on this seed and therefore asserted at zero: ${zeroed.join(', ')}. A swap ` +
        'BETWEEN any two zero buckets would not be caught; only the non-zero ones falsify the ' +
        'statusCounts pick.',
    });
  }
  if (designs.length === 1 && target.colourways.length === 1) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'one design holding one colour-way, so the colour-way-scoped statusCounts and the ' +
        'design-scoped ones are the same numbers: a level reading the wrong group would pass.',
    });
  }

  // Reached by URL rather than by clicking down, deliberately — see the note in
  // the drill test above. This is what makes a wrong statusCounts pick die on a
  // TITLE MISMATCH instead of on a vanished click target.
  const drill = `design:${target.key}/colourway:${colourway.colourway_key}`;
  await gotoAndExpect(page, `/inventory?tab=beams&drill=${encodeURIComponent(drill)}`);

  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('button[data-chart-segment]')).toHaveCount(0);
  await expect(panel.locator('span[data-chart-segment]')).toHaveCount(
    presentStatuses(colourway).length,
  );

  // A zero-count status draws no segment (StackedBar drops them), so its title
  // cannot be asserted — assert its ABSENCE instead. The non-zero ones still
  // carry their value in the title, which is what falsifies a wrong
  // `statusCounts` pick.
  for (const [key, label, count] of statuses) {
    const segment = panel.locator(`span[data-chart-segment="${colourway.colourway_key}:${key}"]`);
    if (count === 0) {
      await expect(segment, `${label} is empty and must draw nothing`).toHaveCount(0);
      continue;
    }
    await expect(segment, `${label} count`).toHaveAttribute(
      'title',
      `${label}: ${num(count)} beams`,
    );
  }

  // Every stage keeps a legend entry whether or not it holds beams — a reader
  // must be able to tell "no beams issued to a weaver" from "this chart does
  // not track that stage".
  for (const [, label] of statuses) {
    await expect(panel.locator('[data-chart-legend]')).toContainText(label);
  }
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
