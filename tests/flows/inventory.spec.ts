import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';

// Inventory is a pure read view over `stock_ledger` — no create/edit here. This
// spec cross-checks the Stock Balance page's displayed number against a direct
// ledger sum, to catch UI-vs-ledger drift (e.g. the positive-filter hazard: the
// BE only returns groups with balance > 0 — prisma-inventory.repository.ts
// `listBalances`, `.filter((a) => a.balance > 0)`).
//
// GROUPING — read from prisma-inventory.repository.ts `balanceGroupKey`: the
// Stock Balance page's canonical grouping is the 6-tuple (qualityId, skuId,
// locationId, floorId, jobWorkerId, unit) — it aggregates ACROSS lot numbers
// (lotNumber is not part of the key; a single balance row can sum multiple
// lots). So the matching `LedgerKey` must OMIT `lotNumber` (undefined = no
// filter, i.e. sum every lot) and match quality/sku/location/floor/jobWorker
// exactly. `LedgerKey` has no `unit` field, which is fine as long as the picked
// group is single-unit (checked below via the seed query itself).
//
// ROW SELECTION — filtered via direct URL query params
// (`/inventory?qualityId=...&locationId=...&floorId=...`), NOT by driving the
// Quality/Location Select controls. REAL FE BUG found while writing this spec:
// inventory-balance.page.tsx's onValueChange handlers call `setParam` TWICE
// synchronously per selection (e.g. Quality's handler does
// `setParam(qualityId, val); setParam(skuId, undefined);`). Each `setParam`
// calls `setSearchParams((prev) => ...)` with `{ replace: true }`; both calls'
// `prev` snapshots are taken before either commits, so the SECOND call's
// replace-navigation wins and clobbers the first — the selected quality (or
// location) is silently dropped and only `page=1` survives. Reproduced
// standalone: clicking "Filter by quality" → "20s CP" leaves the trigger
// showing "All qualities" and the URL at `/inventory?page=1` (no `qualityId`
// param, no `GET /inventory?qualityId=...` request ever fires). This makes the
// Quality/Location/Floor filters on this page non-functional via click — see
// task report (Task 19) for the reported, unfixed finding. Since the SKU
// filter Select also has no real options (see inventory-balance.page.tsx
// comment: "SKU list not available in qualities list response"), and the
// click-driven filters are broken, this spec instead derives a balance group
// from the ledger whose (qualityId, locationId, floorId) triple is UNIQUE
// among all positive-balance groups, and navigates straight to
// `/inventory?qualityId=...&locationId=...&floorId=...` — this exercises the
// exact same read path (buildQuery reads these params on mount) and is
// guaranteed to render exactly one row.
test('stock balance row matches the ledger sum for its group; lots page renders', async ({
  page,
  db,
}) => {
  // 1) Derive a balance group from the ledger, mirroring
  // PrismaInventoryRepository.listBalances: group by
  // (quality, sku, location, floor, jobWorker, unit), keep only positive
  // balances, then pick one whose (quality, location, floor) is unique so the
  // three Select filters alone pin down a single table row.
  const candidate = await db.queryOne<{
    quality_id: string;
    sku_id: string | null;
    location_id: string;
    floor_id: string;
    quality_name: string;
    location_name: string;
    floor_name: string;
    bal: string;
  }>(
    `WITH grp AS (
       SELECT quality_id, sku_id, location_id, floor_id, job_worker_id, unit,
              SUM(in_quantity - out_quantity) AS bal
       FROM stock_ledger
       GROUP BY quality_id, sku_id, location_id, floor_id, job_worker_id, unit
       HAVING SUM(in_quantity - out_quantity) > 0
     ),
     uniq AS (
       SELECT quality_id, location_id, floor_id, COUNT(*) AS n
       FROM grp
       WHERE location_id IS NOT NULL AND floor_id IS NOT NULL
       GROUP BY quality_id, location_id, floor_id
       HAVING COUNT(*) = 1
     )
     SELECT g.quality_id, g.sku_id, g.location_id, g.floor_id,
            q.name AS quality_name, l.name AS location_name, f.name AS floor_name,
            g.bal::text AS bal
     FROM grp g
     JOIN uniq u ON u.quality_id = g.quality_id AND u.location_id = g.location_id
       AND u.floor_id = g.floor_id
     JOIN yarn_qualities q ON q.id = g.quality_id
     JOIN locations l ON l.id = g.location_id
     JOIN location_floors f ON f.id = g.floor_id
     WHERE q.status = 'active' AND l.status = 'active' AND f.status = 'active'
       AND g.job_worker_id IS NULL
     ORDER BY g.bal DESC
     LIMIT 1`,
  );
  expect(
    candidate,
    'seed must provide a floor position whose (quality, location, floor) is a unique balance group',
  ).not.toBeNull();

  // 2) Filter the Stock Balance page down to that group via direct URL query
  // params (see top-of-file note — the Quality/Location Select controls
  // cannot be used to reach this state due to a real FE bug).
  await gotoAndExpect(
    page,
    `/inventory?qualityId=${candidate!.quality_id}&locationId=${candidate!.location_id}` +
      `&floorId=${candidate!.floor_id}`,
  );

  // Sanity: the Selects DO reflect the URL-driven filter correctly (it's only
  // the click path that's broken) — confirms this is really filtered, not an
  // accidental full-table view that happens to contain one row.
  await expect(page.getByRole('combobox', { name: 'Filter by quality' })).toHaveText(
    candidate!.quality_name,
  );
  await expect(page.getByRole('combobox', { name: 'Filter by location' })).toHaveText(
    candidate!.location_name,
  );
  await expect(page.getByRole('combobox', { name: 'Filter by floor' })).toHaveText(
    candidate!.floor_name,
  );

  // Exactly one row should render for this (quality, location, floor) triple
  // — confirmed unique by the seed query above.
  const row = page.getByRole('row', { name: candidate!.floor_name });
  await expect(row).toBeVisible();
  await expect(page.getByRole('row', { name: candidate!.floor_name })).toHaveCount(1);
  await expect(row).toContainText(candidate!.quality_name);
  await expect(row).toContainText(candidate!.location_name);

  // Balance column renders via format.kg: `${value.toFixed(3)} kg`.
  const balanceCell = row.getByRole('cell', { name: /^\d+\.\d{3} kg$/ });
  await expect(balanceCell).toBeVisible();
  const balanceText = (await balanceCell.textContent()) ?? '';
  const uiBalance = Number.parseFloat(balanceText);

  // 3) Cross-check: same key, direct ledger sum (no lotNumber filter — this
  // group aggregates across lots, same as the BE's balanceGroupKey).
  const ledgerBalance = await db.ledgerBalance({
    qualityId: candidate!.quality_id,
    skuId: candidate!.sku_id,
    locationId: candidate!.location_id,
    floorId: candidate!.floor_id,
    jobWorkerId: null,
  });
  expect(uiBalance).toBeCloseTo(ledgerBalance, 3);
  // Non-vacuous: the seed group itself is a positive balance, and the UI
  // number must equal it too (catches drift even if both happened to be 0).
  expect(ledgerBalance).toBeGreaterThan(0);

  // 4) Lots page — read-only, no cross-check math (its grouping additionally
  // keys on lotNumber — see prisma-inventory.repository.ts `lotGroupKey` —
  // which is out of scope here); just assert the Lots table renders with at
  // least one row.
  await gotoAndExpect(page, '/inventory/lots');
  await expect(page.getByRole('heading', { name: 'Inventory Lots' })).toBeVisible();
  const lotRows = page.getByRole('row');
  // header row + at least one data row
  expect(await lotRows.count()).toBeGreaterThan(1);
});
