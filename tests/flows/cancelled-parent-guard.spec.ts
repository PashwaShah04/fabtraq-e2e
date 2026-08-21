import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

// Cancel is gated behind a Radix AlertDialog on yarn-purchase-detail.page.tsx:
// the trigger button AND the dialog's confirm action share the SAME
// accessible name ("Cancel purchase" — confirmLabel on <ConfirmDialog>), so a
// name-only click after the dialog opens would hit a Playwright strict-mode
// ambiguity. Scope the second click to the dialog (Radix renders
// role="alertdialog"), same pattern as weaving-dispatch.spec.ts's
// cancelDispatch. Wait for the cancel POST's own response before returning —
// the confirm click resolves synchronously in Playwright, the server-side
// ledger reversal happens inside the async POST.
async function cancelPurchase(page: import('@playwright/test').Page): Promise<void> {
  await clickButton(page, 'Cancel purchase');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        /\/yarn-purchases\/[^/]+\/cancel$/.test(new URL(res.url()).pathname) &&
        res.status() === 200,
    ),
    dialog.getByRole('button', { name: 'Cancel purchase' }).click(),
  ]);
}

test(
  'a cancelled purchase leaves the place-stock queue and cannot be placed',
  async ({ page, db }) => {
    const Q = 30;

    // Own fixture — a dedicated purchase, not "first active" anything shared
    // with other specs. Same creation shape as placement.spec.ts's unplaced
    // yarn-purchase fixture: skip "Add placement" so the item mints
    // placementStatus='pending' with 0 placements and lands in the queue.
    const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(vendor, 'seed must provide at least one active vendor').not.toBeNull();

    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

    const sku = await db.queryOne<{ id: string; code: string; name: string; shade_number: string | null }>(
      `SELECT id, code, name, shade_number FROM yarn_skus
       WHERE status = 'active' AND quality_id = $1
       ORDER BY code LIMIT 1`,
      [quality!.id],
    );
    expect(sku, 'seed must provide at least one active SKU for the chosen quality').not.toBeNull();

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
    expect(purchaseId, 'purchase id must be present in the URL').toBeTruthy();

    const item = await db.queryOne<{ id: string; lot_number: string }>(
      `SELECT id, lot_number FROM yarn_purchase_items WHERE purchase_id = $1`,
      [purchaseId],
    );
    expect(item, 'the created purchase must have exactly one item').not.toBeNull();

    await gotoAndExpect(page, '/place-stock');
    await expect(page.getByRole('row', { name: item!.lot_number })).toBeVisible();

    await gotoAndExpect(page, `/yarn-purchases/${purchaseId}`);
    await cancelPurchase(page);
    await expectToast(page, /cancelled/i);

    // Gone from the queue — listQueue filters on parent status.
    await gotoAndExpect(page, '/place-stock');
    await expect(page.getByRole('row', { name: item!.lot_number })).toHaveCount(0);

    // And the ledger never moves off the bucket position — asserted against
    // stock_ledger directly, never /inventory (a derived view that can mask
    // a ledger error). Cancel reverses the create-time bucket credit, so the
    // net balance across all positions for this lot settles back to zero.
    const netBalance = await db.ledgerBalance({ lotNumber: item!.lot_number, qualityId: quality!.id, skuId: sku!.id });
    expect(netBalance).toBeCloseTo(0, 3);
  },
);
