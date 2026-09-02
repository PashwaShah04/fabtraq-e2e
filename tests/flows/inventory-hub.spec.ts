import { env } from '../../fixtures/env';
import { test, expect } from '../../fixtures/test';
import {
  accumulatePositions,
  LEDGER_POSITION_COLUMNS,
  type RawLedgerRow,
} from '../../support/ledger-positions';
import { gotoAndExpect } from '../../support/nav';

// Inventory hub (Inventory Rewoven Phase 2a, spec §6.2) — `/inventory` is now
// a four-card pipeline band over three material tabs (Yarn | Beams | Fabric).
//
// ORACLE. The band's yarn numbers are the SAME `getSummaryRows` accumulation
// inventory.spec.ts asserts, so both specs share one implementation
// (support/ledger-positions.ts). Two differences from that spec, both
// load-bearing:
//
//   1. NO `q.status = 'active'` FILTER. `buildPositionsWhere` filters on
//      qualityId/skuId/unit only — quality status never enters the backend's
//      read. inventory.spec.ts can filter safely because its groups key on
//      qualityId; the band sums ACROSS qualities, so filtering here would omit
//      stock the backend counts and the assertion would fail for the wrong
//      reason (or, worse, pass while the FE under-reports).
//   2. PER UNIT, NEVER SUMMED. R1 forbids adding KG to METER, so the oracle
//      buckets per unit and asserts one rendered line per unit.
//      HONEST LIMIT: the dev seed is all-KG, so today each stage yields ONE
//      unit and the cross-unit-sum property is UNFALSIFIABLE here — collapsing
//      one bucket into one total is a no-op. The guard that actually fails on
//      a cross-unit sum is the unit test, whose MSW fixture is deliberately
//      two-unit (fabtraq-fe tests/msw/handlers/overview.ts and
//      PipelineBand.test.tsx). This spec pins the arithmetic against REAL
//      ledger data; it does not pin R1. Each test run annotates which
//      properties its data could not exercise, rather than passing silently.
//
// The stock-item rollup `getSummaryRows` performs in between is deliberately
// skipped: `processedTypes` is part of both the position key and the
// stock-item key, and `custodyBucketOf` classifies per position, so summing
// stock-item rows and summing positions give the identical per-unit number.

/** Only the slice of `OverviewResponse` the Beams tab renders. */
interface OverviewBeams {
  beams: { total: number; totalNetWeightKg: number };
}

interface StageTotals {
  total: number;
  inHouse: number;
  atJobWorker: number;
  awaitingPlacement: number;
}

/** Mirrors fabtraq-fe's `format.int` — `en-IN`, so 100000 renders `1,00,000`. */
const int = (n: number): string => new Intl.NumberFormat('en-IN').format(Math.round(n));

const emptyStage = (): StageTotals => ({
  total: 0,
  inHouse: 0,
  atJobWorker: 0,
  awaitingPlacement: 0,
});

test('the pipeline band reports per-unit yarn stock and custody matching the ledger', async ({
  page,
  db,
}) => {
  const rows = await db.queryMany<RawLedgerRow>(LEDGER_POSITION_COLUMNS);
  expect(rows.length, 'seed must provide stock_ledger rows').toBeGreaterThan(0);

  const positions = accumulatePositions(rows);
  expect(
    positions.length,
    'seed must provide at least one positive-balance position',
  ).toBeGreaterThan(0);

  // Raw = no processed types; processed = any. Kept per unit, never merged.
  const byStage = { raw: new Map<string, StageTotals>(), processed: new Map<string, StageTotals>() };
  for (const p of positions) {
    const map = p.processedTypes.length === 0 ? byStage.raw : byStage.processed;
    const bucket = map.get(p.unit) ?? emptyStage();
    bucket.total += p.balance;
    // custodyBucketOf: locationId wins over jobWorkerId, so the three buckets
    // stay mutually exclusive.
    if (p.locationId !== null) bucket.inHouse += p.balance;
    else if (p.jobWorkerId !== null) bucket.atJobWorker += p.balance;
    else bucket.awaitingPlacement += p.balance;
    map.set(p.unit, bucket);
  }
  expect(
    byStage.raw.size + byStage.processed.size,
    'seed must produce at least one yarn stage row',
  ).toBeGreaterThan(0);

  await gotoAndExpect(page, '/inventory');

  for (const [stage, byUnit] of Object.entries(byStage)) {
    const card = page.locator(`[data-stage-card="${stage}"]`);
    await expect(card).toBeVisible();

    // Record, per run, which properties this data could NOT exercise — an
    // all-KG seed makes the "never summed" assertion vacuous, and an
    // all-in-house one makes two thirds of the custody split vacuous. Same
    // annotation idiom inventory.spec.ts uses for its empty-bucket branches.
    if (byUnit.size < 2) {
      test.info().annotations.push({
        type: 'skip',
        description: `${stage}: seed has ${String(byUnit.size)} unit(s); cross-unit-sum property not exercised.`,
      });
    }

    for (const [unit, totals] of byUnit) {
      if (totals.atJobWorker === 0 && totals.awaitingPlacement === 0) {
        test.info().annotations.push({
          type: 'skip',
          description: `${stage}/${unit}: fully in-house; at-JW and unplaced custody buckets not exercised.`,
        });
      }
      // The headline is one span: `${format.int(total)} ${unit}`. Asserted as
      // the whole string rather than two toContainText calls, so a number that
      // merely appears somewhere in the card cannot satisfy it.
      await expect(card.getByText(`${int(totals.total)} ${unit}`, { exact: true })).toBeVisible();
      // The custody sub-line — this is what pins the in-house / at-JW /
      // unplaced split, not just the headline.
      await expect(
        card.getByText(
          `In-house ${int(totals.inHouse)} · At JW ${int(totals.atJobWorker)} · Unplaced ${int(
            totals.awaitingPlacement,
          )}`,
          { exact: true },
        ),
      ).toBeVisible();
    }
  }
});

test('tab state round-trips through the URL and old ?tab=fabric links still work', async ({
  page,
}) => {
  await gotoAndExpect(page, '/inventory?tab=fabric');
  await expect(page.getByRole('tab', { name: 'Fabric', selected: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Yarn' }).click();
  await expect(page).toHaveURL(/[?&]tab=yarn/);

  await page.reload();
  await expect(page.getByRole('tab', { name: 'Yarn', selected: true })).toBeVisible();
});

test('clicking a stage card selects its material tab', async ({ page }) => {
  await gotoAndExpect(page, '/inventory');
  await page.locator('[data-stage-card="fabric"]').click();
  await expect(page.getByRole('tab', { name: 'Fabric', selected: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]tab=fabric/);
});

// Phase 2a covers the Beams tab as a HAND-OFF to the register (the ledger's
// Task 12 minor: "Beams tab untested in hub spec — Task 13 e2e must cover
// it"). The drill-down chart on that tab is Phase 2b and belongs to Task 18.
test('the Beams tab reports beam stock and hands off to the register', async ({ page }) => {
  await gotoAndExpect(page, '/inventory?tab=beams');
  const panel = page.getByRole('tabpanel');

  // Read the figures off the LIVE server rather than restating them, so this
  // asserts the tab renders what `GET /overview` actually returned — a
  // hardcoded or dropped number reds it. (Beam counting itself is
  // `beamRepo.statusRollup`; re-deriving it here would be a second, divergent
  // implementation of an algorithm this task does not own.)
  const overview = await page.request
    .get(`${env.API_URL}/overview`)
    .then(async (r) => (await r.json()) as OverviewBeams);

  await expect(
    panel.getByText(
      `${int(overview.beams.total)} beams · ${overview.beams.totalNetWeightKg.toFixed(3)} kg`,
      { exact: true },
    ),
  ).toBeVisible();

  await panel.getByRole('link', { name: 'Open Beam Register' }).click();
  await expect(page).toHaveURL(/\/beams(\?|$)/);
  await expect(page.getByRole('heading', { name: 'Beam Register' })).toBeVisible();
});

test('a unit filter applies to the URL and resets to page 1', async ({ page }) => {
  await gotoAndExpect(page, '/inventory?page=2');
  await page.getByLabel('Filter by unit').click();
  await page.getByRole('option', { name: 'KG', exact: true }).click();
  await expect(page).toHaveURL(/[?&]unit=KG/);
  await expect(page).toHaveURL(/[?&]page=1/);
});

test('the deep registers are still reachable and still work', async ({ page }) => {
  await gotoAndExpect(page, '/inventory/lots');
  await expect(page.getByRole('heading', { name: 'Inventory Lots' })).toBeVisible();
  await gotoAndExpect(page, '/inventory/trace');
  await expect(page.getByRole('heading', { name: 'Trace' })).toBeVisible();
});
