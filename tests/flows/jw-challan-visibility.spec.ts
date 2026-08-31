import type { Locator, Page } from '@playwright/test';

import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { getCsrfToken } from '../../support/api';
import { gotoAndExpect } from '../../support/nav';

// JW Challan Visibility & Seed Ledger Fidelity
// (docs/superpowers/specs/2026-08-31-jw-challan-visibility-design.md, plan
// Task 7). F1 gave the JW-Out detail page a real receipt rollup — it used to
// render "Close as loss" on every row (dead end: the BE 422s
// NOTHING_TO_WRITE_OFF) and substitute floor-placement status for receipt
// status under a "Status" header. F2 unified three different spellings of
// the same placement-status enum (the JW-In page used to render the raw DB
// value `fully_placed`). F3 made the JW-In receipt show its own conservation
// arithmetic and the received lot's own SKU (D1).
//
// Test 1 re-verifies the ORIGINAL symptom, not a synthetic path: the exact
// seeded pair the owner opened and asked "is this right or wrong?" —
// JWO-2026-27-003 (100kg LOT-260324-0001 + 80kg LOT-260324-0002, fully
// received) -> JWI-2026-27-003 (165kg dyed lot, 15kg wastage). Both challan
// numbers are deterministic `prisma/seed.ts` constants (formatJwChallanOutNo/
// formatJwChallanInNo with a literal sequence number), not a value any spec
// mints itself, so — unlike the suite's usual "never assert a minted
// document number" rule — looking them up is safe; only their DB *ids* are
// resolved via the `db` fixture (repo rule: never hard-code a UUID).
//
// Test 2 is the button's PRESENCE branch, on its own private fixture (repo
// rule: a spec owns its fixtures) — a purchase dispatched to a job worker
// and never received back, so `rollup.pendingAtJW` is guaranteed non-zero.
// A presence-only spec could never have caught F1a (the button rendered on
// every row, present or not); this pair is what proves the gate has two live
// branches, not just an always-hidden one.

// DataTable/detail-table cells carry no column-scoped attribute; resolve the
// column index from the live header row so the assertion survives column
// reordering. Same shape as beams.spec.ts's `cellInColumn` — kept as a
// private per-file copy per that file's own note (not yet extracted to
// support/). Safe to resolve against page-wide columnheaders here because
// each page under test has exactly one data table with the column names this
// file queries (Line items on JW-Out; Sources on JW-In — Placements uses
// disjoint column names).
async function cellInColumn(page: Page, row: Locator, columnName: string): Promise<Locator> {
  const headers = page.getByRole('columnheader');
  const idx = await headers.evaluateAll(
    (els, name) => els.findIndex((el) => el.textContent?.trim() === name),
    columnName,
  );
  expect(idx, `table must have a "${columnName}" column`).toBeGreaterThanOrEqual(0);
  return row.getByRole('cell').nth(idx);
}

test(
  'the fully-received seed pair JWO/JWI-2026-27-003 states its own receipt arithmetic, not a synthetic path',
  async ({ page, db }) => {
    // ── JW-Out: F1 symptoms a/b/c ───────────────────────────────────────────
    const out = await db.queryOne<{ id: string }>(
      `SELECT id FROM jw_challans_out WHERE challan_no = 'JWO-2026-27-003'`,
    );
    expect(out, 'seed must provide JWO-2026-27-003').not.toBeNull();

    await gotoAndExpect(page, `/jw-challans-out/${out!.id}`);
    await expect(
      page.getByRole('heading', { name: 'Job Work Challan Out JWO-2026-27-003' }),
    ).toBeVisible();

    // (a) Both source items are pendingAtJW=0 (fully received): the button
    // that used to render unconditionally on every row — a dead end the BE
    // answers with 422 NOTHING_TO_WRITE_OFF — must not render at all.
    await expect(page.getByRole('button', { name: 'Close as loss' })).toHaveCount(0);

    // (c) Header states the receipt story: 180 sent / 165 received / 15
    // wastage / 0 pending — not just the pre-existing "Total Net Wt".
    //
    // Scoped to `main`, NOT the whole page. The sidebar carries a Reports →
    // "Wastage" nav link, so an unscoped exact-text match resolves to two
    // elements and dies on strict mode — the page was right, the locator was
    // reaching outside the content. Two labels ("Total Net Wt", "Pending")
    // also repeat in the line-items table below, so `.first()` pins those to
    // the header Stat, which renders first in DOM order.
    const main = page.getByRole('main');
    await expect(
      main.getByText('Total Net Wt', { exact: true }).first().locator('..'),
    ).toContainText('180.000 kg');
    await expect(main.getByText('Received', { exact: true }).locator('..')).toContainText(
      '165.000 kg',
    );
    await expect(main.getByText('Wastage', { exact: true }).locator('..')).toContainText(
      '15.000 kg',
    );
    await expect(main.getByText('Pending', { exact: true }).first().locator('..')).toContainText(
      '0.000 kg',
    );

    // (b) The line-items column now answers receipt status under a header
    // that says what it renders — it still shows `placementStatus`, but the
    // "Status" header that read as receipt state is gone.
    await expect(page.getByRole('columnheader', { name: 'Placement' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toHaveCount(0);

    // The new Pending column reads 0 for both source items.
    const lot1Row = page.getByRole('row', { name: 'LOT-260324-0001' });
    const lot2Row = page.getByRole('row', { name: 'LOT-260324-0002' });
    await expect(await cellInColumn(page, lot1Row, 'Pending')).toHaveText('0.000 kg');
    await expect(await cellInColumn(page, lot2Row, 'Pending')).toHaveText('0.000 kg');

    // ── JW-In: F3 (the receipt reconciles on screen) + D1 (SKU) + F2 (one
    // placement-status vocabulary, never the raw DB enum) ──────────────────
    const jwi = await db.queryOne<{ id: string }>(
      `SELECT id FROM jw_challans_in WHERE entry_no = 'JWI-2026-27-003'`,
    );
    expect(jwi, 'seed must provide JWI-2026-27-003').not.toBeNull();

    await gotoAndExpect(page, `/jw-challans-in/${jwi!.id}`);
    await expect(
      page.getByRole('heading', { name: 'Job Work Challan In JWI-2026-27-003' }),
    ).toBeVisible();

    // Sources totals row: Σconsumed 180 / ΣstillAtJw 0 / Σwastage 15 — the
    // conservation identity the BE enforces, displayed rather than
    // re-asserted, bound to its own column (not merely "somewhere in the
    // row") so a column-order regression can't hide behind a substring hit.
    const totalsRow = page.getByTestId('sources-totals-row');
    await expect(await cellInColumn(page, totalsRow, 'Consumed Qty')).toHaveText('180.000 kg');
    await expect(await cellInColumn(page, totalsRow, 'Still at JW')).toHaveText('0.000 kg');
    await expect(await cellInColumn(page, totalsRow, 'Wastage')).toHaveText('15.000 kg');

    // D1 — the received lot's own colour identity, never shown before.
    await expect(page.getByTestId('sku-0')).toContainText('DYED MAROON');

    // F2 — exact label, not a prefix. `toContainText('Partial')` /
    // `.toContainText('Placed')` would still pass against "Partially
    // placed"/"Fully placed", so this asserts the badge's WHOLE text equals
    // the vocabulary word, and separately that the raw enum is gone — the
    // same trap fixed in placement.spec.ts:448 for the Place Stock queue.
    await expect(page.getByText('Fully placed', { exact: true })).toBeVisible();
    await expect(page.getByText('fully_placed', { exact: true })).toHaveCount(0);
  },
);

test(
  'renders "Close as loss" on an out-item that still has kg pending at the job worker',
  async ({ page, db }) => {
    const Q = 12;

    const masters = await db.queryOne<{
      quality_id: string;
      vendor_id: string;
      job_worker_id: string;
      location_id: string;
      floor_id: string;
    }>(
      `SELECT (SELECT id FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1)::text AS quality_id,
              (SELECT id FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1)::text        AS vendor_id,
              (SELECT id FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1)::text    AS job_worker_id,
              f.location_id::text AS location_id,
              f.id::text          AS floor_id
         FROM location_floors f
         JOIN locations l ON l.id = f.location_id AND l.status = 'active'
        WHERE f.status = 'active'
        ORDER BY l.code, f.name
        LIMIT 1`,
    );
    expect(masters, 'seed must provide the masters').not.toBeNull();

    await gotoAndExpect(page, '/jw-challans-out');
    const csrf = await getCsrfToken(page);
    const spot = {
      locationId: masters!.location_id,
      floorId: masters!.floor_id,
      quantity: Q,
      unit: 'KG',
    };

    // Own fixture (repo rule): a fresh purchase, so its balance is exactly Q
    // and unaffected by any other spec's state.
    const purchaseRes = await page.request.post(`${env.API_URL}/yarn-purchases`, {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        date: new Date().toISOString(),
        vendorId: masters!.vendor_id,
        items: [{ qualityId: masters!.quality_id, quantity: Q, unit: 'KG', placements: [spot] }],
      },
    });
    expect(purchaseRes.status(), await purchaseRes.text()).toBe(201);
    const purchase = (await purchaseRes.json()) as { id: string };
    const purchasedLot = await db.queryOne<{ lot_number: string }>(
      `SELECT lot_number FROM yarn_purchase_items WHERE purchase_id = $1 LIMIT 1`,
      [purchase.id],
    );
    expect(purchasedLot, 'the purchase must mint a lot').not.toBeNull();

    // Dispatch it all — never received against, so nothing offsets
    // pendingAtJW: sentQty stays fully outstanding.
    const outRes = await page.request.post(`${env.API_URL}/jw-challans-out`, {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        date: new Date().toISOString(),
        jobWorkerId: masters!.job_worker_id,
        jobWorkTypes: ['twisting'],
        items: [
          {
            qualityId: masters!.quality_id,
            sourceLotNumber: purchasedLot!.lot_number,
            netWeight: Q,
            unit: 'KG',
            placements: [spot],
          },
        ],
      },
    });
    expect(outRes.status(), await outRes.text()).toBe(201);
    const out = (await outRes.json()) as { id: string };

    await gotoAndExpect(page, `/jw-challans-out/${out.id}`);
    await expect(page.getByRole('button', { name: 'Close as loss' })).toBeVisible();
  },
);
