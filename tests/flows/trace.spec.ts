import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { getCsrfToken } from '../../support/api';
import { gotoAndExpect } from '../../support/nav';

// Lot lineage trace (Inventory Rewoven Phase 1, spec §6.1). The seed already
// contains a full warp chain; this spec FINDS one by query rather than seeding
// its own, but pins it to a specific lot number so it never collides with a
// sibling spec's "first active" row.
//
// The oracle is the database, not the UI: every hop the page draws must
// correspond to a real row, and the per-hop conservation strip must satisfy
// qty_in = Σconsumed + wastage + still_at_JW over the JW-In sources of that
// hop. The strip aggregates ALL non-cancelled sources of one out-item
// (hopConservations in fabtraq-fe lineage-layout.ts), so the oracle SUMs per
// out-item and excludes cancelled challans on both ends, exactly as R5 does.

interface ChainRow {
  lot_number: string;
  out_item_id: string;
  issued: string;
  consumed: string;
  one_consumed: string;
  wastage: string;
  still_at_jw: string;
}

test('traces a purchase lot through job work and surfaces the per-hop invariant', async ({
  page,
  db,
}) => {
  // A purchase lot that was dispatched to a job worker AND came back — the
  // longest chain the seed guarantees. Ordered by lot number so the pick is
  // deterministic across runs.
  const chain = await db.queryOne<ChainRow>(
    `SELECT ypi.lot_number,
            oi.id::text                            AS out_item_id,
            oi.net_weight::text                    AS issued,
            SUM(src.consumed_qty)::text            AS consumed,
            MIN(src.consumed_qty)::text            AS one_consumed,
            SUM(COALESCE(src.wastage, 0))::text    AS wastage,
            SUM(src.still_at_jw_qty)::text         AS still_at_jw
       FROM yarn_purchase_items ypi
       JOIN jw_challan_out_items oi ON oi.lot_number = ypi.lot_number
       JOIN jw_challans_out co ON co.id = oi.challan_out_id AND co.status <> 'cancelled'
       JOIN jw_challan_in_yarn_item_source src ON src.jw_challan_out_item_id = oi.id
       JOIN jw_challan_in_yarn_item yi ON yi.id = src.yarn_item_id
       JOIN jw_challans_in ci ON ci.id = yi.challan_in_id AND ci.status <> 'cancelled'
      GROUP BY ypi.lot_number, oi.id, oi.net_weight
      ORDER BY ypi.lot_number, oi.id
      LIMIT 1`,
  );
  expect(
    chain,
    'seed must contain at least one purchase lot dispatched and returned',
  ).not.toBeNull();
  if (chain === null) return; // narrow for TS; the expect above already failed

  await gotoAndExpect(page, `/inventory/trace?ref=${encodeURIComponent(chain.lot_number)}`);

  // The matched purchase lot renders, leading with its number.
  const rootCard = page.locator('[data-lineage-node^="purchase_lot:"]').first();
  await expect(rootCard).toBeVisible();
  await expect(rootCard).toContainText(chain.lot_number);

  // Every downstream hop type is present.
  await expect(page.locator('[data-lineage-node^="jw_out_item:"]').first()).toBeVisible();
  await expect(page.locator('[data-lineage-node^="jw_in_lot:"]').first()).toBeVisible();

  // A consume edge carries a number the DB holds (edge labels are per-source;
  // edgeSummary renders `Consumed <quantity> <unit>` with Number.toString()).
  const consumeEdges = page.locator('[data-lineage-edge="jw_consume"]');
  await expect(consumeEdges.first()).toBeVisible();
  await expect(
    consumeEdges.filter({ hasText: String(Number(chain.one_consumed)) }).first(),
  ).toBeVisible();

  // Per-hop invariant: issued = Σconsumed + wastage + still-at-JW, rendered by
  // the conservation strip for this out-item as
  // `consumed X · waste Y · at JW Z of Q issued`, all toFixed(3).
  const hop = page.locator(`[data-lineage-hop="jw_out_item:${chain.out_item_id}"]`);
  await expect(hop).toBeVisible();
  await expect(hop).toContainText(`consumed ${Number(chain.consumed).toFixed(3)}`);
  await expect(hop).toContainText(`waste ${Number(chain.wastage).toFixed(3)}`);
  await expect(hop).toContainText(`at JW ${Number(chain.still_at_jw).toFixed(3)}`);
  await expect(hop).toContainText(`of ${Number(chain.issued).toFixed(3)} issued`);
});

test('flags a cancelled hop, and hiding it leaves the hop totals unchanged', async ({
  page,
  db,
}) => {
  // The seed ships no cancelled challan-out, and this spec must own its
  // fixtures anyway: build a private chain via the API (purchase → dispatch →
  // cancel) so the assertion never depends on — or mutates — a shared row.
  const quality = await db.queryOne<{ id: string }>(
    `SELECT id FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  const vendor = await db.queryOne<{ id: string }>(
    `SELECT id FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  const jobWorker = await db.queryOne<{ id: string }>(
    `SELECT id FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  const floor = await db.queryOne<{ id: string; location_id: string }>(
    `SELECT f.id, f.location_id FROM location_floors f
       JOIN locations l ON l.id = f.location_id AND l.status = 'active'
      WHERE f.status = 'active' ORDER BY l.code, f.name LIMIT 1`,
  );
  expect(quality && vendor && jobWorker && floor, 'seed must provide the masters').toBeTruthy();
  if (!quality || !vendor || !jobWorker || !floor) return;

  // An authenticated page is needed before page.request carries the session.
  await gotoAndExpect(page, '/inventory');
  const csrfToken = await getCsrfToken(page);
  const placement = {
    locationId: floor.location_id,
    floorId: floor.id,
    quantity: 25,
    unit: 'KG',
  };

  const purchaseRes = await page.request.post(`${env.API_URL}/yarn-purchases`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      date: new Date().toISOString(),
      vendorId: vendor.id,
      items: [{ qualityId: quality.id, quantity: 25, unit: 'KG', placements: [placement] }],
    },
  });
  expect(purchaseRes.status(), await purchaseRes.text()).toBe(201);
  const purchase = (await purchaseRes.json()) as { id: string };
  const lotRow = await db.queryOne<{ lot_number: string }>(
    `SELECT lot_number FROM yarn_purchase_items WHERE purchase_id = $1 LIMIT 1`,
    [purchase.id],
  );
  expect(lotRow, 'the purchase must mint a lot').not.toBeNull();
  if (lotRow === null) return;

  const challanRes = await page.request.post(`${env.API_URL}/jw-challans-out`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      date: new Date().toISOString(),
      jobWorkerId: jobWorker.id,
      jobWorkTypes: ['dyeing'],
      items: [
        {
          qualityId: quality.id,
          sourceLotNumber: lotRow.lot_number,
          netWeight: 25,
          unit: 'KG',
          placements: [placement],
        },
      ],
    },
  });
  expect(challanRes.status(), await challanRes.text()).toBe(201);
  const challan = (await challanRes.json()) as { id: string };

  const cancelRes = await page.request.post(
    `${env.API_URL}/jw-challans-out/${challan.id}/cancel`,
    { headers: { 'X-CSRF-Token': csrfToken } },
  );
  expect(cancelRes.status(), await cancelRes.text()).toBe(200);

  await gotoAndExpect(page, `/inventory/trace?ref=${encodeURIComponent(lotRow.lot_number)}`);

  const cancelledCard = page.locator('[data-lineage-cancelled="true"]').first();
  await expect(cancelledCard).toBeVisible();
  await expect(cancelledCard).toContainText('Cancelled');

  const hops = page.locator('[data-lineage-hop]');
  const before = (await hops.count()) > 0 ? await hops.first().textContent() : null;

  await page.getByLabel('Hide cancelled').click();
  await expect(page.locator('[data-lineage-cancelled="true"]')).toHaveCount(0);

  if (before !== null) {
    // R5: the toggle hides, it never recounts.
    await expect(hops.first()).toHaveText(before);
  }
});

test('an unresolvable reference says so instead of drawing an empty graph', async ({ page }) => {
  await gotoAndExpect(page, '/inventory/trace?ref=NOT-A-REAL-REF-9999');
  await expect(page.getByText(/no match for/i)).toBeVisible();
  await expect(page.locator('[data-lineage-node]')).toHaveCount(0);
});
