import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { createSentinelPurchase } from '../../support/sentinel-purchase';

// Inventory is a pure read view over `stock_ledger` — no create/edit here.
// Rewritten for the inventory overview redesign (formerly "Stock Balance"; B-015,
// docs/superpowers/specs/2026-07-22-stock-balance-overview-design.md, D3-D5):
// the old per-position `/inventory` table (Location/Floor filters, one row
// per physical position) is gone; `/inventory` is now a stock-item OVERVIEW
// (Quality | SKU | Processed | Quantity | Custody, filterable only by
// quality/unit/state), and the physical breakdown moved to
// `/inventory/positions`.
//
// ORACLE — mirrors D2 exactly, in two stages, BOTH done in JS off raw,
// UNGROUPED ledger rows (no SQL `GROUP BY` on `processed_types` — see the
// note below for why):
//   1) POSITION-level accumulation: the same 7-tuple `balanceGroupKey` in
//      prisma-inventory.repository.ts uses (quality, sku, location, floor,
//      jobWorker, processedTypes, unit), summed across lot numbers
//      (lotNumber is deliberately excluded — a balance aggregates every
//      lot), positive balances only.
//   2) Roll positions UP to the stock-item level (quality, sku, canonical
//      processedTypes, unit) — the overview's grouping — summing
//      totalBalance and splitting into the three custody buckets (inHouse:
//      locationId set; atJobWorker: jobWorkerId set; awaitingPlacement: both
//      null), exactly as inventory-summary.helpers.ts
//      `custodyBucketOf`/`rollupSummaryRows` does.
//
// WHY NO SQL `GROUP BY sl.processed_types`: an earlier version of this spec
// grouped positions via SQL. That version silently produced WRONG oracle
// values — rows with an identical, empty `processed_types` array were
// sometimes treated as separate groups by Postgres, hiding real discrepancies
// instead of catching them. All accumulation now happens in plain JS,
// matching this project's "compute in app, not DB" convention
// ([[feedback_compute_in_app_not_db]]) and the BE's own `fetchPositions`
// approach — immune to whatever affects SQL-level array grouping.
//
// CUSTODY NORMALIZATION (position-custody.ts, fixed during B-015): challan-out
// writes its floor DEBIT leg with the destination job_worker_id stamped on as
// provenance while keeping the source location/floor. The BE normalizes
// jobWorkerId to null for any located row before grouping (a located row IS a
// floor position — L4), so those debits net against the floor's credits
// instead of splitting into a dropped hybrid bucket (the pre-fix behavior
// overstated a 250−60−80=110 position as 250). The oracle below applies the
// SAME normalization, so debit-history stock items are deliberately IN scope.
//
// ROW SELECTION — the redesigned overview has no SKU/location/floor filter
// (D3: only quality/unit/state), so a single quality can render several
// stock-item rows. Disambiguated by filtering on the row's own rendered
// Quantity text (which must equal the oracle's `totalBalance`, formatted the
// same way the FE does: `${value.toFixed(3)} kg`) intersected with its SKU
// name when the group has one — this needs no knowledge of the FE's
// job-work-type label strings and is unique for any real balance figure.

interface RawLedgerRow {
  quality_id: string;
  sku_id: string | null;
  location_id: string | null;
  floor_id: string | null;
  job_worker_id: string | null;
  processed_types: string[];
  unit: string;
  quality_name: string;
  sku_name: string | null;
  location_name: string | null;
  floor_name: string | null;
  job_worker_name: string | null;
  in_quantity: string;
  out_quantity: string;
}

interface PositionAccum {
  qualityId: string;
  qualityName: string;
  skuId: string | null;
  skuName: string | null;
  locationId: string | null;
  locationName: string | null;
  floorId: string | null;
  floorName: string | null;
  jobWorkerId: string | null;
  jobWorkerName: string | null;
  processedTypes: string[];
  unit: string;
  balance: number;
}

interface StockItemGroup {
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

const RAW_STATE = 'raw';

function canonicalProcessedTypes(types: readonly string[]): string[] {
  return [...types].sort();
}

/** Mirrors fabtraq-fe's `lib/positions-url.ts` `encodeProcessedTypesState`. */
function encodeState(types: readonly string[]): string {
  return types.length === 0 ? RAW_STATE : [...types].sort().join(',');
}

const kg = (n: number): string => `${n.toFixed(3)} kg`;

/** Mirrors fabtraq-fe's `lib/custody.ts` `custodySplitText`. */
function expectedCustodyText(g: StockItemGroup): string {
  if (g.atJobWorkerBalance === 0 && g.awaitingPlacementBalance === 0) {
    return 'In-house';
  }
  const parts: string[] = [];
  if (g.inHouseBalance !== 0) parts.push(`In-house ${kg(g.inHouseBalance)}`);
  if (g.atJobWorkerBalance !== 0) parts.push(`At JW ${kg(g.atJobWorkerBalance)}`);
  if (g.awaitingPlacementBalance !== 0) parts.push(`Unplaced ${kg(g.awaitingPlacementBalance)}`);
  return parts.join(' · ');
}

test('overview row matches the ledger rollup for its stock item; positions detail shows the physical breakdown; lots page renders', async ({
  page,
  db,
}) => {
  // 1) Raw, UNGROUPED ledger rows for every active quality (see the
  // top-of-file note for why no SQL GROUP BY is used).
  const rawRows = await db.queryMany<RawLedgerRow>(
    `SELECT sl.quality_id, sl.sku_id, sl.location_id, sl.floor_id, sl.job_worker_id,
            sl.processed_types::text[] AS processed_types, sl.unit::text AS unit,
            q.name AS quality_name, s.name AS sku_name,
            l.name AS location_name, f.name AS floor_name, jw.name AS job_worker_name,
            sl.in_quantity::text AS in_quantity, sl.out_quantity::text AS out_quantity
     FROM stock_ledger sl
     JOIN yarn_qualities q ON q.id = sl.quality_id
     LEFT JOIN yarn_skus s ON s.id = sl.sku_id
     LEFT JOIN locations l ON l.id = sl.location_id
     LEFT JOIN location_floors f ON f.id = sl.floor_id
     LEFT JOIN job_workers jw ON jw.id = sl.job_worker_id
     WHERE q.status = 'active'`,
  );
  expect(rawRows.length, 'seed must provide at least one active-quality ledger row').toBeGreaterThan(0);

  // Position-level accumulation (the 7-tuple `balanceGroupKey` in
  // prisma-inventory.repository.ts uses), positive balances only.
  const positionMap = new Map<string, PositionAccum>();
  for (const r of rawRows) {
    const canonical = canonicalProcessedTypes(r.processed_types);
    // Custody normalization, mirroring the BE's position-custody.ts: a located
    // row is a floor position; job_worker_id on it is provenance, not position.
    const jobWorkerId = r.location_id !== null ? null : r.job_worker_id;
    const jobWorkerName = r.location_id !== null ? null : r.job_worker_name;
    const key = [
      r.quality_id,
      r.sku_id ?? '∅',
      r.location_id ?? '∅',
      r.floor_id ?? '∅',
      jobWorkerId ?? '∅',
      r.unit,
      canonical.join(','),
    ].join('\x00');
    let p = positionMap.get(key);
    if (p === undefined) {
      p = {
        qualityId: r.quality_id,
        qualityName: r.quality_name,
        skuId: r.sku_id,
        skuName: r.sku_name,
        locationId: r.location_id,
        locationName: r.location_name,
        floorId: r.floor_id,
        floorName: r.floor_name,
        jobWorkerId,
        jobWorkerName,
        processedTypes: canonical,
        unit: r.unit,
        balance: 0,
      };
      positionMap.set(key, p);
    }
    p.balance += Number(r.in_quantity) - Number(r.out_quantity);
  }
  const positions = [...positionMap.values()].filter((p) => p.balance > 0);
  expect(positions.length, 'seed must provide at least one positive-balance position').toBeGreaterThan(0);

  // 2) Roll positions up to the stock-item level (D2), in JS.
  const groups = new Map<string, StockItemGroup>();
  for (const p of positions) {
    const canonical = p.processedTypes.join(',');
    const key = [p.qualityId, p.skuId ?? '∅', canonical, p.unit].join('\x00');
    let g = groups.get(key);
    if (g === undefined) {
      g = {
        qualityId: p.qualityId,
        qualityName: p.qualityName,
        skuId: p.skuId,
        skuName: p.skuName,
        processedTypes: p.processedTypes,
        unit: p.unit,
        totalBalance: 0,
        inHouseBalance: 0,
        atJobWorkerBalance: 0,
        awaitingPlacementBalance: 0,
      };
      groups.set(key, g);
    }
    g.totalBalance += p.balance;
    if (p.locationId !== null) {
      g.inHouseBalance += p.balance;
    } else if (p.jobWorkerId !== null) {
      g.atJobWorkerBalance += p.balance;
    } else {
      g.awaitingPlacementBalance += p.balance;
    }
  }

  // Distinct canonical processedTypes states that have ANY in-house
  // presence, per (qualityId, skuId, unit) stock item — avoids a stock item
  // whose in-house floor(s) are shared with a DIFFERENT processed state
  // (harder to assert cleanly, though not itself known to be buggy).
  const inHouseStatesByItem = new Map<string, Set<string>>();
  for (const p of positions) {
    if (p.locationId === null) continue;
    const itemKey = [p.qualityId, p.skuId ?? '∅', p.unit].join('\x00');
    let states = inHouseStatesByItem.get(itemKey);
    if (states === undefined) {
      states = new Set();
      inHouseStatesByItem.set(itemKey, states);
    }
    states.add(p.processedTypes.join(','));
  }

  // Pick a group with an in-house component and no floor-sharing contamination,
  // deterministically (largest total balance), so step 3 has a concrete
  // "In factory" row to assert.
  const candidate = [...groups.values()]
    .filter((g) => g.inHouseBalance > 0)
    .filter((g) => {
      const itemKey = [g.qualityId, g.skuId ?? '∅', g.unit].join('\x00');
      return (inHouseStatesByItem.get(itemKey)?.size ?? 0) === 1;
    })
    .sort((a, b) => b.totalBalance - a.totalBalance)[0];
  expect(
    candidate,
    'seed must provide an undisturbed (no floor-sharing) in-house stock-item group',
  ).not.toBeUndefined();

  // Concrete (location, floor) position inside that group, for the "In
  // factory" row assertion — largest such position, so it is unambiguous.
  const candidateKey = (p: PositionAccum): string =>
    [p.qualityId, p.skuId ?? '∅', p.processedTypes.join(','), p.unit].join('\x00');
  const targetKey = [candidate!.qualityId, candidate!.skuId ?? '∅', candidate!.processedTypes.join(','), candidate!.unit].join(
    '\x00',
  );
  const matchingPositions = positions.filter((p) => candidateKey(p) === targetKey);

  const concreteFloor = matchingPositions
    .filter((p) => p.locationId !== null)
    .sort((a, b) => b.balance - a.balance)[0];
  expect(concreteFloor, 'expected at least one location/floor row for the chosen group').not.toBeUndefined();

  // One concrete job-worker row, only present when the group actually has an
  // at-job-worker balance (used in step 4 below).
  const concreteJobWorker =
    candidate!.atJobWorkerBalance > 0
      ? matchingPositions.filter((p) => p.jobWorkerId !== null).sort((a, b) => b.balance - a.balance)[0]
      : undefined;

  // 3) Overview page, filtered to the chosen quality only (D3 — no
  // SKU/location/floor filters exist any more); pageSize=200 so the target
  // row is on the one page regardless of how many stock items this quality
  // has (mirrors D4's "a single quality's positions fit one page").
  await gotoAndExpect(page, `/inventory?qualityId=${candidate!.qualityId}&pageSize=200`);

  const totalText = kg(candidate!.totalBalance);
  let overviewRow = page.getByRole('row').filter({ hasText: totalText });
  if (candidate!.skuName !== null) {
    overviewRow = overviewRow.filter({ hasText: candidate!.skuName });
  }
  await expect(overviewRow).toHaveCount(1);

  // Custody cell (last column) must render the exact split text D3 defines.
  const custodyCell = overviewRow.locator('td').last();
  await expect(custodyCell).toHaveText(expectedCustodyText(candidate!));

  // 4) Click through to the positions detail page; assert the URL contract
  // (D4) precisely.
  await overviewRow.click();
  await expect(page).toHaveURL(/\/inventory\/positions\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('qualityId')).toBe(candidate!.qualityId);
  expect(url.searchParams.get('skuId')).toBe(candidate!.skuId);
  expect(url.searchParams.get('state')).toBe(encodeState(candidate!.processedTypes));
  expect(url.searchParams.get('unit')).toBe(candidate!.unit);

  await expect(page.getByRole('heading', { name: 'Stock Detail' })).toBeVisible();

  // Header total, scoped to the summary card so it can't collide with a
  // section total that happens to equal the whole (e.g. fully in-house).
  const summaryCard = page.getByRole('region', { name: 'Stock detail summary' });
  await expect(summaryCard.getByText(totalText)).toBeVisible();

  // "In factory" — concrete location/floor row.
  const inFactory = page.getByRole('region', { name: 'In factory' });
  await expect(inFactory).toBeVisible();
  const floorRow = inFactory.getByRole('row', { name: concreteFloor!.floorName ?? '' });
  await expect(floorRow).toBeVisible();
  await expect(floorRow).toContainText(concreteFloor!.locationName ?? '');
  await expect(floorRow).toContainText(kg(concreteFloor!.balance));

  // "At job workers" — only asserted when the chosen group actually has an
  // at-job-worker position; otherwise log the skip rather than assert
  // absence (asserting the SECTION is present-if-and-only-if the bucket is
  // non-empty is exactly what these branches already do).
  if (concreteJobWorker !== undefined) {
    const atJobWorkers = page.getByRole('region', { name: 'At job workers' });
    await expect(atJobWorkers).toBeVisible();
    const jwRow = atJobWorkers.getByRole('row', { name: concreteJobWorker.jobWorkerName ?? '' });
    await expect(jwRow).toBeVisible();
    await expect(jwRow).toContainText(kg(concreteJobWorker.balance));
  } else {
    test.info().annotations.push({
      type: 'skip',
      description:
        'Chosen stock-item group has zero at-job-worker balance; "At job workers" section assertion skipped.',
    });
  }

  // "Awaiting placement" — single callout value (no per-lot breakdown in
  // the UI), only asserted when non-zero.
  if (candidate!.awaitingPlacementBalance > 0) {
    const awaiting = page.getByRole('region', { name: 'Awaiting placement' });
    await expect(awaiting).toBeVisible();
    await expect(awaiting).toContainText(kg(candidate!.awaitingPlacementBalance));
  } else {
    test.info().annotations.push({
      type: 'skip',
      description:
        'Chosen stock-item group has zero awaiting-placement balance; "Awaiting placement" section assertion skipped.',
    });
  }

  // 5) Lots page — read-only, no cross-check math (its grouping additionally
  // keys on lotNumber, out of scope here); just assert it renders.
  await gotoAndExpect(page, '/inventory/lots');
  await expect(page.getByRole('heading', { name: 'Inventory Lots' })).toBeVisible();
  const lotRows = page.getByRole('row');
  // header row + at least one data row
  expect(await lotRows.count()).toBeGreaterThan(1);

  // AUDIT (E11 plan note, "the existing test this breaks" — `:295` above).
  // The plan (written before FE commit 99b41d9) predicted
  // `expect(url.searchParams.get('skuId')).toBe(candidate!.skuId)` on line 295
  // would start failing once null-SKU stock existed, on the theory that Task
  // 12's NO_SHADE disambiguation applied wherever `candidate.skuId` is null.
  // It does not: Task 12 (11e9529, 99b41d9) scoped the fix to `buildLotsUrl`
  // only (fabtraq-fe `positions-url.ts`), which drives the FURTHER
  // `/inventory/positions` → `/inventory/lots` drill-down (a server-filtered
  // endpoint, where an absent skuId really did mean "no filter" — the bug).
  // Line 295's URL is built by `buildPositionsUrl`, used for the OVERVIEW →
  // POSITIONS click above (line 291) and untouched by Task 12 — confirmed by
  // reading `positions-url.ts`'s own doc comment, which explicitly warns not
  // to conflate the two: `/inventory/positions` filters client-side, so an
  // absent skuId meaning "the null-SKU group" was never wrong there, and
  // `buildPositionsUrl` still omits skuId for `candidate.skuId === null`,
  // matching `url.searchParams.get('skuId') === null` by construction — not
  // by the coincidence the plan feared. No fix applies at line 295; the E11
  // test below covers the drill-down that Task 12 actually changed.
});

// E11 — `/inventory/lots` null-SKU drill-down (FE Task 12, shared commits
// 11e9529/99b41d9). `buildLotsUrl(qualityId, null)` now emits the explicit
// `NO_SHADE` token instead of omitting `skuId`, so the server-filtered
// `/inventory/lots` endpoint can finally tell "the null-SKU group" apart from
// "no SKU filter at all" (the pre-fix bug: an omitted `skuId` meant "any SKU",
// so a null-SKU drill-down silently listed every SKU's lots for that
// quality). QTY-001 (the seed's one active quality) always carries a real-SKU
// lot (SKU-001/red); `createSentinelPurchase` always resolves to the same
// quality (lowest `code` among active qualities), so one sentinel purchase
// gives this test both kinds of stock on the same quality — required for the
// differential assertion below to mean anything.
test('inventory lots drill-down: NO_SHADE disambiguates the null-SKU group from a real SKU and from the quality-alone filter', async ({
  page,
  db,
}) => {
  const Q = 30;
  const sentinel = await createSentinelPurchase(page, db, Q);

  const quality = await db.queryOne<{ name: string }>(
    `SELECT name FROM yarn_qualities WHERE id = $1`,
    [sentinel.qualityId],
  );
  expect(quality, 'sentinel purchase must reference a real quality').not.toBeNull();

  const realSku = await db.queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM yarn_skus WHERE quality_id = $1 ORDER BY code LIMIT 1`,
    [sentinel.qualityId],
  );
  expect(realSku, 'the sentinel quality must have at least one real SKU for the differential').not.toBeNull();

  const realSkuLot = await db.queryOne<{ lot_number: string }>(
    `SELECT lot_number
     FROM stock_ledger
     WHERE quality_id = $1 AND sku_id = $2
     GROUP BY lot_number
     HAVING SUM(in_quantity - out_quantity) > 0
     ORDER BY lot_number
     LIMIT 1`,
    [sentinel.qualityId, realSku!.id],
  );
  expect(
    realSkuLot,
    'seed must carry a positive-balance real-SKU lot of the sentinel quality for the differential',
  ).not.toBeNull();

  // Branch 1 — SKU-less drill-down. Reached via the positions page's "View
  // lots" link with no skuId in the URL (D4: absence there IS the null-SKU
  // selector), which `buildLotsUrl` must translate to the explicit NO_SHADE
  // token rather than passing absence straight through.
  await gotoAndExpect(page, `/inventory/positions?qualityId=${sentinel.qualityId}`);
  const nullLotsReqPromise = page.waitForRequest(
    (req) =>
      req.method() === 'GET' &&
      req.url().includes('/inventory/lots?') &&
      req.url().includes(`qualityId=${sentinel.qualityId}`),
  );
  await page.getByRole('link', { name: 'View lots' }).click();
  const nullLotsReq = await nullLotsReqPromise;
  expect(new URL(nullLotsReq.url()).searchParams.get('skuId')).toBe('NO_SHADE');
  await expect(page).toHaveURL(new RegExp(`/inventory/lots\\?qualityId=${sentinel.qualityId}&skuId=NO_SHADE`));

  // pageSize bumped so the target lot is on-page regardless of how many other
  // lots this quality has accumulated across the suite (single-spec runs do
  // not reseed).
  await gotoAndExpect(page, `/inventory/lots?qualityId=${sentinel.qualityId}&skuId=NO_SHADE&pageSize=200`);
  await expect(page.getByRole('row', { name: sentinel.lotNumber })).toHaveCount(1);
  // The differential: on the pre-fix build this would have rendered too,
  // because an omitted skuId applied no filter at all.
  await expect(page.getByRole('row', { name: realSkuLot!.lot_number })).toHaveCount(0);

  // Branch 2 — real-SKU drill-down, unchanged: skuId carries the uuid, both
  // at the route and on the wire.
  await gotoAndExpect(page, `/inventory/positions?qualityId=${sentinel.qualityId}&skuId=${realSku!.id}`);
  const realLotsReqPromise = page.waitForRequest(
    (req) =>
      req.method() === 'GET' &&
      req.url().includes('/inventory/lots?') &&
      req.url().includes(`qualityId=${sentinel.qualityId}`),
  );
  await page.getByRole('link', { name: 'View lots' }).click();
  const realLotsReq = await realLotsReqPromise;
  expect(new URL(realLotsReq.url()).searchParams.get('skuId')).toBe(realSku!.id);

  await gotoAndExpect(page, `/inventory/lots?qualityId=${sentinel.qualityId}&skuId=${realSku!.id}&pageSize=200`);
  // A real-SKU lot can legitimately have more than one row here — the lots
  // page is one row per (lot, location/state) partition, and the seed's lot
  // has been through several scenarios — so "present" means visible-at-least-
  // once, not exactly 1 (unlike the sentinel's freshly-minted, single-position
  // lot). `.first()` auto-retries through the initial data load.
  await expect(page.getByRole('row', { name: realSkuLot!.lot_number }).first()).toBeVisible();
  await expect(page.getByRole('row', { name: sentinel.lotNumber })).toHaveCount(0);

  // Branch 3 — quality-alone filter (the restored dropdown behaviour, D3):
  // absent skuId must mean "no filter" here, returning BOTH kinds — the
  // assertion that gives this spec its teeth: NO_SHADE and absent must yield
  // DIFFERENT row sets (Branch 1's null-SKU set is a strict subset of this
  // one), not just that NO_SHADE "works" in isolation.
  //
  // NOT driven through the "Filter by quality" select, despite the plan's
  // wording — a real, reproducible bug (found while writing this test, filed
  // to the lead separately, out of E11's scope to fix): the select's
  // `onValueChange` fires TWO sequential `setParam` calls (qualityId, then
  // clearing skuId) built on `setSearchParams` from `useSearchParams`. Each
  // call's functional updater closes over the SAME pre-click `prev`, so the
  // second call's `next = new URLSearchParams(prev)` discards the first
  // call's qualityId change — confirmed live: selecting a quality here leaves
  // the URL as `?pageSize=200&page=1`, qualityId never applied. (The
  // "Location" select's floorId-clearing handler has the identical shape and
  // is presumably equally broken — not verified further, out of scope here.)
  // A single-setParam control (Vendor) was confirmed unaffected. Asserting
  // the WIRE contract directly via URL navigation below still proves what D3
  // requires — that an absent skuId applies no filter — without the test
  // silently passing against a UI control that cannot currently reach that
  // state.
  await gotoAndExpect(page, `/inventory/lots?qualityId=${sentinel.qualityId}&pageSize=200`);
  expect(new URL(page.url()).searchParams.has('skuId')).toBe(false);
  await expect(page.getByRole('row', { name: sentinel.lotNumber })).toHaveCount(1);
  await expect(page.getByRole('row', { name: realSkuLot!.lot_number }).first()).toBeVisible();
});
