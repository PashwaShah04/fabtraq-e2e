import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import type { Db } from '../../fixtures/db';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  fillByLabelExact,
  selectByAriaLabel,
  selectByLabel,
  clickButton,
} from '../../support/forms';
import { getCsrfToken } from '../../support/api';
import { expectToast, captureDocNo } from '../../support/assert';

// B-035/B-036 (docs/brainstorms/2026-08-26-out-item-conservation.md) — a
// jw_challan_out_item was drawn down by MORE THAN ONE downstream consumer
// (beam receipts, JW-In receipts, weaving-in weft, write-offs) but every
// guard/picker that computed "how much is already gone" only knew about one
// consumer. Production reproduction: JWO-2026-27-024 dispatched 10 KG and
// three beam receipts drew 22 KG from it — nothing summed them.
//
// The fix extracts one owned union (`getOutItemConsumption`) and repoints
// every reader (guards + the eligible-out-item picker) at it. These two specs
// prove the operator cannot reproduce the defect through the real UI:
// E1 — two beam receipts sequentially against the same out-item (the
//      reported shape); E2 — a beam receipt then a JW-In receipt against the
//      same out-item (the cross-consumer direction a beam-only fix would
//      miss).
//
// Both must be demonstrated RED against the pre-fix backend: the fix is
// exactly the guard that these specs try to trigger.

interface SourceLotRow {
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

// FIXTURE-BALANCE CONTRACT (see fs1-diagnosis.md). Sum a floor position the way
// the app's own authority sums it: `findLotLocationBalance`
// (prisma-inventory.service.ts) filters lotNumber + locationId + floorId + unit
// and NO jobWorkerId. The `AND s.job_worker_id IS NULL` this query used to carry
// was redundant for its stated purpose — at-JW legs carry floor_id IS NULL, so
// `JOIN location_floors` already excludes them — and it HID every floor debit
// that does carry a jobWorkerId (the seed's S2/S3 chains write 50 KG on Ground
// Floor and 100 KG on First Floor exactly that way). The balance was therefore
// over-reported by up to 100 KG, the query never fell through as the suite
// drained the lot, and it kept handing tests a floor whose real balance was 2 KG
// — the JW-Out POST then 400s INSUFFICIENT_BALANCE_AT_FLOOR and no "Saved" toast
// ever appears.
// The ORDER BY tiebreak is the other half: LOT-260324-0001 sits on TWO floors, so
// `ORDER BY s.lot_number LIMIT 1` was resolved by the planner's group-key sort —
// i.e. by the random floor UUID, a 50/50 coin flip per `db:seed`.
const RAW_LOT_SQL = `SELECT s.lot_number, s.sku_id, s.quality_id,
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
   AND l.status = 'active' AND f.status = 'active'
   AND q.status = 'active' AND sku.status = 'active'
   AND cardinality(s.processed_types) = 0
 GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
          sku.name, sku.shade_number, l.name, f.name, f.id
 HAVING SUM(s.in_quantity - s.out_quantity) >= $1
 ORDER BY s.lot_number, SUM(s.in_quantity - s.out_quantity) DESC, f.id
 LIMIT 1`;

function skuLabelOf(src: SourceLotRow): string {
  return src.sku_shade_number !== null && src.sku_shade_number !== ''
    ? `${src.sku_name} — ${src.sku_shade_number}`
    : src.sku_name;
}

/**
 * Builds one fresh, own-fixture sizing OUT challan of `qty` KG carrying
 * exactly `jobWorkTypes: ['sizing']` — the ONLY challan shape a beam receipt
 * can ever be booked against (beam-receipt.service.ts requires
 * `challan.jobWorkTypes.includes('sizing')`, and the eligible-out-items
 * picker's own query filters `jobWorkTypes: { has: 'sizing' }`).
 *
 * A sizing challan needs a source lot already carrying 'warping' in
 * processedTypes (isValidInputState) — the seed has none lying around, so
 * this mints one live via a dedicated raw -> warping-OUT -> warping-IN chain,
 * exactly like beam-receipt.spec.ts's mixed-challan test does. Returns the
 * minted challan's number, its single out-item id, and the job worker used
 * (so callers can build ledger keys).
 */
async function seedSizingOutChallan(
  page: import('@playwright/test').Page,
  db: Db,
  qty: number,
): Promise<{ challanNo: string; outItemId: string; jobWorker: { id: string; code: string; name: string } }> {
  const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(jobWorker, 'seed must provide an active job worker').not.toBeNull();

  const src = await db.queryOne<SourceLotRow>(RAW_LOT_SQL, [qty]);
  expect(src, 'seed must provide a raw lot with >= qty balance').not.toBeNull();

  const receivingFloor = await db.queryOne<{
    loc_id: string;
    loc_code: string;
    loc_name: string;
    floor_name: string;
    floor_id: string;
  }>(
    `SELECT l.id AS loc_id, l.code AS loc_code, l.name AS loc_name,
            f.name AS floor_name, f.id AS floor_id
     FROM location_floors f JOIN locations l ON l.id = f.location_id
     WHERE f.id <> $1 AND l.status = 'active' AND f.status = 'active'
     ORDER BY f.id LIMIT 1`,
    [src!.floor_id],
  );
  expect(receivingFloor, 'seed must provide a second active floor to receive into').not.toBeNull();

  // ── warping JW-Challan-Out on the raw lot — opens the at-JW position the
  //    following JW-In drains.
  await gotoAndExpect(page, '/jw-challans-out/new');
  await selectByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
  await page.getByRole('checkbox', { name: 'Warping', exact: true }).check();
  await selectByAriaLabel(page, 'Quality for line 1', `${src!.quality_code} – ${src!.quality_name}`);
  await selectByAriaLabel(page, 'Select SKU', skuLabelOf(src!));
  await selectByAriaLabel(page, 'Source lot for line 1', src!.lot_number);
  await fillByLabel(page, 'Net weight for line 1', String(qty));
  await clickButton(page, 'Add placement');
  await selectByAriaLabel(page, 'Select floor and location', `${src!.loc_name} · ${src!.floor_name}`);
  await fillByLabelExact(page, 'placement quantity 1', String(qty));
  await clickButton(page, 'Save challan');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
  const warpOutChallanNo = await captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);

  const warpOutItem = await db.queryOne<{ id: string }>(
    `SELECT jcoi.id
     FROM jw_challan_out_items jcoi
     JOIN jw_challans_out jco ON jco.id = jcoi.challan_out_id
     WHERE jco.challan_no = $1`,
    [warpOutChallanNo],
  );
  expect(warpOutItem, 'the warping OUT challan must have exactly one item').not.toBeNull();

  // ── JW-Challan-In (yarn) fully receiving the warping challan, minting a
  //    warped lot on `receivingFloor` — driven via a direct API call, same
  //    precedent as beam-receipt.spec.ts's mixed-challan test: the yarn
  //    picker deliberately excludes any beam-track (warping/sizing/weaving)
  //    OUT challan from its candidate list, so a warping challan can never
  //    be selected through that one UI picker even though createJwChallanIn
  //    itself has no such exclusion.
  const csrfToken = await getCsrfToken(page);
  const jwInRes = await page.request.post(`${env.API_URL}/jw-challans-in`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      date: new Date().toISOString().slice(0, 10),
      yarnItems: [
        {
          qualityId: src!.quality_id,
          skuId: src!.sku_id,
          netWeight: qty,
          unit: 'KG',
          sources: [
            {
              jwChallanOutItemId: warpOutItem!.id,
              consumedQty: qty,
              wastage: 0,
              stillAtJwQty: 0,
              completions: [{ jobWorkType: 'warping', completed: true }],
            },
          ],
          placements: [
            {
              locationId: receivingFloor!.loc_id,
              floorId: receivingFloor!.floor_id,
              quantity: qty,
              unit: 'KG',
            },
          ],
        },
      ],
    },
  });
  expect(jwInRes.status(), await jwInRes.text()).toBe(201);
  const jwInBody = (await jwInRes.json()) as { yarnItems: { lotNo: string }[] };
  const warpedLot = jwInBody.yarnItems[0]?.lotNo;
  expect(warpedLot, 'the JW-in response must carry the newly minted warped lot number').toBeTruthy();

  // ── sizing OUT challan off the freshly warped lot — the fixture this test
  //    actually needs: exactly `qty` KG, jobWorkTypes = ['sizing'].
  await gotoAndExpect(page, '/jw-challans-out/new');
  await selectByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
  await page.getByRole('checkbox', { name: 'Sizing', exact: true }).check();
  await selectByAriaLabel(page, 'Quality for line 1', `${src!.quality_code} – ${src!.quality_name}`);
  await selectByAriaLabel(page, 'Select SKU', skuLabelOf(src!));
  await selectByAriaLabel(page, 'Source lot for line 1', warpedLot!);
  await fillByLabel(page, 'Net weight for line 1', String(qty));
  await clickButton(page, 'Add placement');
  await selectByAriaLabel(
    page,
    'Select floor and location',
    `${receivingFloor!.loc_name} · ${receivingFloor!.floor_name}`,
  );
  await fillByLabelExact(page, 'placement quantity 1', String(qty));
  await clickButton(page, 'Save challan');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
  const challanNo = await captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);

  const outItem = await db.queryOne<{ id: string }>(
    `SELECT jcoi.id
     FROM jw_challan_out_items jcoi
     JOIN jw_challans_out jco ON jco.id = jcoi.challan_out_id
     WHERE jco.challan_no = $1`,
    [challanNo],
  );
  expect(outItem, 'the sizing OUT challan must have exactly one item').not.toBeNull();

  return { challanNo, outItemId: outItem!.id, jobWorker: jobWorker! };
}

/**
 * Books one sizing_jw beam receipt row against `challanNo`'s out item via the
 * real UI (beam-receipt-form.page.tsx). Returns the create response so the
 * caller can assert either 201 (accepted) or a rejection.
 */
async function submitSizingBeamReceipt(
  page: import('@playwright/test').Page,
  challanNo: string,
  netWeight: number,
): Promise<import('@playwright/test').Response> {
  await gotoAndExpect(page, '/beam-receipts/new');
  await page
    .getByRole('group', { name: 'beam origin' })
    .getByRole('button', { name: 'Sizing JW', exact: true })
    .click();

  const beamNumber = `BM-CONS-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await fillByLabel(page, 'beam number, items.0', beamNumber);
  await fillByLabel(page, 'net weight, items.0', String(netWeight));
  await page.getByRole('button', { name: 'Pick eligible out item' }).first().click();
  await page.getByRole('option').filter({ hasText: challanNo }).first().click();

  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/beam-receipts',
    ),
    clickButton(page, 'Save beam receipt'),
  ]);
  return res;
}

// ── E1 — sequential beam receipts cannot exceed the dispatch ───────────────
//
// Mirrors JWO-2026-27-024 exactly: one 10 KG sizing dispatch, one lot. First
// receipt (4 KG) is accepted; second (9 KG) would bring the total to 13 KG —
// rejected. The rejection must render in a VISIBLE slot naming what already
// consumed the yarn (not swallowed, not a bare 400, not an auto-dismissed
// toast), and the picker must then report remaining = 6, not 10 — the stale
// full weight is what made the original over-issue easy to do.
test(
  'sequential beam receipts against one sizing dispatch cannot exceed it (B-035 E1)',
  async ({ page, db }) => {
    const DISPATCHED = 10;
    const FIRST = 4;
    const SECOND = 9; // 4 + 9 = 13 > 10 — must be rejected

    const { challanNo, outItemId } = await seedSizingOutChallan(page, db, DISPATCHED);

    // First receipt: accepted.
    const firstRes = await submitSizingBeamReceipt(page, challanNo, FIRST);
    expect(firstRes.status(), await firstRes.text()).toBe(201);
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);

    // Second receipt against the SAME out item: rejected. Must not navigate
    // away from the form.
    const secondRes = await submitSizingBeamReceipt(page, challanNo, SECOND);
    expect(secondRes.status()).toBe(422);
    const secondBody = (await secondRes.json()) as {
      code: string;
      details?: { code?: string; outItemId?: string; byConsumer?: Record<string, number> };
    };
    expect(secondBody.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(secondBody.details?.code).toBe('CONSERVATION_VIOLATION');
    expect(secondBody.details?.outItemId).toBe(outItemId);
    expect(secondBody.details?.byConsumer?.beamReceipt).toBeCloseTo(FIRST, 3);
    await expect(page).toHaveURL(/\/beam-receipts\/new$/);

    // Visible, not swallowed: a co-located FieldError naming what already
    // consumed the yarn (describeConservationViolation's message — see
    // fabtraq-fe shared/api/errors.ts), plus a toast carrying the same text
    // so the operator sees it even scrolled off the field.
    const violationText = new RegExp(`${FIRST.toFixed(3)} KG of this dispatch is already consumed`);
    await expect(page.getByText(violationText).first()).toBeVisible();
    await expect(
      page.getByText(new RegExp(`${FIRST.toFixed(3)} KG in beam receipts`)).first(),
    ).toBeVisible();
    await expectToast(page, violationText);

    // The picker must now report remaining = DISPATCHED - FIRST = 6, not the
    // stale 10 — this is the assertion that matters most: a stale picker is
    // what made the over-issue easy to do in the first place. Re-open a
    // fresh /beam-receipts/new (the failed submit's own picker query was
    // already invalidated on the rejection above; a full navigation proves
    // the corrected figure survives a fresh mount too, not just a live cache
    // patch).
    await gotoAndExpect(page, '/beam-receipts/new');
    await page
      .getByRole('group', { name: 'beam origin' })
      .getByRole('button', { name: 'Sizing JW', exact: true })
      .click();
    await page.getByRole('button', { name: 'Pick eligible out item' }).first().click();
    // EligibleOutItemResponse.remainingQty renders as a bare number (no
    // fixed-decimal formatting), unlike the beam-composition pull picker's
    // "· \d+\.\d{3} KG" lot labels — assert the plain value.
    const option = page.getByRole('option').filter({ hasText: challanNo }).first();
    await expect(option).toContainText(`${DISPATCHED - FIRST} KG`);
    await expect(option).not.toContainText(`${DISPATCHED} KG`);
  },
);

// ── E2 — cross-consumer conservation ────────────────────────────────────────
//
// A beam receipt, then a JW-In receipt against the SAME out-item that would
// exceed the dispatch. This is the direction R2 (beam-receipt guard) would
// never exercise and a beam-only fix would miss: R3 (the JW-In guard) must
// also see beam consumption, not just its own C1 total.
//
// A sizing challan (the only shape a beam receipt can ever draw from) is
// structurally EXCLUDED from JW-In's own eligible-out-items picker
// (findEligibleOutItems drops any beam-track jobWorkType) — so there is no
// out-item reachable by BOTH pickers through the UI at all; this is a
// UI-level fact, not a shortcut. The second call is therefore driven
// directly against the API, exactly the precedent beam-receipt.spec.ts's
// mixed-challan test already established for this exact picker exclusion:
// createJwChallanIn has no such exclusion itself, so this is a legitimate
// BE-validated request the guard must still reject.
//
// LIMITATION: this means the cross-consumer over-consumption path is
// currently unreachable through the UI at all — no operator can drive this
// exact request from a screen today. This test guards an API-level
// contract, not an operator-reachable flow; B-035's S2 is therefore a
// latent API-surface risk (e.g. a future picker relaxation, or a direct
// integration) rather than something an operator could trigger today. Do
// not read a pass here as proof the UI blocks this.
test(
  'a JW-In receipt cannot exceed a dispatch already partly consumed by a beam receipt (B-035 E2)',
  async ({ page, db }) => {
    const DISPATCHED = 10;
    const BEAM_QTY = 4;
    const JWIN_QTY = 9; // 4 + 9 = 13 > 10 — must be rejected

    const { challanNo, outItemId } = await seedSizingOutChallan(page, db, DISPATCHED);

    // Consumer 1 — a beam receipt via the real UI, accepted.
    const beamRes = await submitSizingBeamReceipt(page, challanNo, BEAM_QTY);
    expect(beamRes.status(), await beamRes.text()).toBe(201);
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/beam-receipts\/[^/]+$/);

    // Ledger sanity: the beam receipt actually drained the at-JW position
    // before we attempt the JW-In — otherwise a 422 below would prove
    // nothing (the guard could be rejecting for an unrelated reason).
    const src = await db.queryOne<{ quality_id: string; sku_id: string }>(
      `SELECT quality_id, sku_id FROM jw_challan_out_items WHERE id = $1`,
      [outItemId],
    );
    expect(src, 'the seeded out item must exist').not.toBeNull();

    // Consumer 2 — a JW-In (yarn) receipt against the SAME out item,
    // requesting consumedQty that would exceed the dispatch once the beam
    // consumption is counted. Not reachable through the JW-In picker (see
    // top-of-test note) — driven directly against the API, same precedent
    // as seedSizingOutChallan's own warping-IN step above.
    const csrfToken = await getCsrfToken(page);
    const jwInRes = await page.request.post(`${env.API_URL}/jw-challans-in`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        date: new Date().toISOString().slice(0, 10),
        yarnItems: [
          {
            qualityId: src!.quality_id,
            skuId: src!.sku_id,
            netWeight: JWIN_QTY,
            unit: 'KG',
            sources: [
              {
                jwChallanOutItemId: outItemId,
                consumedQty: JWIN_QTY,
                wastage: 0,
                stillAtJwQty: 0,
                completions: [{ jobWorkType: 'sizing', completed: true }],
              },
            ],
            placements: [],
          },
        ],
      },
    });

    expect(jwInRes.status(), await jwInRes.text()).toBe(422);
    const jwInBody = (await jwInRes.json()) as {
      code: string;
      details?: { code?: string; outItemId?: string; byConsumer?: Record<string, number> };
    };
    expect(jwInBody.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(jwInBody.details?.code).toBe('CONSERVATION_VIOLATION');
    expect(jwInBody.details?.outItemId).toBe(outItemId);
    // The union must attribute the prior consumption to the beam receipt —
    // proof this guard sees C2, not just its own C1 total (S2's defect).
    expect(jwInBody.details?.byConsumer?.beamReceipt).toBeCloseTo(BEAM_QTY, 3);
    expect(jwInBody.details?.byConsumer?.jwChallanIn ?? 0).toBeCloseTo(0, 3);

    // No jw_challan_in_yarn_item was actually created for this attempt —
    // the rejection must be atomic, not a partial write.
    const stray = await db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM jw_challan_in_yarn_item_source
       WHERE jw_challan_out_item_id = $1 AND consumed_qty = $2`,
      [outItemId, JWIN_QTY],
    );
    expect(Number(stray!.n)).toBe(0);
  },
);
