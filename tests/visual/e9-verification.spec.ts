import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { env } from '../../fixtures/env';
import {
  EMPTY_SKU_QUALITY_HINT,
  SENTINEL_OPTION_LABEL,
  SKU_ANSWER_REQUIRED,
} from '../../fixtures/copy';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, fillByLabelExact, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';
import { createSentinelPurchase } from '../../support/sentinel-purchase';
import { importDesignWithUnmappedColourway3 } from '../../support/design-fixtures';
import type { Db } from '../../fixtures/db';

// ---------------------------------------------------------------------------
// E9 (docs/plans/2026-07-27-sku-shade-e2e.md) — visual + accessibility +
// network verification for the SKU-shade-colour workstream. "Green tests
// prove nothing about looks" (guardian §5): this file produces committed
// screenshots under e2e-artifacts/e9/ AND a small set of assertions a
// screenshot alone can't make (DOM a11y attributes, response bodies,
// request lists).
//
// Tests in this file run in DECLARATION ORDER within one worker
// (playwright.config.ts: fullyParallel:false, workers:1) and deliberately
// build on each other's DB state (test 2 queries the SKU test 1 created)
// rather than re-deriving it — same file, same run, no reseed in between.
//
// Mutates the DB (new SKUs/quality/purchase/design) purely to have coloured
// vs colourless data to photograph — the task report notes a re-seed is
// needed afterward. Never touches seeded SKU-001/SKU-002 (qualities.spec.ts
// depends on those staying colourless; a failed touch would silently break
// that spec's "legacy SKUs show no swatch" assertion on every later run).
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.join(__dirname, '../../e2e-artifacts/e9');

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  // fullPage screenshots scroll the whole page to stitch it together, which
  // closes any open Radix popover/select (its "dismiss on scroll" listener
  // fires) — pass fullPage:false for any shot of an OPEN dropdown/listbox.
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, `${name}.png`),
    fullPage: opts.fullPage ?? true,
  });
}

async function resolvePurchaseMasters(db: Db) {
  const vendor = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM vendors WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(vendor).not.toBeNull();
  const location = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM locations WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(location).not.toBeNull();
  const floor = await db.queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM location_floors WHERE status = 'active' AND location_id = $1 ORDER BY name LIMIT 1`,
    [location!.id],
  );
  expect(floor).not.toBeNull();
  return { vendor: vendor!, location: location!, floor: floor! };
}

// Collects every request to the API origin issued while `action` runs, so a
// page-load network count is measured rather than assumed (guardian §4).
// Returns the deduped `METHOD pathname` list.
async function collectApiRequests(page: Page, action: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const onReq = (req: import('@playwright/test').Request) => {
    if (req.url().startsWith(env.API_URL)) {
      const u = new URL(req.url());
      seen.push(`${req.method()} ${u.pathname}${u.search}`);
    }
  };
  page.on('request', onReq);
  try {
    await action();
  } finally {
    page.off('request', onReq);
  }
  return [...new Set(seen)];
}

test(
  'SKU form, SKUs tab, and QualitySkuSelect swatches — visual + a11y (E9)',
  async ({ page, db }) => {
    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE code = 'QTY-001'`,
    );
    expect(quality, 'seed must provide QTY-001').not.toBeNull();

    const colouredName = codes.unique('SKU E9 Colour');
    const colourlessName = codes.unique('SKU E9 Unset');
    const HEX_INPUT = '#2E8B57';
    const HEX_STORED = '#2e8b57';

    // ── SKU form: gate on, colour chosen (screenshot 1) ─────────────────────
    await gotoAndExpect(page, `/qualities/${quality!.id}/edit`);
    await page.getByRole('tab', { name: 'SKUs' }).click();
    await fillByLabel(page, 'Name', colouredName);
    await page.getByTestId('shade-colour-gate').check();
    await fillByLabel(page, 'Shade colour hex', HEX_INPUT);
    await expect(page.getByLabel('Shade colour', { exact: true })).toHaveValue(HEX_STORED);
    await shot(page, '01-sku-form-gate-on-colour-chosen');

    await clickButton(page, 'Add SKU');
    await expectToast(page, 'SKU created');

    // A colourless sibling, never touching seeded SKU-001/002, so the tab
    // shows a coloured row NEXT TO a "colour not set" row without risking the
    // legacy-SKU regression the E2 spec depends on.
    await fillByLabel(page, 'Name', colourlessName);
    await clickButton(page, 'Add SKU');
    await expectToast(page, 'SKU created');

    // ── SKUs tab: swatch + hex row next to a "colour not set" row (screenshot 2)
    await shot(page, '02-skus-tab-swatch-and-unset-row');

    const colouredRow = page.getByRole('row', { name: colouredName });
    const colourlessRow = page.getByRole('row', { name: colourlessName });
    await expect(colouredRow.getByTestId('sku-swatch')).toHaveCount(1);
    await expect(colouredRow.getByTestId('shade-colour-unset')).toHaveCount(0);
    await expect(colourlessRow.getByTestId('shade-colour-unset')).toBeVisible();

    // Real-size element screenshot: the swatch is a 12px (h-3 w-3) chip,
    // invisible on a full-page capture — clip to just the coloured row so
    // "at real size" is actually judgeable.
    await colouredRow.screenshot({ path: path.join(ARTIFACTS_DIR, '03-sku-cell-real-size.png') });

    // a11y: the chip is aria-hidden and carries no visible text of its own —
    // the row's accessible name (used by getByRole('row', {name}) above) is
    // driven by the SKU name text node, not the swatch's `title`.
    await expect(colouredRow.getByTestId('sku-swatch')).toHaveAttribute('aria-hidden', 'true');
    await expect(colouredRow.getByTestId('sku-swatch')).toHaveText('');

    // ── QualitySkuSelect open on the purchase form (screenshot 3) ───────────
    const legacySkus = await db.queryMany<{ name: string; shade_number: string | null }>(
      `SELECT name, shade_number FROM yarn_skus WHERE code IN ('SKU-001', 'SKU-002') ORDER BY code`,
    );
    expect(legacySkus).toHaveLength(2);

    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    await page.getByTestId('sku-answer-select').click();
    await expect(page.getByRole('option', { name: colouredName, exact: true })).toBeVisible();
    await shot(page, '04-quality-sku-select-open', { fullPage: false });

    // a11y: exact-name resolution must be unique for both a coloured and a
    // colourless option (R3) — proves the swatch's title="…" never leaks into
    // the accessible name once aria-hidden removes it from the tree.
    const colouredOption = page.getByRole('option', { name: colouredName, exact: true });
    await expect(colouredOption).toHaveCount(1);
    await expect(colouredOption.getByTestId('sku-swatch')).toHaveAttribute('aria-hidden', 'true');

    for (const legacy of legacySkus) {
      const label =
        legacy.shade_number !== null && legacy.shade_number !== ''
          ? `${legacy.name} — ${legacy.shade_number}`
          : legacy.name;
      const legacyOption = page.getByRole('option', { name: label, exact: true });
      await expect(legacyOption).toHaveCount(1);
      await expect(legacyOption.getByTestId('sku-swatch')).toHaveCount(0);
    }

    // Sentinel is a distinct option, not a blank/placeholder row.
    const sentinelOption = page.getByRole('option', { name: SENTINEL_OPTION_LABEL, exact: true });
    await expect(sentinelOption).toHaveCount(1);
    await expect(sentinelOption.getByTestId('sku-swatch')).toHaveCount(0);
    await page.keyboard.press('Escape');
  },
);

test(
  'unanswered-SKU block, then real-SKU + null-SKU stock render in Inventory Positions/Lots — visual + network (E9)',
  async ({ page, db }) => {
    const quality = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM yarn_qualities WHERE code = 'QTY-001'`,
    );
    expect(quality).not.toBeNull();
    // The coloured SKU test 1 just created — no shade number, so its option
    // label is the bare name (QualitySkuSelect's "<name> — <shadeNumber>"
    // format only applies when a shade number exists).
    const sku = await db.queryOne<{ id: string; name: string; shade_color_hex: string | null }>(
      `SELECT id, name, shade_color_hex FROM yarn_skus
       WHERE quality_id = $1 AND shade_color_hex IS NOT NULL ORDER BY code DESC LIMIT 1`,
      [quality!.id],
    );
    expect(sku, 'test 1 must have created a coloured SKU under QTY-001').not.toBeNull();
    const { vendor, location, floor } = await resolvePurchaseMasters(db);
    const Q = 55;

    // ── Unanswered-SKU block, adjacent to the field (screenshot 5) ──────────
    await gotoAndExpect(page, '/yarn-purchases/new');
    await selectByAriaLabel(page, 'Select vendor', `${vendor.code} – ${vendor.name}`);
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    await fillByLabel(page, 'Quantity for line 1', String(Q));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select location', `${location.code} – ${location.name}`);
    await selectByAriaLabel(page, 'Select floor', floor.name);
    await fillByLabelExact(page, 'placement quantity 1', String(Q));

    const { delta: blockedDelta } = await db.ledgerDelta({ qualityId: quality!.id }, async () => {
      await clickButton(page, 'Save purchase');
      await expect(page.getByText(SKU_ANSWER_REQUIRED).first()).toBeVisible();
    });
    expect(blockedDelta).toBe(0);
    await shot(page, '05-unanswered-sku-block');

    // ── Complete it with the real coloured SKU ──────────────────────────────
    await selectByAriaLabel(page, 'Select SKU', sku!.name);
    const { delta: realDelta } = await db.ledgerDelta(
      { qualityId: quality!.id, skuId: sku!.id },
      async () => {
        await clickButton(page, 'Save purchase');
        await expectToast(page, /^Saved /);
        await expect(page).toHaveURL(/\/yarn-purchases\/[^/]+$/);
      },
    );
    expect(realDelta).toBeCloseTo(Q, 3);

    // ── Also mint SKU-less stock (same helper E3/E5 use), so Positions/Lots
    // show a swatch-present row next to a swatch-absent one, side by side. ──
    await createSentinelPurchase(page, db, Q);

    // ── Inventory Positions — network spot-check ────────────────────────────
    // Finding: inventory-positions.page.tsx is a bespoke breakdown component
    // (In factory / At job workers / Awaiting placement sections), NOT a
    // DataTable driven by columns.tsx — it never got a ColourSwatch cell
    // (only getSummaryColumns [/inventory] and getLotColumns [/inventory/lots]
    // did, per fe@74fd80f). Positions already shows one fixed SKU (named in
    // its own header, "<quality> · <sku>"), so a repeated per-row swatch
    // would be redundant — plausibly deliberate, but flagged to the lead
    // rather than assumed. No swatch screenshot/a11y check here; the network
    // spot-check the task asked for still runs (trivially zero SKU lookups,
    // since there's no swatch feature on this page to prove zero-extra-fetch
    // about).
    const positionsRequests = await collectApiRequests(page, async () => {
      await gotoAndExpect(page, `/inventory/positions?qualityId=${quality!.id}&skuId=${sku!.id}`);
      await expect(page.getByText(sku!.name).first()).toBeVisible();
    });
    const positionsSkuLookups = positionsRequests.filter((r) => /\/(yarn-)?skus(\/|\?|$)/.test(r));
    expect(
      positionsSkuLookups,
      `no per-row SKU lookups; requests were: ${positionsRequests.join(', ')}`,
    ).toHaveLength(0);

    // ── Inventory Overview (/inventory) — visual + network (guardian §4) ───
    // This is the page that actually rides skuShadeColorHex on getSummaryColumns
    // (fe@74fd80f) and, unlike Positions, lists every SKU of the quality
    // together — the real-SKU (swatch) and null-SKU (no swatch) rows appear
    // side by side in one screenshot.
    const overviewResponsePromise = page.waitForResponse(
      (res) =>
        res.url().startsWith(`${env.API_URL}/inventory/summary?`) && res.request().method() === 'GET',
    );
    const overviewRequests = await collectApiRequests(page, async () => {
      await gotoAndExpect(page, `/inventory?qualityId=${quality!.id}&pageSize=200`);
      await expect(page.getByText(sku!.name).first()).toBeVisible();
    });
    const overviewBody = (await overviewResponsePromise).json() as Promise<{
      items: Array<{ skuId: string | null; skuShadeColorHex: string | null }>;
    }>;
    const overviewRows = (await overviewBody).items;
    const realSkuRow = overviewRows.find((r) => r.skuId === sku!.id);
    expect(realSkuRow, 'the real-SKU stock item must be in the already-fetched payload').toBeDefined();
    expect(realSkuRow!.skuShadeColorHex).toBe(sku!.shade_color_hex);
    const nullSkuRow = overviewRows.find((r) => r.skuId === null);
    expect(nullSkuRow, 'the sentinel purchase must have produced a null-SKU stock item too').toBeDefined();

    const overviewSkuLookups = overviewRequests.filter((r) => /\/(yarn-)?skus(\/|\?|$)/.test(r));
    expect(
      overviewSkuLookups,
      `no per-row SKU lookups; requests were: ${overviewRequests.join(', ')}`,
    ).toHaveLength(0);

    await shot(page, '06-inventory-overview-swatch-rows');
    const swatches = page.getByTestId('sku-swatch');
    await expect(swatches.first()).toHaveAttribute('aria-hidden', 'true');

    // ── Inventory Lots — same visual + network pattern ──────────────────────
    const lotsResponsePromise = page.waitForResponse(
      (res) => res.url().startsWith(`${env.API_URL}/inventory/lots?`) && res.request().method() === 'GET',
    );
    const lotsRequests = await collectApiRequests(page, async () => {
      await gotoAndExpect(page, `/inventory/lots?qualityId=${quality!.id}&pageSize=200`);
      await expect(page.getByText(sku!.name).first()).toBeVisible();
    });
    const lotsBody = (await lotsResponsePromise).json() as Promise<{
      items: Array<{ skuId: string | null; skuShadeColorHex: string | null }>;
    }>;
    const lotsRows = (await lotsBody).items;
    const realSkuLotRow = lotsRows.find((r) => r.skuId === sku!.id);
    expect(realSkuLotRow, 'the real-SKU lot must be in the already-fetched payload').toBeDefined();
    expect(realSkuLotRow!.skuShadeColorHex).toBe(sku!.shade_color_hex);

    const lotsSkuLookups = lotsRequests.filter((r) => /\/(yarn-)?skus(\/|\?|$)/.test(r));
    expect(lotsSkuLookups, `no per-row SKU lookups; requests were: ${lotsRequests.join(', ')}`).toHaveLength(0);

    await shot(page, '07-inventory-lots-swatch-rows');

    // Printed for the task report — deduped request lists prove the claim
    // rather than asserting an arbitrary count.
    console.log('[E9] /inventory/positions requests:', positionsRequests);
    console.log('[E9] /inventory (overview) requests:', overviewRequests);
    console.log('[E9] /inventory/lots requests:', lotsRequests);
  },
);

test('D5 empty-SKU-quality hint is advisory, not a dead end — visual (E9)', async ({ page, db }) => {
  // Pattern: sku-empty-quality.spec.ts's createZeroSkuQuality, duplicated
  // (not imported — same "duplicate the few lines" precedent as
  // support/sentinel-purchase.ts) rather than coupling two spec files.
  const name = codes.qualityName();
  await gotoAndExpect(page, '/qualities/new');
  await fillByLabel(page, 'Name', name);
  await fillByLabel(page, 'HSN Code', '52051200');
  await clickButton(page, 'Create Quality');
  await expectToast(page, 'Quality created');
  await expect(page).toHaveURL(/\/qualities\/[^/]+\/edit/);
  const match = page.url().match(/\/qualities\/([^/]+)\/edit/);
  if (!match) throw new Error(`unexpected quality edit URL: ${page.url()}`);
  const quality = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE id = $1`,
    [match[1]],
  );
  expect(quality).not.toBeNull();

  await gotoAndExpect(page, '/yarn-purchases/new');
  await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
  const skuTrigger = page.locator('[aria-label="Select SKU"]');

  // The hint is a plain <p> SIBLING of the select (QualitySkuSelect.tsx),
  // not content inside the open listbox — it shows as soon as the quality is
  // picked, dropdown closed. Screenshot it in that state first: with the
  // dropdown OPEN, the floating listbox overlay sits on top of exactly where
  // this paragraph renders, so a same-shot capture would show the hint
  // visually covered even though Playwright still reports it DOM-visible.
  await expect(page.getByText(EMPTY_SKU_QUALITY_HINT)).toBeVisible();
  await shot(page, '08a-d5-hint-dropdown-closed');

  await skuTrigger.click();
  const listbox = page.getByRole('listbox');
  const sentinelOption = listbox.getByRole('option', { name: SENTINEL_OPTION_LABEL });
  await expect(sentinelOption).toBeVisible();
  await expect(sentinelOption).not.toHaveAttribute('aria-disabled', 'true');
  // D5 scopes an inline "create SKU here" control out of v1 (rev 2) — assert
  // its continued absence so the hint never quietly grows one unreviewed.
  await expect(page.getByRole('button', { name: /add sku/i })).toHaveCount(0);
  await shot(page, '08b-d5-hint-sentinel-selectable-dropdown-open', { fullPage: false });
});

test('design detail — unmapped-shades badge — visual (E9)', async ({ page, db }) => {
  const quality = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(quality).not.toBeNull();
  const sku = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_skus WHERE status = 'active' AND quality_id = $1 ORDER BY code LIMIT 1`,
    [quality!.id],
  );
  expect(sku).not.toBeNull();

  const designName = `E2E E9 Design ${Date.now()}`;
  await importDesignWithUnmappedColourway3(page, designName, quality!, sku!);
  await expect(page.getByRole('heading', { name: designName })).toBeVisible();
  await expect(page.getByText(/unmapped shade/).first()).toBeVisible();
  await shot(page, '09-design-detail-unmapped-shades-badge');
});
