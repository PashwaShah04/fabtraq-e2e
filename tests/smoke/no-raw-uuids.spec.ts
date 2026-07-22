import type { Page } from '@playwright/test';

import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';

// ---------------------------------------------------------------------------
// Durable "no raw UUIDs rendered anywhere" tripwire.
//
// Origin: run ad-hoc 2026-07-14 across 44 pages, surfaced 1 real offender
// (fixed in fabtraq-fe). Raw UUIDs leaking into the UI are a recurring class
// of bug in this app (see the ledger-sync design doc's root cause (b): FE
// components rendering `placement.floorId` directly instead of resolving a
// name) — this spec makes that check permanent instead of ad-hoc.
//
// Design:
// - ONE test, a serial loop over every static route plus one discovered
//   detail/edit page per distinct route "shape" — reads as a single sweep,
//   and its failure report aggregates every offending page in one run
//   (via expect.soft, so one bad page doesn't abort the rest of the sweep).
// - Tolerant of whatever data earlier specs in the same serial run leave
//   behind: it asserts the ABSENCE of any UUID-looking string anywhere in
//   visible text or non-hidden input/textarea values, never the presence of
//   specific rows/content, so it can't be broken by legitimate data drift
//   the way an absolute-count assertion could (see the B-013 spec fix for
//   exactly that failure mode).
// ---------------------------------------------------------------------------

// Used only for href shape-matching (collectUuidHrefPaths/shapeOf) — a
// route path can only ever contain a FULL id, never the app's truncated
// display fallback, so this stays full-UUID-only. The rendered-content
// scan (findRawUuids) uses a wider pattern that also catches truncation;
// see the comment inside that function for why.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_RE_GLOBAL = new RegExp(UUID_RE.source, 'gi');

/** Every static route in the FE router (src/app/router.tsx), protected-app-shell side. */
const STATIC_ROUTES = [
  '/',
  '/vendors',
  '/vendors/new',
  '/qualities',
  '/qualities/new',
  '/job-workers',
  '/job-workers/new',
  '/transporters',
  '/transporters/new',
  '/locations',
  '/locations/new',
  '/yarn-purchases',
  '/yarn-purchases/new',
  '/jw-challans-out',
  '/jw-challans-out/new',
  '/jw-challans-in',
  '/jw-challans-in/new',
  '/jw-challans-in/new/yarn',
  '/jw-challans-in/new/dyed',
  '/jw-challans-in/new/beam',
  '/inventory',
  '/inventory/lots',
  '/inventory/positions',
  '/beams',
  '/designs',
  '/designs/new',
  '/beam-receipts',
  '/beam-receipts/new',
  '/place-stock',
  '/stock-transfers',
  '/stock-transfers/new',
  '/audit-log',
] as const;

interface UuidHit {
  /** Truncated snippet of the offending text/value, for the failure message. */
  context: string;
  /** Lowercased tag name of the element the text/value was found in. */
  tag: string;
}

/**
 * Walks the live DOM in-browser: visible text nodes (skipping
 * display:none/visibility:hidden ancestors and script/style/noscript
 * content, which isn't rendered to the user) plus the `.value` of any
 * non-hidden, non-hidden-styled input/textarea. Returns every match of a
 * raw id — full UUID or the app's truncated `slice(0,8)+'…'` display
 * fallback — found, each with enough context to locate it from the failure
 * message alone.
 */
async function findRawUuids(page: Page): Promise<UuidHit[]> {
  return page.evaluate(() => {
    // Full UUID OR 8 hex chars immediately followed by the ellipsis char
    // (the app's slice(0,8)+'…' truncated-id signature) — both are equally
    // a "raw id leaked instead of a resolved name" bug, kept as one
    // alternation. Defined inline (not at module scope) because
    // page.evaluate() runs in the browser and can't close over the outer
    // module's values.
    const uuidRe =
      /(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})|(?:\b[0-9a-f]{8}\b…)/i;
    const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
    const hits: { context: string; tag: string }[] = [];

    const isVisible = (el: Element): boolean => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null) {
      const text = node.textContent ?? '';
      if (uuidRe.test(text)) {
        const parent = node.parentElement;
        if (parent !== null && !skipTags.has(parent.tagName) && isVisible(parent)) {
          hits.push({ context: text.trim().slice(0, 200), tag: parent.tagName.toLowerCase() });
        }
      }
      node = walker.nextNode();
    }

    const fields = document.querySelectorAll('input, textarea');
    for (const field of Array.from(fields)) {
      if (field instanceof HTMLInputElement && field.type === 'hidden') continue;
      if (!isVisible(field)) continue;
      const value = (field as HTMLInputElement | HTMLTextAreaElement).value ?? '';
      if (uuidRe.test(value)) {
        hits.push({ context: value.slice(0, 200), tag: field.tagName.toLowerCase() });
      }
    }

    return hits;
  });
}

/**
 * Collects same-origin, UUID-bearing pathnames from every `<a href>` on the
 * current page. Several list pages in this app render row navigation as
 * real `<Link>`s (qualities/locations/job-workers/transporters/designs/
 * beam-receipts/beams/jw-challans-in — and inventory's origin-document
 * links), which is what this discovers. Others (vendors, yarn-purchases,
 * jw-challans-out, the place-stock queue, stock-transfers) navigate rows
 * programmatically via `useNavigate()` with no real anchor to scrape — those
 * shapes are guaranteed separately below via direct DB lookups, per "adapt
 * to suite conventions" (this repo's dominant pattern for resolving IDs is
 * `db.queryOne`, not DOM scraping).
 */
async function collectUuidHrefPaths(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const paths: string[] = [];
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href');
      if (href === null || href === '') continue;
      let url: URL;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        continue;
      }
      if (url.origin !== window.location.origin) continue;
      if (uuidRe.test(url.pathname)) paths.push(url.pathname);
    }
    return paths;
  });
}

/** Route "shape": the path with every UUID segment replaced by `:id`. */
function shapeOf(path: string): string {
  return path.replace(UUID_RE_GLOBAL, ':id');
}

test('no raw UUID is ever rendered as visible text or a visible field value', async ({ page, db }) => {
  const discoveredByShape = new Map<string, string>();
  const violations: Array<{ route: string; hits: UuidHit[] }> = [];

  const visitAndScan = async (route: string): Promise<void> => {
    await gotoAndExpect(page, route);
    await page.waitForLoadState('networkidle');

    const hits = await findRawUuids(page);
    if (hits.length > 0) violations.push({ route, hits });
    expect.soft(hits, `No raw UUIDs on ${route} — found: ${JSON.stringify(hits)}`).toEqual([]);

    for (const path of await collectUuidHrefPaths(page)) {
      const shape = shapeOf(path);
      if (!discoveredByShape.has(shape)) discoveredByShape.set(shape, path);
    }
  };

  // Pass 1: every static route, in order — also harvests UUID-bearing
  // `<a href>`s along the way for pass 2.
  for (const route of STATIC_ROUTES) {
    await visitAndScan(route);
  }

  // Guarantee coverage of the detail/edit shapes that navigate via
  // `useNavigate()` (no real anchor for pass 1 to discover), by resolving
  // one real ID directly from the DB — same pattern every other spec in
  // this suite uses. Silently skipped if the type has zero rows (this spec
  // asserts absence of leaks, not presence of fixtures).
  const vendor = await db.queryOne<{ id: string }>(`SELECT id FROM vendors LIMIT 1`);
  if (vendor !== null) discoveredByShape.set('/vendors/:id/edit', `/vendors/${vendor.id}/edit`);

  const purchase = await db.queryOne<{ id: string }>(
    `SELECT id FROM yarn_purchases ORDER BY created_at DESC LIMIT 1`,
  );
  if (purchase !== null) discoveredByShape.set('/yarn-purchases/:id', `/yarn-purchases/${purchase.id}`);

  const challanOut = await db.queryOne<{ id: string }>(
    `SELECT id FROM jw_challans_out ORDER BY created_at DESC LIMIT 1`,
  );
  if (challanOut !== null) discoveredByShape.set('/jw-challans-out/:id', `/jw-challans-out/${challanOut.id}`);

  const placement = await db.queryOne<{ source_type: string; source_item_id: string }>(
    `SELECT source_type, source_item_id FROM placements LIMIT 1`,
  );
  if (placement !== null) {
    const path = `/place-stock/${placement.source_type}/${placement.source_item_id}`;
    discoveredByShape.set(shapeOf(path), path);
  }

  // The B-015 positions detail page (01defc7) resolves its header's
  // quality/SKU name from navigation state (when the overview row was
  // clicked) OR its own fetch (when not) — B-014's rule is that it must
  // NEVER fall back to the raw id while that fetch is in flight. Typing the
  // URL directly (as here) is precisely the no-navigation-state path, so
  // this exercises the regression the fix targets — a bare
  // `/inventory/positions` (no query params) only reaches the "no stock
  // item selected" empty state and would prove nothing.
  const stockPosition = await db.queryOne<{
    quality_id: string;
    sku_id: string | null;
    processed_types: string[];
    unit: string;
  }>(
    `SELECT quality_id, sku_id, processed_types, unit::text AS unit
     FROM stock_ledger
     GROUP BY quality_id, sku_id, processed_types, unit
     HAVING SUM(in_quantity - out_quantity) > 0
     LIMIT 1`,
  );
  if (stockPosition !== null) {
    const state =
      stockPosition.processed_types.length === 0
        ? 'raw'
        : [...stockPosition.processed_types].sort().join(',');
    const skuParam = stockPosition.sku_id !== null ? `&skuId=${stockPosition.sku_id}` : '';
    const path =
      `/inventory/positions?qualityId=${stockPosition.quality_id}${skuParam}` +
      `&state=${state}&unit=${stockPosition.unit}`;
    // Keyed manually (not via shapeOf, which only replaces path-segment
    // UUIDs) since the id here lives in the query string, not the path.
    discoveredByShape.set('/inventory/positions?qualityId=<real>', path);
  }

  // Pass 2: one visit per distinct discovered shape.
  for (const path of discoveredByShape.values()) {
    await visitAndScan(path);
  }

  // Redundant with the per-page expect.soft calls above (which already fail
  // the test and report every offending page individually), but gives a
  // single, explicit top-level summary of the sweep's scope and outcome.
  expect(
    violations,
    `UUID sweep covered ${STATIC_ROUTES.length} static routes + ${discoveredByShape.size} discovered detail shapes; ` +
      `violations: ${JSON.stringify(violations, null, 2)}`,
  ).toEqual([]);
});
