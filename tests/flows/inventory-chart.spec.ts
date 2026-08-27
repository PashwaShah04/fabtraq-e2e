import type { APIRequestContext } from '@playwright/test';

import { env } from '../../fixtures/env';
import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';

// Yarn drill chart (Inventory Rewoven Phase 2b, spec §6.3). Drills the full
// depth Quality → SKU → ProcessedType → Custody, walks back via the
// breadcrumb, and asserts the synced table narrows with the chart at every
// step.
//
// ORACLE — and why it is the summary ENDPOINT rather than `stock_ledger`.
// The property under test is SYNC, not arithmetic: `yarnDrillView` regroups,
// entirely client-side, the exact page of rows the hub already fetched. Two
// specs already pin that page against the raw ledger (inventory.spec.ts for
// the rows, inventory-hub.spec.ts for the band, both via
// support/ledger-positions.ts), so a third copy of that accumulation would
// add no signal.
//
// It would also be WRONG here. The hub fetches ONE PAGE (pageSize 25) and
// drills within it, so a ledger-wide oracle silently diverges from what the
// chart can see. That is not hypothetical: a full-suite run reaches this spec
// with stock other specs created, and the first version of this file — which
// summed the ledger and dropped null-SKU positions — passed on a fresh seed
// and failed at 11-vs-14 rows in the full run. The endpoint is queried with
// the page's own query, so the two cannot drift.
//
// UNITS ARE SEPARATE CHARTS (I1, spec R1). The hub renders one StackedBar per
// unit present at the current level — never one chart with a page-level unit
// literal — so every oracle here groups by (unit, dim) and reads the unit off
// the row. Bar keys are unchanged by that split (unit is an outer partition,
// not a drill dimension), so `data-chart-segment` selectors still name the
// drill value; they are scoped by `[data-chart-unit]` where a value could
// legitimately appear in more than one chart.
//
// TARGETS ARE DERIVED, NEVER "the first". Every clicked bar is chosen by an
// explicit key computed from the oracle:
//
//   - the drill target is the (quality, SKU) pair with the MOST processedType
//     groups, because that is the pair whose drill actually narrows the table;
//   - within a bar the MAX-value segment is clicked. `pushDrill` passes the
//     ROW key, so which segment is hit cannot change the outcome — but the
//     smallest group on the dev seed is 3 KG against a 620 KG bar (~0.4%, a
//     few pixels wide), and its position depends on a map insertion order this
//     spec does not control.

/** The hub's page size — `useHubParams`' default, and what the table renders. */
const PAGE_SIZE = 25;

/** Only the slice of `InventorySummaryRow` this spec regroups. */
interface SummaryRow {
  qualityId: string;
  qualityName: string;
  skuId: string | null;
  skuName: string | null;
  processedTypes: string[];
  unit: string;
  totalBalance: number;
  inHouseBalance: number;
  atJobWorkerBalance: number;
  awaitingPlacementBalance: number;
}

/**
 * `JOB_WORK_TYPE_LABELS` is plain Title Case of the value (shared
 * constants/job-work-types.ts). The e2e package has no dependency on shared,
 * so it is derived rather than copied — a copy would silently rot.
 */
function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Mirrors `yarnDrillView`'s `dimValue(row, 'processedType')`. */
function ptKey(row: SummaryRow): string {
  return row.processedTypes.length === 0 ? 'raw' : [...row.processedTypes].sort().join(',');
}

function ptLabels(row: SummaryRow): string[] {
  return row.processedTypes.length === 0 ? ['Raw'] : row.processedTypes.map(typeLabel);
}

/** Mirrors StackedBar's value formatting. */
const num = (n: number): string => n.toLocaleString('en-US');

function maxBy<T>(values: readonly T[], score: (value: T) => number): T {
  return values.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function sumOf(rows: readonly SummaryRow[], pick: (row: SummaryRow) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/** The page of rows the hub itself renders, fetched with the hub's own query. */
async function summaryRows(request: APIRequestContext): Promise<SummaryRow[]> {
  const res = await request.get(
    `${env.API_URL}/inventory/summary?page=1&pageSize=${String(PAGE_SIZE)}`,
  );
  expect(res.ok(), 'GET /inventory/summary must succeed').toBe(true);
  const body = (await res.json()) as { items: SummaryRow[] };
  expect(body.items.length, 'seed must provide stock items').toBeGreaterThan(0);
  return body.items;
}

test('drills quality → SKU → processed type → custody, keeping the table in sync', async ({
  page,
}) => {
  await gotoAndExpect(page, '/inventory');
  const items = await summaryRows(page.request);

  // The (quality, SKU) pair holding the most processedType groups: the only
  // pair whose SKU-level drill can narrow the table at all. Null-SKU groups
  // are counted in the oracle (they are real rows) but never targeted — they
  // drill under shared's NO_SHADE token, which this spec does not exercise.
  const bySku = new Map<string, SummaryRow[]>();
  for (const row of items) {
    if (row.skuId === null) continue;
    const key = `${row.qualityId}\x00${row.skuId}`;
    bySku.set(key, [...(bySku.get(key) ?? []), row]);
  }
  expect(bySku.size, 'seed must provide a SKU-bearing stock item').toBeGreaterThan(0);

  // Scored on DISTINCT processedType groups, not row count: two rows sharing
  // one processedType (different units) would give the deepest drill nothing
  // to narrow.
  const skuItems = maxBy([...bySku.values()], (group) => new Set(group.map(ptKey)).size);
  const target = skuItems[0];
  expect(target).toBeDefined();
  if (target === undefined || target.skuId === null) return;

  const qualityItems = items.filter((i) => i.qualityId === target.qualityId);
  const leafKey = ptKey(maxBy(skuItems.filter((i) => i.unit === target.unit), (i) => i.totalBalance));
  const leafRows = skuItems.filter((i) => ptKey(i) === leafKey);

  // Level 0's segments are SKUs; a null-SKU segment is skipped for the same
  // reason as above, and any segment of this bar drills to the same quality.
  // Segment keys are picked from the target's OWN unit chart — a bar in the
  // METER chart is not a click target inside the KG one.
  const topSkuKey = maxBy(
    qualityItems.filter((i) => i.skuId !== null && i.unit === target.unit),
    (i) => i.totalBalance,
  ).skuId;

  const panel = page.getByRole('tabpanel');
  const rows = panel.locator('tbody tr');
  const crumb = panel.locator('[data-drill-crumb]');
  // Every bar clicked below lives in the TARGET's unit chart. The synced-table
  // counts stay unscoped on purpose: the table is not partitioned by unit, it
  // renders every narrowed row.
  const unitChart = panel.locator(`[data-chart-unit="${target.unit}"]`);

  await expect(rows).toHaveCount(items.length);

  // ---- Level 0 → 1: quality --------------------------------------------
  await unitChart.locator(`[data-chart-segment="${target.qualityId}:${topSkuKey ?? ''}"]`).click();
  await expect(page).toHaveURL(new RegExp(`drill=quality%3A${target.qualityId}`));
  await expect(crumb.last()).toContainText(target.qualityName);
  await expect(rows).toHaveCount(qualityItems.length);

  if (qualityItems.length === items.length) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'quality level: every row on this page belongs to ONE quality, so the level-0 drill ' +
        'narrows nothing — the row count is asserted but the narrowing property is not ' +
        'exercised here. The SKU and processedType steps below are where this test has teeth.',
    });
  }

  // ---- Level 1 → 2: SKU -------------------------------------------------
  await unitChart.locator(`[data-chart-segment="${target.skuId}:${leafKey}"]`).click();
  await expect(page).toHaveURL(new RegExp(`drill=quality%3A[^&]*%2Fsku%3A${target.skuId}`));
  await expect(crumb.last()).toContainText(target.skuName ?? '');
  await expect(rows).toHaveCount(skuItems.length);
  if (skuItems.length === qualityItems.length) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'SKU level: this quality holds exactly one SKU on this page, so the level-1 drill ' +
        'narrows nothing — the row count is asserted but the narrowing property is not exercised.',
    });
  }

  // ---- Level 2 → 3: processed type --------------------------------------
  await unitChart.locator(`[data-chart-segment="${leafKey}:${leafKey}"]`).click();
  // A multi-type key is comma-joined, and both URLSearchParams and
  // encodeURIComponent spell that `%2C` — the two agree for the [a-z,]
  // alphabet JobWorkType uses.
  await expect(page).toHaveURL(new RegExp(`%2FprocessedType%3A${encodeURIComponent(leafKey)}`));
  for (const label of ptLabels(leafRows[0] ?? target)) {
    await expect(crumb.last()).toContainText(label);
  }
  await expect(rows).toHaveCount(leafRows.length);
  if (leafRows.length === skuItems.length) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'processedType level: this SKU holds one processedType group on this page, so the ' +
        'level-2 drill narrows nothing — the narrowing property is not exercised.',
    });
  }

  // ---- Level 3: custody is TERMINAL -------------------------------------
  // Segments render as <span> rather than <button> when no `onSegmentActivate`
  // is passed (StackedBar), which is how "drilling further would empty the
  // table" is enforced. Counted, never asserted visible: an all-in-house
  // position leaves two of the three at width 0%, and a zero-width flex child
  // has no bounding box for Playwright to see.
  await expect(panel.locator('button[data-chart-segment]')).toHaveCount(0);

  // ONE custody bar PER UNIT (I1): the custody split sums three balance fields,
  // and summing them across units would add kilograms to metres. The unit set
  // is READ from the leaf rather than assumed single — a KG-only leaf gives 3
  // segments, a mixed one gives 3 per unit, and each is asserted inside its own
  // `[data-chart-unit]` chart with the sum of THAT unit's rows only.
  const leafUnits = [...new Set(leafRows.map((r) => r.unit))];
  await expect(panel.locator('span[data-chart-segment]')).toHaveCount(3 * leafUnits.length);

  const custody = [
    ['in_house', 'In-house', (r: SummaryRow) => r.inHouseBalance],
    ['at_jw', 'At JW', (r: SummaryRow) => r.atJobWorkerBalance],
    ['unplaced', 'Unplaced', (r: SummaryRow) => r.awaitingPlacementBalance],
  ] as const;
  for (const unit of leafUnits) {
    const unitLeafRows = leafRows.filter((r) => r.unit === unit);
    for (const [key, label, pick] of custody) {
      await expect(
        panel.locator(`[data-chart-unit="${unit}"] span[data-chart-segment="custody:${key}"]`),
      ).toHaveAttribute('title', `${label}: ${num(sumOf(unitLeafRows, pick))} ${unit}`);
    }
  }
  if (leafUnits.length === 1) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'the drilled leaf holds ONE unit, so the per-unit custody partition is 1-versus-1 here: ' +
        'a custody bar summing across units would render identically. The FE unit test ' +
        '"never sums the custody buckets across units" (yarn-drill.test.ts) pins that on a ' +
        'mixed-unit quality; closing it live needs a seeded METER yarn quality.',
    });
  }
  if (
    sumOf(leafRows, (r) => r.atJobWorkerBalance) === 0 &&
    sumOf(leafRows, (r) => r.awaitingPlacementBalance) === 0
  ) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'custody level: the drilled position is fully in-house, so the At-JW and Unplaced ' +
        'segments are asserted at zero — a swap between those two buckets would not be caught. ' +
        'The In-house segment is equally undecided: with nothing at a job worker and nothing ' +
        'awaiting placement, inHouseBalance and totalBalance coincide, so a bar reading ' +
        'totalBalance instead of inHouseBalance passes this assertion too. All three need a ' +
        'seed row, not a spec change.',
    });
  }

  // ---- Breadcrumb back ---------------------------------------------------
  // Depth 2 is the SKU crumb; the deepest crumb is a <span>, not a button.
  await panel.locator('[data-drill-crumb="2"]').click();
  await expect(page).not.toHaveURL(/processedType%3A/);
  await expect(rows).toHaveCount(skuItems.length);

  await panel.locator('[data-drill-crumb="0"]').click();
  await expect(page).not.toHaveURL(/drill=/);
  await expect(rows).toHaveCount(items.length);
});

/**
 * The bar total the way `StackedBar` computes it: per-SKU segment sums, then a
 * sum of those. Mirroring the association rather than summing the rows flat
 * keeps float addition byte-identical to the rendered string.
 */
function barTotal(rows: readonly SummaryRow[], pick: (row: SummaryRow) => number): number {
  const bySku = new Map<string, number>();
  for (const row of rows) {
    const key = row.skuId ?? 'no-shade';
    bySku.set(key, (bySku.get(key) ?? 0) + pick(row));
  }
  return [...bySku.values()].reduce((sum, value) => sum + value, 0);
}

test('custody chips re-slice the level-0 bars and vanish once drilled', async ({ page }) => {
  // Task 17's R3 chips (spec §5.4): a level-0 FILTER held in local component
  // state — never a drill step, never a crumb, never the table. Both halves of
  // that ruling are asserted here: the bars re-slice by custody bucket, and the
  // chips are UNMOUNTED (not merely disabled) the moment a drill step exists.
  await gotoAndExpect(page, '/inventory');
  const items = await summaryRows(page.request);

  // One bar group per (unit, quality) — the chart's own grain since I1. Built
  // in a SINGLE pass so the order mirrors `yarnDrillView`: charts appear in
  // the order each unit first appears in the summary page, and bars within a
  // chart in the order each quality first appears within that unit.
  const byUnit = new Map<string, Map<string, SummaryRow[]>>();
  for (const row of items) {
    const byQualityInUnit = byUnit.get(row.unit) ?? new Map<string, SummaryRow[]>();
    byUnit.set(row.unit, byQualityInUnit);
    byQualityInUnit.set(row.qualityId, [...(byQualityInUnit.get(row.qualityId) ?? []), row]);
  }
  const barGroups = [...byUnit.entries()].flatMap(([unit, byQualityInUnit]) =>
    [...byQualityInUnit.values()].map((rows) => ({ unit, rows })),
  );

  const panel = page.getByRole('tabpanel');
  // The chips are the only `aria-pressed` buttons inside a tabpanel: the other
  // user of that attribute on this page is PipelineBand, whose stage cards sit
  // above <Tabs> and so outside every panel. Counting them is what
  // distinguishes "unmounted" from "rendered but disabled".
  const chips = panel.locator('button[aria-pressed]');
  const chip = (name: string) => panel.getByRole('button', { name, exact: true });

  // Bars are located by INDEX and asserted with toHaveAccessibleName rather
  // than looked up by name: a chip reading the wrong custody field must red on
  // an Expected/Received value, not on a locator that stops resolving. The
  // order is safe — `yarnDrillView` partitions by unit and then groups by
  // quality, both in the order the summary page returns rows, which is the
  // order `barGroups` is built in. The count assertion is the yarn half of
  // review Minor 5: nothing else here pins how MANY bars the chart draws.
  //
  // THE UNIT COMES OFF THE ROW (I1). It used to be the literal `KG`, which
  // agreed with the page only because the page hardcoded `KG` too and the seed
  // holds no metered yarn — the ledger filed that agreement as a landmine at
  // Task 18 (Minor 3) and predicted this exact edit.
  async function expectBars(pick: (row: SummaryRow) => number): Promise<void> {
    const bars = panel.getByRole('img');
    await expect(bars).toHaveCount(barGroups.length);
    let index = 0;
    for (const { unit, rows } of barGroups) {
      await expect(bars.nth(index)).toHaveAccessibleName(
        `${rows[0]?.qualityName ?? ''}: ${num(barTotal(rows, pick))} ${unit}`,
      );
      index += 1;
    }
  }

  await expect(chips).toHaveCount(3);
  await expectBars((r) => r.totalBalance);

  // Declared rather than left to be found: the bar-COUNT assertion inside
  // expectBars is 1-versus-1 while one quality holds all the stock, so it
  // cannot tell "the right number of bars" from "one bar" — the same shape as
  // the beams I1 gap the seed rows were dispatched to close, reintroduced by
  // the fix for it. Closing it needs a SECOND QUALITY in the seed, not a spec
  // change. The per-bar VALUE assertions below have teeth either way.
  if (barGroups.length === 1) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'one (unit, quality) group on this page, so expectBars\' bar COUNT is 1-versus-1: a ' +
        'chart rendering only the first bar would pass it. Needs a second seeded quality or a ' +
        'second unit.',
    });
  }
  // At JW is zero across the board, so a swap of the at-JW field to any other
  // always-zero source still survives (M7 dies only because at-JW now differs
  // from Unplaced). Stated here because the seed dispatch chose unplaced stock
  // over an at-JW position deliberately; this is the residual it leaves.
  if (barGroups.every(({ rows }) => barTotal(rows, (r) => r.atJobWorkerBalance) === 0)) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'nothing sits at a job worker, so At JW is asserted at zero everywhere: a swap to any ' +
        'other always-zero source would pass.',
    });
  }

  // At JW is the discriminating chip on this seed: nothing sits at a job
  // worker, so every bar must collapse. In-house alone would be
  // indistinguishable from no filter at all.
  const atJwIsTotal = barGroups.every(
    ({ rows }) =>
      barTotal(rows, (r) => r.atJobWorkerBalance) === barTotal(rows, (r) => r.totalBalance),
  );
  if (atJwIsTotal) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'every quality holds the same balance at a job worker as in total, so the At-JW ' +
        're-slice below cannot be told apart from no filter at all.',
    });
  }
  // Was an UNCONDITIONAL annotation asserting the seed is fully in-house. It
  // stopped being true the moment the seed gained awaiting-placement stock, so
  // it is computed from the data now: an annotation that describes a shape the
  // database no longer has is worse than none.
  const inHouseIsTotal = barGroups.every(
    ({ rows }) => barTotal(rows, (r) => r.inHouseBalance) === barTotal(rows, (r) => r.totalBalance),
  );
  const atJwIsUnplaced = barGroups.every(
    ({ rows }) =>
      barTotal(rows, (r) => r.atJobWorkerBalance) ===
      barTotal(rows, (r) => r.awaitingPlacementBalance),
  );
  if (inHouseIsTotal || atJwIsUnplaced) {
    test.info().annotations.push({
      type: 'unfalsifiable',
      description:
        'the chips are only partly falsifiable on this data: ' +
        (inHouseIsTotal ? 'In-house reads the same as totalBalance. ' : '') +
        (atJwIsUnplaced ? 'At JW reads the same as Unplaced. ' : '') +
        'A field swap within a coinciding pair would pass.',
    });
  }

  await chip('At JW').click();
  await expect(chip('At JW')).toHaveAttribute('aria-pressed', 'true');
  await expectBars((r) => r.atJobWorkerBalance);

  // Clicking the ACTIVE chip clears it. Without this the chips are a one-way
  // latch and the only route back to the unfiltered total is to drill and come
  // back. Asserted on At JW rather than In-house because on a fully-in-house
  // seed the In-house slice equals the total, so its bars could not tell a
  // cleared chip from a stuck one.
  await chip('At JW').click();
  await expect(chip('At JW')).toHaveAttribute('aria-pressed', 'false');
  await expectBars((r) => r.totalBalance);

  await chip('In-house').click();
  await expect(chip('At JW')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip('In-house')).toHaveAttribute('aria-pressed', 'true');
  await expectBars((r) => r.inHouseBalance);

  // Drill with the chip still ACTIVE — that is the state the "chips vanish"
  // rule exists for. The segment is chosen for width, since a re-sliced bar can
  // leave most of its segments at 0%.
  const bySku = new Map<string, SummaryRow[]>();
  for (const row of items) {
    if (row.skuId === null) continue;
    const key = `${row.qualityId}\x00${row.skuId}`;
    bySku.set(key, [...(bySku.get(key) ?? []), row]);
  }
  expect(bySku.size, 'seed must provide a SKU-bearing stock item').toBeGreaterThan(0);
  const target = maxBy([...bySku.values()], (rows) => barTotal(rows, (r) => r.inHouseBalance))[0];
  expect(target).toBeDefined();
  if (target === undefined || target.skuId === null) return;

  await panel
    .locator(`[data-chart-unit="${target.unit}"] [data-chart-segment="${target.qualityId}:${target.skuId}"]`)
    .click();
  await expect(page).toHaveURL(new RegExp(`drill=quality%3A${target.qualityId}`));
  await expect(chips, 'the chips are unmounted while drilled, not disabled').toHaveCount(0);

  // Back at level 0 they return, UNSET: `pushDrill` clears the chip so a stale
  // slice cannot silently re-apply to bars that now mean something else.
  await panel.locator('[data-drill-crumb="0"]').click();
  await expect(chips).toHaveCount(3);
  await expect(chip('In-house')).toHaveAttribute('aria-pressed', 'false');
  await expectBars((r) => r.totalBalance);
});

test('a drilled URL is restorable on reload', async ({ page }) => {
  await gotoAndExpect(page, '/inventory');
  const items = await summaryRows(page.request);
  const target = items.find((i) => i.skuId !== null);
  expect(target, 'seed must provide a SKU-bearing stock item').toBeDefined();
  if (target === undefined || target.skuId === null) return;

  const expected = items.filter(
    (i) => i.qualityId === target.qualityId && i.skuId === target.skuId,
  ).length;
  const drill = `quality:${target.qualityId}/sku:${target.skuId}`;
  await gotoAndExpect(page, `/inventory?drill=${encodeURIComponent(drill)}`);

  const panel = page.getByRole('tabpanel');
  // The crumb resolves the id to a NAME once the summary lands; until then
  // `yarnDrillView` legitimately renders the raw value, so this is asserted by
  // waiting for the name rather than by rejecting the id.
  await expect(panel.locator('[data-drill-crumb]').last()).toContainText(target.skuName ?? '');
  await expect(panel.locator('tbody tr')).toHaveCount(expected);

  await page.reload();
  await expect(panel.locator('[data-drill-crumb]').last()).toContainText(target.skuName ?? '');
  await expect(panel.locator('tbody tr')).toHaveCount(expected);
});

test('the page still has exactly one navigation landmark while drilled', async ({ page, db }) => {
  const quality = await db.queryOne<{ id: string }>(
    `SELECT q.id::text FROM yarn_qualities q WHERE q.status = 'active' ORDER BY q.name LIMIT 1`,
  );
  expect(quality, 'seed must provide an active quality').not.toBeNull();
  if (quality === null) return;

  await gotoAndExpect(page, `/inventory?drill=${encodeURIComponent(`quality:${quality.id}`)}`);
  // The drill breadcrumb is a <div role="presentation"> on purpose: a second
  // `navigation` landmark would break support/nav.ts for the whole suite.
  await expect(page.getByRole('navigation')).toHaveCount(1);
  await expect(page.locator('[data-drill-crumb]').first()).toBeVisible();
});
