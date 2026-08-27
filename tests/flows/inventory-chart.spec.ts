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
  const leafKey = ptKey(maxBy(skuItems, (i) => i.totalBalance));
  const leafRows = skuItems.filter((i) => ptKey(i) === leafKey);

  // Level 0's segments are SKUs; a null-SKU segment is skipped for the same
  // reason as above, and any segment of this bar drills to the same quality.
  const topSkuKey = maxBy(
    qualityItems.filter((i) => i.skuId !== null),
    (i) => i.totalBalance,
  ).skuId;

  const panel = page.getByRole('tabpanel');
  const rows = panel.locator('tbody tr');
  const crumb = panel.locator('[data-drill-crumb]');

  await expect(rows).toHaveCount(items.length);

  // ---- Level 0 → 1: quality --------------------------------------------
  await panel.locator(`[data-chart-segment="${target.qualityId}:${topSkuKey ?? ''}"]`).click();
  await expect(page).toHaveURL(new RegExp(`drill=quality%3A${target.qualityId}`));
  await expect(crumb.last()).toContainText(target.qualityName);
  await expect(rows).toHaveCount(qualityItems.length);

  if (qualityItems.length === items.length) {
    test.info().annotations.push({
      type: 'skip',
      description:
        'quality level: every row on this page belongs to ONE quality, so the level-0 drill ' +
        'narrows nothing — the row count is asserted but the narrowing property is not ' +
        'exercised here. The SKU and processedType steps below are where this test has teeth.',
    });
  }

  // ---- Level 1 → 2: SKU -------------------------------------------------
  await panel.locator(`[data-chart-segment="${target.skuId}:${leafKey}"]`).click();
  await expect(page).toHaveURL(new RegExp(`drill=quality%3A[^&]*%2Fsku%3A${target.skuId}`));
  await expect(crumb.last()).toContainText(target.skuName ?? '');
  await expect(rows).toHaveCount(skuItems.length);
  if (skuItems.length === qualityItems.length) {
    test.info().annotations.push({
      type: 'skip',
      description:
        'SKU level: this quality holds exactly one SKU on this page, so the level-1 drill ' +
        'narrows nothing — the row count is asserted but the narrowing property is not exercised.',
    });
  }

  // ---- Level 2 → 3: processed type --------------------------------------
  await panel.locator(`[data-chart-segment="${leafKey}:${leafKey}"]`).click();
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
      type: 'skip',
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
  await expect(panel.locator('span[data-chart-segment]')).toHaveCount(3);

  const unit = leafRows[0]?.unit ?? target.unit;
  const custody = [
    ['in_house', 'In-house', sumOf(leafRows, (r) => r.inHouseBalance)],
    ['at_jw', 'At JW', sumOf(leafRows, (r) => r.atJobWorkerBalance)],
    ['unplaced', 'Unplaced', sumOf(leafRows, (r) => r.awaitingPlacementBalance)],
  ] as const;
  for (const [key, label, value] of custody) {
    await expect(panel.locator(`span[data-chart-segment="custody:${key}"]`)).toHaveAttribute(
      'title',
      `${label}: ${num(value)} ${unit}`,
    );
  }
  if (custody[1][2] === 0 && custody[2][2] === 0) {
    test.info().annotations.push({
      type: 'skip',
      description:
        'custody level: the drilled position is fully in-house, so the At-JW and Unplaced ' +
        'segments are asserted at zero — a swap between those two buckets would not be caught.',
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
