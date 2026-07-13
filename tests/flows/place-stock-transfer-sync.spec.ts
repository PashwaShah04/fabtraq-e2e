import type { Page } from '@playwright/test';

import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, selectByLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

// ---------------------------------------------------------------------------
// Chained tripwire spec (design doc §3 item 7,
// docs/superpowers/specs/2026-07-13-place-stock-ledger-sync-design.md).
//
// This is the cross-feature test that was MISSING before the sync bug shipped:
// Place Stock (reads the `placements` table) and Stock Transfer (writes
// `stock_ledger` only) were built and tested in separate workstreams, so
// nothing ever re-opened the Place Stock editor after a transfer to check the
// two screens still agreed. §1's canonical statement: `stock_ledger` is the
// single source of truth for where stock currently sits; `placements` is a
// put-away *event record*, never a balance store.
//
// Chain: purchase (unplaced) → place 100 KG on Floor A → reopen editor (floor
// excluded from new-placement dropdown, name resolved, panel shows Floor A) →
// transfer 60 KG Floor A→Floor B → reopen editor (panel now A=40/B=60, Floor-A
// row flagged stale with no inline edit form) → API-level guards (duplicate
// floor rejected, editing the stale placement rejected) → final ledger truth.
// ---------------------------------------------------------------------------

/**
 * Reads the `fabtraq_csrf` double-submit cookie from the browser context and
 * extracts the unsigned token, exactly as the FE's axios interceptor does
 * (fabtraq-fe/src/shared/api/csrf.ts: csrf-csrf signs the cookie as
 * `<token>|<hmac>`, URL-encoded — the header must carry only the token).
 * Needed because these two guard checks (step 6) have no natural UI path:
 * the FE now hard-prevents selecting an already-placed floor in the dropdown
 * (8df5315) and replaces the stale row's edit form with a Stock Transfer link
 * (204d2d5), so the only way to exercise the BE guards directly is the API,
 * via `page.request` (shares the authenticated context's cookies, bypasses
 * the browser's same-origin fetch restrictions the app itself is subject to).
 */
async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrfCookie = cookies.find((c) => c.name === 'fabtraq_csrf');
  expect(csrfCookie, 'fabtraq_csrf cookie must be present for an authenticated session').toBeDefined();
  const decoded = decodeURIComponent(csrfCookie!.value);
  const token = decoded.split('|')[0] ?? '';
  expect(token.length, 'CSRF cookie must decode to a non-empty token').toBeGreaterThan(0);
  return token;
}

test(
  'place → transfer → reopen Place Stock: current-floor panel and stale badge track the ledger, duplicate/edit guards hold',
  async ({ page, db }) => {
    const Q = 100;
    const TRANSFER_QTY = 60;
    const REMAINING_AFTER_TRANSFER = Q - TRANSFER_QTY; // 40

    // -----------------------------------------------------------------------
    // Seed lookups — everything derived from the DB, nothing hardcoded
    // (seed is relied on only for read-only masters, per repo convention).
    // -----------------------------------------------------------------------
    const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(vendor, 'seed must provide at least one active vendor').not.toBeNull();

    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

    const sku = await db.queryOne<{ id: string; name: string; shade_number: string | null }>(
      `SELECT id, name, shade_number FROM yarn_skus
       WHERE status = 'active' AND quality_id = $1
       ORDER BY code LIMIT 1`,
      [quality!.id],
    );
    expect(sku, 'seed must provide at least one active SKU for the chosen quality').not.toBeNull();

    // A location with >=2 active floors (Floor A / Floor B) — the transfer
    // destination and the "new placement" dropdown-exclusion check both need
    // a genuine second floor under the SAME location.
    const location = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT l.id, l.code, l.name
       FROM locations l
       JOIN location_floors f ON f.location_id = l.id AND f.status = 'active'
       WHERE l.status = 'active'
       GROUP BY l.id, l.code, l.name
       HAVING COUNT(f.id) >= 2
       LIMIT 1`,
    );
    expect(location, 'seed must provide a location with at least 2 active floors').not.toBeNull();

    const floors = await db.queryOne<{ floor_a_id: string; floor_a_name: string; floor_b_id: string; floor_b_name: string }>(
      `SELECT a.id AS floor_a_id, a.name AS floor_a_name, b.id AS floor_b_id, b.name AS floor_b_name
       FROM location_floors a
       JOIN location_floors b ON b.location_id = a.location_id AND b.id <> a.id AND b.status = 'active'
       WHERE a.location_id = $1 AND a.status = 'active'
       ORDER BY a.name, b.name
       LIMIT 1`,
      [location!.id],
    );
    expect(floors, 'must resolve two distinct active floors on the chosen location').not.toBeNull();
    const floorA = { id: floors!.floor_a_id, name: floors!.floor_a_name };
    const floorB = { id: floors!.floor_b_id, name: floors!.floor_b_name };

    // -----------------------------------------------------------------------
    // Step 1: purchase Q with ZERO placements (mints a 'pending' item).
    // -----------------------------------------------------------------------
    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Select vendor', `${vendor!.code} – ${vendor!.name}`);
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    const skuOptionLabel =
      sku!.shade_number !== null && sku!.shade_number !== '' ? `${sku!.name} — ${sku!.shade_number}` : sku!.name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await fillByLabel(page, 'Quantity for line 1', String(Q));

    await clickButton(page, 'Save purchase');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
    const purchaseId = page.url().split('/').pop();

    const item = await db.queryOne<{ id: string; lot_number: string; placement_status: string }>(
      `SELECT id, lot_number, placement_status FROM yarn_purchase_items WHERE purchase_id = $1`,
      [purchaseId],
    );
    expect(item, 'the created purchase must have exactly one item').not.toBeNull();
    expect(item!.placement_status).toBe('pending');

    const bucketKey = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: null,
      floorId: null,
      jobWorkerId: null,
    };
    const floorAKey = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: location!.id,
      floorId: floorA.id,
      jobWorkerId: null,
    };
    const floorBKey = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: location!.id,
      floorId: floorB.id,
      jobWorkerId: null,
    };

    // -----------------------------------------------------------------------
    // Step 2: place ALL of Q on Floor A via the queue/editor. Assert the
    // ledger move-pair against stock_ledger — never /inventory.
    // -----------------------------------------------------------------------
    await gotoAndExpect(page, '/place-stock');
    await page.getByRole('row', { name: item!.lot_number }).click();
    await expect(page).toHaveURL(new RegExp(`/place-stock/yarn_purchase_item/${item!.id}$`));

    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floorA.name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    const { delta: bucketDelta } = await db.ledgerDelta(bucketKey, async () => {
      await clickButton(page, 'Save Placements');
      await expectToast(page, 'Stock placed successfully');
      await expect(page).toHaveURL(/\/place-stock$/);
    });
    expect(bucketDelta).toBeCloseTo(-Q, 3);
    expect(await db.ledgerBalance(bucketKey)).toBeCloseTo(0, 3);
    expect(await db.ledgerBalance(floorAKey)).toBeCloseTo(Q, 3);

    const placement = await db.queryOne<{ id: string; placement_status: string }>(
      `SELECT p.id, i.placement_status
       FROM placements p
       JOIN yarn_purchase_items i ON i.id = p.source_item_id
       WHERE p.source_type = 'yarn_purchase_item' AND p.source_item_id = $1`,
      [item!.id],
    );
    expect(placement, 'the Save Placements call must have written a placements row').not.toBeNull();
    expect(placement!.placement_status).toBe('fully_placed');
    const placementIdA = placement!.id;

    // -----------------------------------------------------------------------
    // Step 3: reopen the editor (item is fully_placed → no longer in the
    // queue list, so navigate straight to the CF-6 detail route by id, which
    // resolves regardless of placementStatus).
    // -----------------------------------------------------------------------
    await gotoAndExpect(page, `/place-stock/yarn_purchase_item/${item!.id}`);

    // (a) Floor A is hard-excluded from the NEW-placement floor dropdown
    // (FE commit 8df5315: excludeFloorIds = existing placements' floorIds).
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await page.locator('[aria-label="Select floor"]').click();
    await expect(page.getByRole('option', { name: floorA.name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: floorB.name, exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); // close without picking — this draft row is never submitted

    // (b) Floor shown by NAME, not the raw floorId UUID (FE commit 8df5315).
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const editableRow = page.locator('[aria-label="existing unlocked placement"]');
    await expect(editableRow).toBeVisible();
    await expect(editableRow).toContainText(location!.name);
    await expect(editableRow).toContainText(floorA.name);
    const editableRowText = (await editableRow.textContent()) ?? '';
    expect(editableRowText).not.toMatch(uuidPattern);

    // (c) "Currently on floors" panel (ledger-derived, FE commit 204d2d5)
    // shows Floor A at the full 100.000.
    const currentFloorsPanel = page.locator('[aria-label="currently on floors"]');
    await expect(currentFloorsPanel).toBeVisible();
    const floorARowBeforeTransfer = currentFloorsPanel.locator('li', { hasText: floorA.name });
    await expect(floorARowBeforeTransfer).toContainText(`${Q.toFixed(3)}`);

    // -----------------------------------------------------------------------
    // Step 4: transfer TRANSFER_QTY off Floor A onto Floor B via the real
    // Stock Transfer form (writes stock_ledger ONLY — placements untouched,
    // which is exactly the root cause this spec tripwires).
    // -----------------------------------------------------------------------
    await gotoAndExpect(page, '/stock-transfers/new');
    await selectByLabel(page, 'From Location', `${location!.name}`);
    await selectByLabel(page, 'From Floor', floorA.name);
    await selectByAriaLabel(page, 'Pick stock', item!.lot_number);
    await selectByLabel(page, 'To Location', `${location!.name}`);
    await selectByLabel(page, 'To Floor', floorB.name);
    await fillByLabel(page, 'Quantity', String(TRANSFER_QTY));

    const { delta: floorADelta } = await db.ledgerDelta(floorAKey, async () => {
      await clickButton(page, 'Create Transfer');
      await expectToast(page, 'Stock transfer created');
      await expect(page).toHaveURL(/\/stock-transfers$/);
    });
    expect(floorADelta).toBeCloseTo(-TRANSFER_QTY, 3);
    expect(await db.ledgerBalance(floorAKey)).toBeCloseTo(REMAINING_AFTER_TRANSFER, 3);
    expect(await db.ledgerBalance(floorBKey)).toBeCloseTo(TRANSFER_QTY, 3);

    // -----------------------------------------------------------------------
    // Step 5: reopen the editor — the two screens must now agree with the
    // ledger, not with the stale placements row.
    // -----------------------------------------------------------------------
    await gotoAndExpect(page, `/place-stock/yarn_purchase_item/${item!.id}`);

    // (a) Panel shows A=40.000, B=60.000 (ledger-derived, not placements-derived).
    const panelAfterTransfer = page.locator('[aria-label="currently on floors"]');
    await expect(panelAfterTransfer).toBeVisible();
    await expect(panelAfterTransfer.locator('li', { hasText: floorA.name })).toContainText(
      `${REMAINING_AFTER_TRANSFER.toFixed(3)}`,
    );
    await expect(panelAfterTransfer.locator('li', { hasText: floorB.name })).toContainText(
      `${TRANSFER_QTY.toFixed(3)}`,
    );

    // (b) The Floor-A placement row (recorded qty 100 > ledger balance 40)
    // is flagged stale: badge visible, inline edit form GONE, Stock Transfer
    // link present (FE commit 204d2d5).
    const staleRow = page.locator('[aria-label="existing unlocked placement"]');
    await expect(staleRow).toBeVisible();
    await expect(staleRow).toContainText('Stock moved — no longer (fully) on this floor');
    await expect(staleRow.locator(`[aria-label="existing placement quantity ${placementIdA}"]`)).toHaveCount(0);
    await expect(staleRow.getByRole('link', { name: /Stock Transfer/ })).toBeVisible();

    // -----------------------------------------------------------------------
    // Step 6: API-level guards. The FE now hard-prevents both actions
    // (duplicate floor is unselectable; the stale row has no edit form), so
    // these must be driven directly against the API to prove the BE enforces
    // the invariant independently of the FE — the point of "not a patch fix".
    // -----------------------------------------------------------------------
    const csrfToken = await getCsrfToken(page);

    // (a) A second placement row for the SAME item on the SAME (already-
    // occupied) Floor A → 422 DUPLICATE_FLOOR_PLACEMENT
    // (fabtraq-be place-stock.service.ts addPlacements, step 2b).
    const duplicateRes = await page.request.post(`${env.API_URL}/placements`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        sourceType: 'yarn_purchase_item',
        sourceItemId: item!.id,
        placements: [{ locationId: location!.id, floorId: floorA.id, quantity: 1, unit: 'KG' }],
      },
    });
    expect(duplicateRes.status()).toBe(422);
    const duplicateBody = (await duplicateRes.json()) as { code?: string; details?: { code?: string } };
    expect(duplicateBody.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(duplicateBody.details?.code).toBe('DUPLICATE_FLOOR_PLACEMENT');

    // (b) Editing the stale placement's quantity beyond what Floor A can
    // still cover (40 remaining, asking to keep 50) → 422
    // INSUFFICIENT_BALANCE_AT_FLOOR (fabtraq-be place-stock.service.ts
    // editPlacement, step 4b).
    const editRes = await page.request.patch(`${env.API_URL}/placements/${placementIdA}`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { quantity: 50 },
    });
    expect(editRes.status()).toBe(422);
    const editBody = (await editRes.json()) as { code?: string; details?: { code?: string } };
    expect(editBody.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(editBody.details?.code).toBe('INSUFFICIENT_BALANCE_AT_FLOOR');

    // -----------------------------------------------------------------------
    // Step 7: final ledger truth — lot totals conserved, nothing negative.
    // -----------------------------------------------------------------------
    expect(await db.ledgerBalance(bucketKey)).toBeCloseTo(0, 3);
    expect(await db.ledgerBalance(floorAKey)).toBeCloseTo(REMAINING_AFTER_TRANSFER, 3);
    expect(await db.ledgerBalance(floorBKey)).toBeCloseTo(TRANSFER_QTY, 3);

    const minBalance = await db.queryOne<{ min_bal: string | null }>(
      `SELECT MIN(bal) AS min_bal FROM (
         SELECT floor_id, SUM(in_quantity - out_quantity) AS bal
         FROM stock_ledger
         WHERE lot_number = $1
         GROUP BY floor_id
       ) grouped`,
      [item!.lot_number],
    );
    expect(Number(minBalance?.min_bal ?? 0)).toBeGreaterThanOrEqual(-0.001);
  },
);

// ---------------------------------------------------------------------------
// B-013 regression (fixed 2026-07-14, fabtraq-be commit a9b320d): editPlacement
// used to scan ALL non-cancelled stock_ledger rows at the placement's own
// (transactionType, old location, old floor) and cancel+rewrite every match
// on EVERY edit. A cancellation row carries no marker distinguishing it from
// a fresh forward row other than notes='cancellation', so a prior edit's own
// rewritten row matched the very same scan on the NEXT edit — each edit
// rewrote one row more than the last (1 -> 2 -> 4 -> 8...), duplicating the
// floor leg geometrically while the placement row itself stayed correct
// (confirmed live: one item had 33 ledger rows after 4 edits, floor net 900
// vs a placement row of 400). The BE integration suite never exercised
// REPEATED edits to the same placement — that's the gap this spec closes at
// the UI level, driving the exact user-facing path (the inline quantity
// input + Save button on an unlocked, non-stale placement row) rather than
// hitting the API directly.
// ---------------------------------------------------------------------------

test(
  'editing an unlocked, non-stale placement TWICE in a row keeps stock_ledger conservation at every step (B-013)',
  async ({ page, db }) => {
    const Q = 200;
    const EDIT_1 = Q - 10; // 190
    const EDIT_2 = Q - 5; // 195

    const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(vendor, 'seed must provide at least one active vendor').not.toBeNull();

    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

    const sku = await db.queryOne<{ id: string; name: string; shade_number: string | null }>(
      `SELECT id, name, shade_number FROM yarn_skus
       WHERE status = 'active' AND quality_id = $1
       ORDER BY code LIMIT 1`,
      [quality!.id],
    );
    expect(sku, 'seed must provide at least one active SKU for the chosen quality').not.toBeNull();

    const location = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM locations WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(location, 'seed must provide at least one active location').not.toBeNull();

    const floor = await db.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM location_floors WHERE status = 'active' AND location_id = $1
       ORDER BY name LIMIT 1`,
      [location!.id],
    );
    expect(floor, 'seed must provide at least one active floor for the chosen location').not.toBeNull();

    // Purchase Q with ZERO placements (mints a 'pending' item).
    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Select vendor', `${vendor!.code} – ${vendor!.name}`);
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    const skuOptionLabel =
      sku!.shade_number !== null && sku!.shade_number !== '' ? `${sku!.name} — ${sku!.shade_number}` : sku!.name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await fillByLabel(page, 'Quantity for line 1', String(Q));

    await clickButton(page, 'Save purchase');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
    const purchaseId = page.url().split('/').pop();

    const item = await db.queryOne<{ id: string; lot_number: string }>(
      `SELECT id, lot_number FROM yarn_purchase_items WHERE purchase_id = $1`,
      [purchaseId],
    );
    expect(item, 'the created purchase must have exactly one item').not.toBeNull();

    // Place ALL of Q on the floor — item becomes fully_placed; the resulting
    // placement is unlocked (no downstream JW-Out) and not stale (no
    // transfer has moved anything off this floor).
    await gotoAndExpect(page, '/place-stock');
    await page.getByRole('row', { name: item!.lot_number }).click();
    await expect(page).toHaveURL(new RegExp(`/place-stock/yarn_purchase_item/${item!.id}$`));

    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
    await selectByAriaLabel(page, 'Select floor', floor!.name);
    await fillByLabel(page, 'placement quantity 1', String(Q));
    await clickButton(page, 'Save Placements');
    await expectToast(page, 'Stock placed successfully');
    await expect(page).toHaveURL(/\/place-stock$/);

    const placement = await db.queryOne<{ id: string }>(
      `SELECT id FROM placements WHERE source_type = 'yarn_purchase_item' AND source_item_id = $1`,
      [item!.id],
    );
    expect(placement, 'must have exactly one placement row for this item').not.toBeNull();
    const placementId = placement!.id;

    const floorKey = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: location!.id,
      floorId: floor!.id,
      jobWorkerId: null,
    };
    const bucketKey = {
      lotNumber: item!.lot_number,
      qualityId: quality!.id,
      skuId: sku!.id,
      locationId: null,
      floorId: null,
      jobWorkerId: null,
    };

    expect(await db.ledgerBalance(floorKey)).toBeCloseTo(Q, 3);
    expect(await db.ledgerBalance(bucketKey)).toBeCloseTo(0, 3);

    // Reopen the editor — the item is fully_placed so it's no longer in the
    // queue list; navigate straight to the CF-6 detail route by id, which
    // resolves regardless of placementStatus.
    await gotoAndExpect(page, `/place-stock/yarn_purchase_item/${item!.id}`);

    const row = page.locator('[aria-label="existing unlocked placement"]');
    await expect(row).toBeVisible();
    // Sanity: this row must be editable (unlocked, not stale) — the inline
    // quantity input must be present, not a "Stock moved" badge / Stock
    // Transfer link.
    const qtyInput = row.locator(`[aria-label="existing placement quantity ${placementId}"]`);
    await expect(qtyInput).toBeVisible();

    // Both edits submit to the SAME endpoint with the SAME success toast text
    // ("Placement updated") — waiting on the toast is a race: if the first
    // edit's toast hasn't auto-dismissed yet when the second edit fires,
    // `expectToast` matches the STALE toast from edit #1 instantly, and the
    // DB gets queried before edit #2's PATCH has actually committed. Wait
    // deterministically on the PATCH response instead (registered before the
    // click, per Playwright's recommended Promise.all([waitForResponse,
    // action]) pattern, so the listener can't miss a response that resolves
    // faster than the await chain) — AND match on the request's OWN body
    // (the exact quantity just submitted), not just method+url+status: two
    // consecutive edits share the same method/URL, and axios's CSRF-retry
    // interceptor (fabtraq-fe client.ts) can re-issue a request behind the
    // scenes, so a looser predicate can resolve against a stale/retried
    // response for a DIFFERENT edit's payload — exactly the kind of race
    // this wait is meant to eliminate, not reintroduce in a new shape.
    const waitForPlacementPatch = (expectedQuantity: number) =>
      page.waitForResponse((res) => {
        if (res.request().method() !== 'PATCH') return false;
        if (!res.url().includes(`/placements/${placementId}`)) return false;
        if (res.status() !== 200) return false;
        const body = res.request().postDataJSON() as { quantity?: number } | null;
        return body?.quantity === expectedQuantity;
      });

    // ---- Edit #1: Q -> EDIT_1 ----
    await qtyInput.fill(String(EDIT_1));
    await Promise.all([
      waitForPlacementPatch(EDIT_1),
      row.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);

    expect(await db.ledgerBalance(floorKey)).toBeCloseTo(EDIT_1, 3);
    expect(await db.ledgerBalance(bucketKey)).toBeCloseTo(Q - EDIT_1, 3);

    // ---- Edit #2: EDIT_1 -> EDIT_2 — the REPEATED edit that B-013 broke ----
    await qtyInput.fill(String(EDIT_2));
    await Promise.all([
      waitForPlacementPatch(EDIT_2),
      row.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);

    expect(await db.ledgerBalance(floorKey)).toBeCloseTo(EDIT_2, 3);
    expect(await db.ledgerBalance(bucketKey)).toBeCloseTo(Q - EDIT_2, 3);

    // Whole-lot conservation holds after both edits (bucket + floor sum back
    // to the original Q — nothing was consumed downstream in this test).
    expect(await db.ledgerBalance({ lotNumber: item!.lot_number })).toBeCloseTo(Q, 3);

    // Row-count guard mirroring the BE integration assertion (place-stock-
    // ledger-wiring.service.test.ts): linear growth — 1 baseline (from
    // addPlacements) + 1 per edit = 3 — NOT the geometric 1 -> 2 -> 4 the old
    // scan-cancel-rewrite produced. This is the assertion that would have
    // caught B-013 at the UI level.
    const floorRowCount = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM stock_ledger
       WHERE transaction_type = 'placement' AND location_id = $1 AND floor_id = $2
         AND transaction_item_id = $3`,
      [location!.id, floor!.id, item!.id],
    );
    expect(Number(floorRowCount?.n ?? '0')).toBe(3);
  },
);
