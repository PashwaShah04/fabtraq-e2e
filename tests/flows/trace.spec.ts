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

  // The page states the answer in words: a DAG only gives up "where did this
  // go" to a reader willing to trace arrows.
  //
  // The sentence names the subject's SOURCES and OUTPUTS, never the subject
  // itself — the card above already leads with that number, and "LOT-X was
  // made from LOT-X" reads as a bug. A purchase lot has no sources, so the
  // only sentence it renders is "Went on to …", and the oracle is the set of
  // JW-In lots the DB derives from this lot.
  const outputs = await db.queryMany<{ lot_no: string }>(
    `SELECT DISTINCT yi.lot_no
       FROM yarn_purchase_items ypi
       JOIN jw_challan_out_items oi ON oi.lot_number = ypi.lot_number
       JOIN jw_challans_out co ON co.id = oi.challan_out_id AND co.status <> 'cancelled'
       JOIN jw_challan_in_yarn_item_source src ON src.jw_challan_out_item_id = oi.id
       JOIN jw_challan_in_yarn_item yi ON yi.id = src.yarn_item_id
       JOIN jw_challans_in ci ON ci.id = yi.challan_in_id AND ci.status <> 'cancelled'
      WHERE ypi.lot_number = $1`,
    [chain.lot_number],
  );
  expect(outputs.length, 'the traced lot must have produced at least one lot').toBeGreaterThan(0);

  const flow = page.locator('[data-lineage-flow]');
  await expect(flow).toBeVisible();
  await expect(flow).toContainText('Went on to');
  for (const output of outputs) {
    await expect(flow, `the flow sentence must name ${output.lot_no}`).toContainText(output.lot_no);
  }
  // The subject names itself only on its card, never in its own summary.
  await expect(flow).not.toContainText(chain.lot_number);

  // Every edge must advance left-to-right. The backend's `depth` is the
  // SHORTEST hop distance, so a lot reached by two routes of different lengths
  // could land to the RIGHT of something it feeds — one backward arrow, and a
  // layered diagram cannot be followed at all.
  for (const path of await page.locator('svg path[marker-end]').all()) {
    const d = (await path.getAttribute('d')) ?? '';
    const ends = /^M ([\d.-]+) [\d.-]+ C .*, ([\d.-]+) [\d.-]+$/.exec(d);
    expect(ends, `unparseable edge path: ${d}`).not.toBeNull();
    expect(Number(ends?.[2])).toBeGreaterThan(Number(ends?.[1]));
  }

  // No edge may stand near-vertical. A boundary crossed by many edges gets a
  // gap proportional to the tallest drop across it, so the steepest lands near
  // 45deg. Before that, the weaving lineage put nine edges through 44px while
  // they fell up to 248px — lines at 70-80deg, which read as tally marks.
  for (const path of await page.locator('svg path[marker-end]').all()) {
    const d = (await path.getAttribute('d')) ?? '';
    const ends = /^M ([\d.-]+) ([\d.-]+) .*[ ,]([\d.-]+) ([\d.-]+)$/.exec(d);
    expect(ends, `unparseable edge path: ${d}`).not.toBeNull();
    const dx = Number(ends?.[3]) - Number(ends?.[1]);
    const dy = Math.abs(Number(ends?.[4]) - Number(ends?.[2]));
    expect(Math.atan2(dy, dx) * (180 / Math.PI)).toBeLessThan(75);
  }

  // No edge may pass through a card. A lot fed into two different stages
  // produces an edge that skips columns; drawn as one sweeping curve it went
  // straight through a card between its ends, and the card it started from
  // could not be identified — "went for dyeing, but from where?". Such edges
  // now run a lane beneath the cards.
  const crossings = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-lineage-node]')].map((el) =>
      el.getBoundingClientRect(),
    );
    let hits = 0;
    for (const path of document.querySelectorAll('svg path[marker-end]')) {
      const svgPath = path as SVGPathElement;
      const total = svgPath.getTotalLength();
      const matrix = svgPath.getScreenCTM();
      if (matrix === null) continue;
      for (let i = 0; i <= 300; i++) {
        const pt = svgPath.getPointAtLength((total * i) / 300);
        const x = matrix.a * pt.x + matrix.c * pt.y + matrix.e;
        const y = matrix.b * pt.x + matrix.d * pt.y + matrix.f;
        if (cards.some((c) => x > c.left && x < c.right && y > c.top && y < c.bottom)) {
          hits++;
          break;
        }
      }
    }
    return hits;
  });
  expect(crossings, 'no lineage edge may pass through a card').toBe(0);

  // A lane edge names its source — and its TYPE, because the source can share
  // the destination's lot number and "from LOT-x" beside a card called LOT-x
  // reads as circular.
  for (const lane of await page.locator('[data-lineage-lane="true"]').allTextContents()) {
    expect(lane).toMatch(/from .+ LOT-/);
  }

  // The edges are the flow, so assert they are DRAWN and not merely present:
  // they carried a `stroke-` class tailwind never emitted, so every one
  // computed to the SVG default `stroke: none` and the diagram rendered as
  // floating labels over unconnected cards. A visibility check passed
  // throughout.
  const edgePaths = page.locator('svg path[marker-end]');
  await expect(edgePaths.first()).toBeAttached();
  for (const path of await edgePaths.all()) {
    const stroke = await path.evaluate((el) => getComputedStyle(el).stroke);
    expect(stroke).not.toBe('none');
  }

  // A consume edge carries a number the DB holds. The visible label is the
  // QUANTITY only — the full `Consumed … · waste … · at JW …` sentence is
  // ~180px against a 52px column gap, so it moved to the tooltip rather than
  // being painted over the cards on either side.
  const consumeEdges = page.locator('[data-lineage-edge="jw_consume"]');
  await expect(consumeEdges.first()).toBeVisible();
  await expect(
    consumeEdges.filter({ hasText: String(Number(chain.one_consumed)) }).first(),
  ).toBeVisible();
  await expect(consumeEdges.first()).toHaveAttribute('title', /Consumed/);

  // Per-hop invariant: issued = Σconsumed + wastage + still-at-JW. A hop that
  // satisfies it collapses into the one balanced line — four identical
  // full-width bars said only "nothing is wrong" at four rows of cost — so
  // which branch to assert comes from the DB numbers, not from the page.
  const accounted =
    Number(chain.consumed) + Number(chain.wastage) + Number(chain.still_at_jw);
  const hop = page.locator(`[data-lineage-hop="jw_out_item:${chain.out_item_id}"]`);

  if (Math.abs(accounted - Number(chain.issued)) < 0.0005) {
    await expect(hop).toHaveCount(0);
    await expect(page.locator('[data-lineage-hops-balanced]')).toContainText('balanced');
  } else {
    await expect(hop).toBeVisible();
    await expect(hop).toContainText(`consumed ${Number(chain.consumed).toFixed(3)}`);
    await expect(hop).toContainText(`waste ${Number(chain.wastage).toFixed(3)}`);
    await expect(hop).toContainText(`at JW ${Number(chain.still_at_jw).toFixed(3)}`);
    await expect(hop).toContainText(`of ${Number(chain.issued).toFixed(3)} issued`);
  }
});

test('flags a cancelled hop, and hiding it leaves the hop totals unchanged', async ({
  page,
  db,
}) => {
  // The seed ships no cancelled challan-out, and this spec must own its
  // fixtures anyway: build a private chain via the API so the assertion never
  // depends on — or mutates — a shared row.
  //
  // The chain needs BOTH legs off one purchase lot: a live dispatch that is
  // received back (which is what makes a conservation hop exist at all) and a
  // second dispatch that gets cancelled (the thing under test). 25 KG splits
  // 15 live + 10 cancelled.
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

  const dispatch = async (netWeight: number) =>
    page.request.post(`${env.API_URL}/jw-challans-out`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        date: new Date().toISOString(),
        jobWorkerId: jobWorker.id,
        jobWorkTypes: ['twisting'],
        items: [
          {
            qualityId: quality.id,
            sourceLotNumber: lotRow.lot_number,
            netWeight,
            unit: 'KG',
            placements: [{ ...placement, quantity: netWeight }],
          },
        ],
      },
    });

  // A LIVE hop first, and it must be RECEIVED, not merely dispatched.
  // `hopConservations` accumulates only `jw_consume` edges and skips any whose
  // either end is cancelled — so a chain whose one challan gets cancelled has
  // no hop at all, in either form, and the totals assertion below could never
  // be satisfied. Without this leg the test was structurally unable to observe
  // the property it names.
  const liveRes = await dispatch(15);
  expect(liveRes.status(), await liveRes.text()).toBe(201);
  const live = (await liveRes.json()) as { id: string; items: { id: string }[] };
  const liveItemId = live.items[0]?.id;
  expect(liveItemId, 'the live dispatch must carry an out-item').toBeTruthy();

  const receiveRes = await page.request.post(`${env.API_URL}/jw-challans-in`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      date: new Date().toISOString().slice(0, 10),
      yarnItems: [
        {
          qualityId: quality.id,
          netWeight: 15,
          unit: 'KG',
          sources: [
            {
              jwChallanOutItemId: liveItemId,
              consumedQty: 15,
              wastage: 0,
              stillAtJwQty: 0,
              completions: [{ jobWorkType: 'twisting', completed: true }],
            },
          ],
          placements: [{ ...placement, quantity: 15 }],
        },
      ],
    },
  });
  expect(receiveRes.status(), await receiveRes.text()).toBe(201);

  // Now the hop that gets cancelled, on the same lot, so one chain carries both.
  const challanRes = await dispatch(10);
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

  // R5: the toggle hides, it never recounts. Read whichever form the totals
  // took — a balanced hop collapses to the summary line, so keying only off
  // `[data-lineage-hop]` would skip the assertion entirely on a balanced
  // chain and this test would pass without checking anything.
  const hops = page.locator('[data-lineage-hop]');
  const summary = page.locator('[data-lineage-hops-balanced]');
  const totalsBefore =
    (await hops.count()) > 0
      ? await hops.first().textContent()
      : (await summary.count()) > 0
        ? await summary.first().textContent()
        : null;
  expect(totalsBefore, 'the chain must render hop totals in one form or the other').not.toBeNull();

  await page.getByLabel('Hide cancelled').click();
  await expect(page.locator('[data-lineage-cancelled="true"]')).toHaveCount(0);

  const totalsAfter =
    (await hops.count()) > 0
      ? await hops.first().textContent()
      : (await summary.count()) > 0
        ? await summary.first().textContent()
        : null;
  expect(totalsAfter).toBe(totalsBefore);
});

test('an unresolvable reference says so instead of drawing an empty graph', async ({ page }) => {
  await gotoAndExpect(page, '/inventory/trace?ref=NOT-A-REAL-REF-9999');
  await expect(page.getByText(/no match for/i)).toBeVisible();
  await expect(page.locator('[data-lineage-node]')).toHaveCount(0);
});
