import { expect, type Page } from '@playwright/test';

import { SENTINEL_OPTION_LABEL } from '../fixtures/copy';
import type { Db } from '../fixtures/db';
import { expectToast } from './assert';
import { clickButton, fillByLabel, selectByAriaLabel } from './forms';
import { gotoAndExpect } from './nav';

export interface SentinelPurchaseResult {
  readonly qualityId: string;
  readonly location: { readonly id: string; readonly name: string };
  readonly floor: { readonly id: string; readonly name: string };
  readonly lotNumber: string;
  readonly purchaseId: string;
}

/**
 * Drives a full yarn-purchase create flow answered with the "No shade /
 * greige" sentinel, producing real SKU-less stock (`stock_ledger.sku_id IS
 * NULL`) via the actual production path rather than a seed fixture (E3 plan
 * note). Self-contained master resolution — duplicates the vendor/quality/
 * location/floor lookups in `tests/flows/yarn-purchase.spec.ts` rather than
 * importing across spec files (plan's explicit "duplicate the few lines
 * rather than coupling the files"). Only `stock-transfer.spec.ts` needs this;
 * `yarn-purchase.spec.ts` itself drives the sentinel flow inline because it
 * also asserts the block-then-answer sequence and the wire payload.
 */
export async function createSentinelPurchase(page: Page, db: Db, quantity: number): Promise<SentinelPurchaseResult> {
  const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(vendor, 'seed must provide at least one active vendor').not.toBeNull();

  const quality = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

  const location = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM locations WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(location, 'seed must provide at least one active location').not.toBeNull();

  const floor = await db.queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM location_floors WHERE status = 'active' AND location_id = $1 ORDER BY name LIMIT 1`,
    [location!.id],
  );
  expect(floor, 'seed must provide at least one active floor for the chosen location').not.toBeNull();

  await gotoAndExpect(page, '/yarn-purchases/new');
  await selectByAriaLabel(page, 'Select vendor', `${vendor!.code} – ${vendor!.name}`);
  await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
  await selectByAriaLabel(page, 'Select SKU', SENTINEL_OPTION_LABEL);
  await fillByLabel(page, 'Quantity for line 1', String(quantity));
  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select location', `${location!.code} – ${location!.name}`);
  await selectByAriaLabel(page, 'Select floor', floor!.name);
  await fillByLabel(page, 'placement quantity 1', String(quantity));

  await clickButton(page, 'Save purchase');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
  const purchaseId = page.url().split('/').pop()!;

  const row = await db.queryOne<{ lot_number: string | null; sku_id: string | null }>(
    `SELECT lot_number, sku_id FROM stock_ledger WHERE transaction_id = $1 LIMIT 1`,
    [purchaseId],
  );
  expect(row, 'sentinel purchase must write a stock_ledger row').not.toBeNull();
  expect(row!.sku_id, 'sentinel purchase must write a SKU-less ledger row').toBeNull();
  expect(row!.lot_number).not.toBeNull();

  return {
    qualityId: quality!.id,
    location: { id: location!.id, name: location!.name },
    floor: { id: floor!.id, name: floor!.name },
    lotNumber: row!.lot_number!,
    purchaseId,
  };
}
