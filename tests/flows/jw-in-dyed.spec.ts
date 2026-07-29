import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { codes } from '../../fixtures/codes';
import { DYED_LOT_SKU_REQUIRED, SENTINEL_OPTION_LABEL, SKU_ANSWER_REQUIRED } from '../../fixtures/copy';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import type { Db } from '../../fixtures/db';

// JW Challan In "dyed" — PER-LOT SOURCES FORM (spec 2026-07-23, supersedes
// the 2026-07-22 consolidated-form spec's Section B/allocator/Place
// expander). "Dyed" is not a route or a picker choice: there is no Processed
// Types input at all (D2 — the BE derives state from each source's prior
// processedTypes ∪ the work-done chips, which default ticked). What makes a
// receipt "dyed" is purely that its source OUT declared 'dyeing'. Section C
// ("Place stock") is an ALWAYS-VISIBLE region per lot (`place stock,
// lots.N`) — no click-to-reveal toggle anymore.
//
// Ledger contract is identical to jw-in-yarn.spec.ts (same
// applyChallanInYarnLedger, same two legs); 'dyed' changes only the
// processedTypes value written into Leg B.
//
// O4 (BE a92f21e, e2e plan E10, 2026-07-29): dyed lots (derived
// processedTypes include 'dyeing') now require a real SKU — the NO_SHADE
// sentinel is invalid there — and `shadeNo` is DERIVED server-side from
// that SKU (`shadeNumber ?? name`), never taken from the caller.
// `SHADE_NO_REQUIRED` is retired; no assertion in this file expects it, and
// every `details.code` assertion below is an exact match against a
// different, still-valid code, which is what proves it never appears.
//
// FE mirror covers: the sentinel option showing disabled (with
// DYED_LOT_SKU_REQUIRED as its title) on dyed rows, a submit-time block if a
// dyed row somehow still holds the sentinel, AND (fe@499cde4, following a
// discrepancy this file's earlier revision flagged against fe@5b84a3d,
// which only did the first two) the Shade column/cell retired entirely —
// there is no shadeNo input anywhere in the grid, dyed row or not, and the
// mapper never sends a `shadeNo` key. Verified below via column/label
// absence. The derivation contract itself is verified independently via the
// persisted `shade_no` column / response body, which never depended on that
// cell.
test(
  '/jw-challans-in/new/dyed redirects to the consolidated form (dyed is not a separate route)',
  async ({ page }) => {
    await page.goto('/jw-challans-in/new/dyed');
    await expect(page).toHaveURL(/\/jw-challans-in\/new$/);
    await expect(page.getByRole('heading', { name: 'New Job Work Challan In' })).toBeVisible();
  },
);

// ─── E10 shared fixtures ────────────────────────────────────────────────────

interface RawLotRow {
  lot_number: string;
  sku_id: string;
  quality_id: string;
  quality_code: string;
  quality_name: string;
  sku_name: string;
  sku_shade_number: string | null;
  loc_name: string;
  floor_name: string;
  floor_id: string;
}

async function resolveJobWorker(db: Db): Promise<{ id: string; code: string; name: string }> {
  const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();
  return jobWorker!;
}

// A raw (unprocessed) lot whose SKU carries a shade_number, so a dyed
// receipt off it deterministically exercises the `shadeNumber` arm of the
// `shadeNumber ?? name` derivation. Re-queried per position — each call sees
// the latest balance after earlier positions in this file have drawn it down.
async function resolveDyeableRawLot(db: Db, minQty: number): Promise<RawLotRow> {
  const src = await db.queryOne<RawLotRow>(
    `SELECT s.lot_number, s.sku_id, s.quality_id,
            q.code AS quality_code, q.name AS quality_name,
            sku.name AS sku_name, sku.shade_number AS sku_shade_number,
            l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
     FROM stock_ledger s
     JOIN location_floors f ON f.id = s.floor_id
     JOIN locations l ON l.id = f.location_id
     JOIN yarn_qualities q ON q.id = s.quality_id
     JOIN yarn_skus sku ON sku.id = s.sku_id
     WHERE s.lot_number IS NOT NULL
       AND s.sku_id IS NOT NULL
       AND s.job_worker_id IS NULL
       AND l.status = 'active' AND f.status = 'active'
       AND q.status = 'active' AND sku.status = 'active'
       AND cardinality(s.processed_types) = 0
       AND sku.shade_number IS NOT NULL AND sku.shade_number <> ''
     GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
              sku.name, sku.shade_number, l.name, f.name, f.id
     HAVING SUM(s.in_quantity - s.out_quantity) >= $1
     ORDER BY s.lot_number
     LIMIT 1`,
    [minQty],
  );
  expect(
    src,
    'seed must provide a raw lot with a shade-numbered SKU and enough balance',
  ).not.toBeNull();
  return src!;
}

// Same as `resolveDyeableRawLot`, but excludes a SKU — used to get a SECOND
// dyeing position with a DIFFERENT SKU so two source rows genuinely
// disagree (see Test A path 1's comment on the D2 auto-prefill effect).
async function resolveDyeableRawLotExcludingSku(
  db: Db,
  minQty: number,
  excludeSkuId: string,
): Promise<RawLotRow> {
  const src = await db.queryOne<RawLotRow>(
    `SELECT s.lot_number, s.sku_id, s.quality_id,
            q.code AS quality_code, q.name AS quality_name,
            sku.name AS sku_name, sku.shade_number AS sku_shade_number,
            l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
     FROM stock_ledger s
     JOIN location_floors f ON f.id = s.floor_id
     JOIN locations l ON l.id = f.location_id
     JOIN yarn_qualities q ON q.id = s.quality_id
     JOIN yarn_skus sku ON sku.id = s.sku_id
     WHERE s.lot_number IS NOT NULL
       AND s.sku_id IS NOT NULL
       AND s.sku_id <> $2
       AND s.job_worker_id IS NULL
       AND l.status = 'active' AND f.status = 'active'
       AND q.status = 'active' AND sku.status = 'active'
       AND cardinality(s.processed_types) = 0
       AND sku.shade_number IS NOT NULL AND sku.shade_number <> ''
     GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
              sku.name, sku.shade_number, l.name, f.name, f.id
     HAVING SUM(s.in_quantity - s.out_quantity) >= $1
     ORDER BY s.lot_number
     LIMIT 1`,
    [minQty, excludeSkuId],
  );
  expect(
    src,
    'seed must provide a second, differently-SKU\'d shade-numbered raw lot with enough balance',
  ).not.toBeNull();
  return src!;
}

function skuOptionLabelOf(src: RawLotRow): string {
  return src.sku_shade_number !== null && src.sku_shade_number !== ''
    ? `${src.sku_name} — ${src.sku_shade_number}`
    : src.sku_name;
}

async function resolveReceivingFloor(
  db: Db,
  excludeFloorId: string,
): Promise<{ loc_id: string; loc_code: string; loc_name: string; floor_name: string; floor_id: string }> {
  const receivingFloor = await db.queryOne<{
    loc_id: string;
    loc_code: string;
    loc_name: string;
    floor_name: string;
    floor_id: string;
  }>(
    `SELECT l.id AS loc_id, l.code AS loc_code, l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
     FROM location_floors f JOIN locations l ON l.id = f.location_id
     WHERE f.id <> $1 AND l.status = 'active' AND f.status = 'active'
     ORDER BY f.id LIMIT 1`,
    [excludeFloorId],
  );
  expect(receivingFloor, 'seed must provide a second active floor to receive into').not.toBeNull();
  return receivingFloor!;
}

// Drives a JW-Challan-Out declaring `jobWorkTypeLabel` (the Operations
// checkbox's accessible name) off `src`, quantity `q`. Returns the minted
// OUT challan no.
async function createOutPosition(
  page: Page,
  jobWorker: { code: string; name: string },
  src: RawLotRow,
  jobWorkTypeLabel: string,
  q: number,
): Promise<string> {
  await gotoAndExpect(page, '/jw-challans-out/new');
  await selectNativeByLabel(page, 'Job worker', `${jobWorker.code} – ${jobWorker.name}`);
  // getByRole (not getByLabel) — the outer Operations <label> wraps the whole
  // multi-select group (known FE quirk, task-14-report.md).
  await page.getByRole('checkbox', { name: jobWorkTypeLabel }).check();
  await selectByAriaLabel(page, 'Quality for line 1', `${src.quality_code} – ${src.quality_name}`);
  await selectByAriaLabel(page, 'Select SKU', skuOptionLabelOf(src));
  await selectByAriaLabel(page, 'Source lot for line 1', src.lot_number);
  await fillByLabel(page, 'Net weight for line 1', String(q));
  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select floor and location', `${src.loc_name} · ${src.floor_name}`);
  await fillByLabel(page, 'placement quantity 1', String(q));
  await clickButton(page, 'Save challan');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
  return captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
}

async function outItemIdFor(db: Db, outChallanNo: string): Promise<string> {
  const row = await db.queryOne<{ id: string }>(
    `SELECT jcoi.id
     FROM jw_challan_out_items jcoi
     JOIN jw_challans_out jco ON jco.id = jcoi.challan_out_id
     WHERE jco.challan_no = $1`,
    [outChallanNo],
  );
  expect(row, 'the OUT challan must have exactly one item').not.toBeNull();
  return row!.id;
}

async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrfCookie = cookies.find((c) => c.name === 'fabtraq_csrf');
  expect(csrfCookie, 'fabtraq_csrf cookie must be present for an authenticated session').toBeDefined();
  return decodeURIComponent(csrfCookie!.value).split('|')[0] ?? '';
}

// Direct API — pure fixture setup, not itself under test. Deliberately NOT
// reused from E2 (masters/qualities.spec.ts): a different agent's file, and
// single-spec runs don't reseed, so cross-file ordering isn't guaranteed.
async function createSkuWithoutShadeNumber(
  page: Page,
  qualityId: string,
): Promise<{ id: string; name: string }> {
  const csrfToken = await getCsrfToken(page);
  const name = codes.unique('E10-NoShadeNum');
  const res = await page.request.post(`${env.API_URL}/qualities/${qualityId}/skus`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { qualityId, name },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { id: string; name: string };
  return { id: body.id, name: body.name };
}

// ─── E10 test 2 (REWRITE) — dyed receipt with a real SKU ───────────────────
//
// Drops the retired shadeNo-cell assertions (disabled→enabled→filled→
// rendered against a caller-typed value) that this test asserted pre-O4.
// The shade identity is now DERIVED server-side from the chosen SKU and
// verified against the persisted `shade_no` column, not the free-text cell.
test(
  'JW challan-in dyed receipt with a real SKU derives shadeNo server-side and moves the two-sided ledger delta',
  async ({ page, db }) => {
    const Q = 10;

    const jobWorker = await resolveJobWorker(db);
    const src = await resolveDyeableRawLot(db, Q);
    const skuOptionLabel = skuOptionLabelOf(src);
    const receivingFloor = await resolveReceivingFloor(db, src.floor_id);

    // Baseline BEFORE minting the OUT position — NOT assumed to be zero.
    // This (lotNumber, skuId, jobWorkerId) bucket is shared with this
    // file's other tests (same "first active job worker" + deterministic
    // raw-lot pick), and Test A deliberately leaves undrained credit behind
    // (its saves are blocked by design), so an absolute "before == 0"
    // assumption breaks on a second, non-reseeded run. Every assertion below
    // is a delta relative to this baseline instead.
    const jwKey = {
      lotNumber: src.lot_number,
      skuId: src.sku_id,
      qualityId: src.quality_id,
      floorId: null,
      jobWorkerId: jobWorker.id,
    };
    const jwBaseline = await db.ledgerBalance(jwKey);

    const outChallanNo = await createOutPosition(page, jobWorker, src, 'Dyeing', Q);

    const jwAfterOut = await db.ledgerBalance(jwKey);
    expect(jwAfterOut - jwBaseline).toBeCloseTo(Q, 3);

    // ── the "dyed" entry point redirects into the one consolidated form.
    await page.goto('/jw-challans-in/new/dyed');
    await expect(page).toHaveURL(/\/jw-challans-in\/new$/);

    await selectByAriaLabel(page, 'quality, lots.0', `${src.quality_code} – ${src.quality_name}`);
    await selectByAriaLabel(page, 'sku, lots.0', skuOptionLabel);
    await fillByLabel(page, 'net weight, lots.0', String(Q));

    // Section B — grouped by lot: add a source row under lot 0, pick the
    // dyeing OUT item; consumed = Q, wastage auto (0).
    await page.getByLabel('add source, lots.0').click();
    await page.getByLabel('source, lots.0.sources.0', { exact: true }).click();
    await fillByLabel(page, 'Search OUT challan no', outChallanNo);
    const eligibleOption = page.getByRole('option', { name: outChallanNo });
    await expect(eligibleOption).toBeVisible();
    await eligibleOption.click();
    await fillByLabel(page, 'consumed quantity, lots.0.sources.0', String(Q));

    // The row is now dyed. Retired shadeNo column/cell (fe@499cde4): no
    // "Shade" header and no `shade, lots.0` labeled element anywhere in the
    // grid — the column was removed outright, not merely disabled.
    await expect(page.getByRole('columnheader', { name: 'Shade' })).toHaveCount(0);
    await expect(page.getByLabel('shade, lots.0')).toHaveCount(0);

    // Place the full quantity via the always-visible Place-stock region.
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select location',
      `${receivingFloor.loc_code} – ${receivingFloor.loc_name}`,
    );
    await selectByAriaLabel(page, 'Select floor', receivingFloor.floor_name);
    await fillByLabel(page, 'placement quantity 1', String(Q));

    // ── Two-sided delta, same keys as jw-in-yarn.spec.ts. jwAfterOut is the
    // baseline here (not jwBaseline) — the JW-in leg should hand back
    // exactly what the OUT leg just credited.
    const floorKey = {
      qualityId: src.quality_id,
      skuId: src.sku_id,
      floorId: receivingFloor.floor_id,
    };
    const floorBefore = await db.ledgerBalance(floorKey);

    await clickButton(page, 'Save receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-in\/[^/]+$/);

    const jwAfterIn = await db.ledgerBalance(jwKey);
    const floorAfter = await db.ledgerBalance(floorKey);

    expect(jwAfterIn - jwAfterOut).toBeCloseTo(-Q, 3);
    expect(floorAfter - floorBefore).toBeCloseTo(Q, 3);

    // DERIVED shade — read the persisted column, not `getByText`: the detail
    // page also renders the SKU as `<name> — <shadeNumber>`, so a text match
    // could pass against the SKU cell while `shade_no` itself is null, which
    // is exactly the failure mode this rewrite exists to close.
    const challanId = page.url().split('/').pop()!;
    const persisted = await db.queryOne<{ shade_no: string | null }>(
      `SELECT shade_no FROM jw_challan_in_yarn_item WHERE challan_in_id = $1`,
      [challanId],
    );
    expect(persisted, 'the challan must have exactly one yarn item').not.toBeNull();
    expect(persisted!.shade_no).toBe(src.sku_shade_number);

    // Bonus visible-text checks (not load-bearing — the DB read above is).
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWI-\d{4}-\d{2}-\d{3,}\b/);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan In ${challanNo}` }),
    ).toBeVisible();
    await expect(page.getByText('Dyeing').first()).toBeVisible();
  },
);

// ─── E10 New Test A — dyed lot without a real SKU is rejected ──────────────
test(
  'JW challan-in dyed lot without a real SKU is rejected, both unanswered and via the sentinel',
  async ({ page, db }) => {
    const Q = 10;

    const jobWorker = await resolveJobWorker(db);
    const srcA = await resolveDyeableRawLot(db, Q);
    const srcB = await resolveDyeableRawLotExcludingSku(db, Q, srcA.sku_id);
    const outChallanNoA = await createOutPosition(page, jobWorker, srcA, 'Dyeing', Q);
    const outChallanNoB = await createOutPosition(page, jobWorker, srcB, 'Dyeing', Q);

    const jwKeyA = {
      lotNumber: srcA.lot_number,
      skuId: srcA.sku_id,
      qualityId: srcA.quality_id,
      floorId: null,
      jobWorkerId: jobWorker.id,
    };
    const jwKeyB = {
      lotNumber: srcB.lot_number,
      skuId: srcB.sku_id,
      qualityId: srcB.quality_id,
      floorId: null,
      jobWorkerId: jobWorker.id,
    };

    async function addSource(sourceIndex: number, outChallanNo: string, qty: number): Promise<void> {
      await page.getByLabel('add source, lots.0').click();
      await page
        .getByLabel(`source, lots.0.sources.${sourceIndex}`, { exact: true })
        .click();
      await fillByLabel(page, 'Search OUT challan no', outChallanNo);
      const eligibleOption = page.getByRole('option', { name: outChallanNo });
      await expect(eligibleOption).toBeVisible();
      await eligibleOption.click();
      await fillByLabel(page, `consumed quantity, lots.0.sources.${sourceIndex}`, String(qty));
    }

    // ── Path 1: SKU left unanswered. Two DISAGREEING dyeing sources (srcA,
    // srcB — different SKUs) are required to reach a genuinely unanswered
    // state here: with only one source, ReceivedLotsGrid's D2 auto-prefill
    // effect (deriveAgreedSku) fills the trivially-"agreeing" single source's
    // SKU in automatically, which is itself a REAL SKU and therefore a valid
    // dyed answer — the save would silently succeed, proving nothing. The
    // general "must answer" schema check then runs (and `continue`s) BEFORE
    // the dyed-only check in jw-challan-in-form.page.tsx's submit override,
    // so the visible message is the GENERIC SKU_ANSWER_REQUIRED — not the
    // dyed-specific string — even though this row is dyed. That's the
    // correct contract: the dyed-only check only runs once the schema-level
    // "answered" check already passed.
    await gotoAndExpect(page, '/jw-challans-in/new');
    await selectByAriaLabel(page, 'quality, lots.0', `${srcA.quality_code} – ${srcA.quality_name}`);
    await fillByLabel(page, 'net weight, lots.0', String(2 * Q));
    await addSource(0, outChallanNoA, Q);
    await addSource(1, outChallanNoB, Q);

    const { delta: unansweredDeltaA } = await db.ledgerDelta(jwKeyA, async () => {
      const { delta: unansweredDeltaB } = await db.ledgerDelta(jwKeyB, async () => {
        await clickButton(page, 'Save receipt');
        await expect(page.getByText(SKU_ANSWER_REQUIRED).first()).toBeVisible();
      });
      expect(unansweredDeltaB).toBe(0);
    });
    expect(unansweredDeltaA).toBe(0);
    await expect(page).toHaveURL(/\/jw-challans-in\/new$/);

    // ── Path 2: answered with the sentinel. The sentinel option is only
    // selectable BEFORE the row turns dyed — Radix disables it
    // (pointer-events: none) once `isDyed` is true — so it must be picked
    // FIRST, on a fresh non-dyed row, with the dyeing source added
    // afterward to flip the row dyed while the sentinel is already held. A
    // single source is fine here (unlike path 1): a manually-picked value is
    // never overwritten by the auto-prefill effect (it only ever rewrites a
    // value IT set), disagreement or not.
    await gotoAndExpect(page, '/jw-challans-in/new');
    await selectByAriaLabel(page, 'quality, lots.0', `${srcA.quality_code} – ${srcA.quality_name}`);
    await selectByAriaLabel(page, 'sku, lots.0', SENTINEL_OPTION_LABEL);
    await fillByLabel(page, 'net weight, lots.0', String(Q));
    await addSource(0, outChallanNoA, Q);

    // Bonus: the row is now dyed — the sentinel option shows disabled with
    // the pinned explanation as its title (guardian's "visible but
    // disabled" rule), even though this row already holds it from before.
    await page.locator('[aria-label="sku, lots.0"]').click();
    const sentinelOption = page.getByRole('option', { name: SENTINEL_OPTION_LABEL });
    await expect(sentinelOption).toHaveAttribute('aria-disabled', 'true');
    await expect(sentinelOption).toHaveAttribute('title', DYED_LOT_SKU_REQUIRED);
    await page.keyboard.press('Escape');

    const { delta: sentinelDelta } = await db.ledgerDelta(jwKeyA, async () => {
      await clickButton(page, 'Save receipt');
      await expect(page.getByText(DYED_LOT_SKU_REQUIRED).first()).toBeVisible();
    });
    expect(sentinelDelta).toBe(0);
    await expect(page).toHaveURL(/\/jw-challans-in\/new$/);
  },
);

// ─── E10 New Test B — derivation edges, via direct API ─────────────────────
//
// The UI no longer lets a caller-supplied shadeNo reach the wire on a dyed
// item's happy path, so the silent-discard and both derivation arms can
// only be exercised directly (precedent: beam-receipt.spec.ts:370).
test(
  'JW challan-in dyed shadeNo derivation edges: silent discard, name-fallback arm, unchanged non-dyed rule (direct API)',
  async ({ page, db }) => {
    const jobWorker = await resolveJobWorker(db);
    const csrfToken = await getCsrfToken(page);
    const today = new Date().toISOString().slice(0, 10);

    // ── B1 + B2 share ONE dyed OUT position (Q=20), drawn down via two
    // SEPARATE sequential POSTs (10 + 10) — the ordinary "still at JW"
    // partial-consumption pattern. Two ITEMS in the SAME request against
    // the same source is unverified BE behaviour and deliberately avoided.
    const dyedSrc = await resolveDyeableRawLot(db, 20);
    const dyedOutChallanNo = await createOutPosition(page, jobWorker, dyedSrc, 'Dyeing', 20);
    const dyedOutItemId = await outItemIdFor(db, dyedOutChallanNo);
    const dyedReceivingFloor = await resolveReceivingFloor(db, dyedSrc.floor_id);

    // B1 — real SKU (shadeNumber arm) + a differing caller-supplied
    // shadeNo → 201, and the PERSISTED value is the derived one, never the
    // caller's. This is the silent-discard path.
    const b1Res = await page.request.post(`${env.API_URL}/jw-challans-in`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        date: today,
        yarnItems: [
          {
            qualityId: dyedSrc.quality_id,
            skuId: dyedSrc.sku_id,
            shadeNo: 'CALLER-SUPPLIED-BOGUS-SHADE',
            netWeight: 10,
            unit: 'KG',
            sources: [
              {
                jwChallanOutItemId: dyedOutItemId,
                consumedQty: 10,
                wastage: 0,
                stillAtJwQty: 0,
                completions: [{ jobWorkType: 'dyeing', completed: true }],
              },
            ],
            placements: [
              {
                locationId: dyedReceivingFloor.loc_id,
                floorId: dyedReceivingFloor.floor_id,
                quantity: 10,
                unit: 'KG',
              },
            ],
          },
        ],
      },
    });
    expect(b1Res.status(), await b1Res.text()).toBe(201);
    const b1Body = (await b1Res.json()) as { yarnItems: { shadeNo: string | null }[] };
    expect(b1Body.yarnItems[0]?.shadeNo).toBe(dyedSrc.sku_shade_number);
    expect(b1Body.yarnItems[0]?.shadeNo).not.toBe('CALLER-SUPPLIED-BOGUS-SHADE');

    // B2 — the `?? name` fallback arm: a SKU with NO shadeNumber, sourced
    // from the SAME OUT position's remaining balance.
    const noShadeSku = await createSkuWithoutShadeNumber(page, dyedSrc.quality_id);
    const b2Res = await page.request.post(`${env.API_URL}/jw-challans-in`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        date: today,
        yarnItems: [
          {
            qualityId: dyedSrc.quality_id,
            skuId: noShadeSku.id,
            netWeight: 10,
            unit: 'KG',
            sources: [
              {
                jwChallanOutItemId: dyedOutItemId,
                consumedQty: 10,
                wastage: 0,
                stillAtJwQty: 0,
                completions: [{ jobWorkType: 'dyeing', completed: true }],
              },
            ],
            placements: [
              {
                locationId: dyedReceivingFloor.loc_id,
                floorId: dyedReceivingFloor.floor_id,
                quantity: 10,
                unit: 'KG',
              },
            ],
          },
        ],
      },
    });
    expect(b2Res.status(), await b2Res.text()).toBe(201);
    const b2Body = (await b2Res.json()) as { yarnItems: { shadeNo: string | null }[] };
    expect(b2Body.yarnItems[0]?.shadeNo).toBe(noShadeSku.name);

    // ── B3 + B4 — the unchanged non-dyed rule, via a Twisting (non-dyed)
    // position. `completions: []` keeps the derived processedTypes empty
    // (no prior state, nothing marked completed), so these items are
    // non-dyed regardless of what the OUT declared.
    const nonDyedSrc = await resolveDyeableRawLot(db, 10);
    const nonDyedOutChallanNo = await createOutPosition(page, jobWorker, nonDyedSrc, 'Twisting', 10);
    const nonDyedOutItemId = await outItemIdFor(db, nonDyedOutChallanNo);
    const nonDyedReceivingFloor = await resolveReceivingFloor(db, nonDyedSrc.floor_id);
    const nonDyedJwKey = {
      lotNumber: nonDyedSrc.lot_number,
      skuId: nonDyedSrc.sku_id,
      qualityId: nonDyedSrc.quality_id,
      floorId: null,
      jobWorkerId: jobWorker.id,
    };

    // B3 — non-dyed + shadeNo present → 400 SHADE_NO_NOT_ALLOWED, zero
    // consumption (validated before any write — same precedence as the
    // dyed-SKU-required check).
    const { delta: rejectedDelta } = await db.ledgerDelta(nonDyedJwKey, async () => {
      const b3Res = await page.request.post(`${env.API_URL}/jw-challans-in`, {
        headers: { 'X-CSRF-Token': csrfToken },
        data: {
          date: today,
          yarnItems: [
            {
              qualityId: nonDyedSrc.quality_id,
              skuId: nonDyedSrc.sku_id,
              shadeNo: 'SHOULD-BE-REJECTED',
              netWeight: 10,
              unit: 'KG',
              sources: [
                {
                  jwChallanOutItemId: nonDyedOutItemId,
                  consumedQty: 10,
                  wastage: 0,
                  stillAtJwQty: 0,
                  completions: [],
                },
              ],
              placements: [],
            },
          ],
        },
      });
      expect(b3Res.status(), await b3Res.text()).toBe(400);
      const b3Body = (await b3Res.json()) as {
        code?: string;
        details?: { code?: string; field?: string };
      };
      expect(b3Body.code).toBe('VALIDATION_ERROR');
      expect(b3Body.details?.code).toBe('SHADE_NO_NOT_ALLOWED');
      expect(b3Body.details?.field).toBe('yarnItems[0].shadeNo');
    });
    expect(rejectedDelta).toBe(0);

    // B4 — non-dyed + shadeNo:'' → accepted (the schema's shadeNo has no
    // trim-to-undefined transform, so '' is treated as "not set", never
    // rejected). Reuses the SAME OUT position — B3 never consumed it.
    const b4Res = await page.request.post(`${env.API_URL}/jw-challans-in`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        date: today,
        yarnItems: [
          {
            qualityId: nonDyedSrc.quality_id,
            skuId: nonDyedSrc.sku_id,
            shadeNo: '',
            netWeight: 10,
            unit: 'KG',
            sources: [
              {
                jwChallanOutItemId: nonDyedOutItemId,
                consumedQty: 10,
                wastage: 0,
                stillAtJwQty: 0,
                completions: [],
              },
            ],
            placements: [
              {
                locationId: nonDyedReceivingFloor.loc_id,
                floorId: nonDyedReceivingFloor.floor_id,
                quantity: 10,
                unit: 'KG',
              },
            ],
          },
        ],
      },
    });
    expect(b4Res.status(), await b4Res.text()).toBe(201);
  },
);
