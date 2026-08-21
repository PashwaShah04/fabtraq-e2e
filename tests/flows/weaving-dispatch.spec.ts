import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// A fresh purchase-origin beam, status='received'. weaverId is optional —
// pass it to pre-set a PLANNED weaver (WD-L6: "receipt-time weaver is a
// plan; issue is the fact") distinct from the dispatch's own job worker, so
// a later cancel-restore assertion is non-tautological: without a real prior
// weaver, NULL -> jwA -> NULL would pass whether or not the BE actually
// restores previousWeaverId. purchase origin has no ledger drain at all
// (beam-receipt.spec.ts top-of-file note: tx.beam.create only), so calling
// this touches zero stock_ledger rows and cannot interfere with a weft
// half's source-lot query or ledger-delta assertions in the same test.
//
// Driven via direct API (not the beam-receipts UI): fabtraq-fe's beam-receipt
// form has no weaver-picker field at all (confirmed by grep), even though
// beamSpecAttrsSchema.weaverId is a real, BE-validated field on every origin.
// Same "BE-validated request, no UI entry point" pattern already established
// in this suite (beam-receipt.spec.ts's sizing_jw test) — get the CSRF token
// from the browser's own authenticated session.
async function createReceivedBeam(
  page: import('@playwright/test').Page,
  db: import('../../fixtures/db').Db,
  weaverId?: string,
): Promise<{ id: string; beamNumber: string }> {
  const cookies = await page.context().cookies();
  const csrfCookie = cookies.find((c) => c.name === 'fabtraq_csrf');
  if (!csrfCookie) throw new Error('fabtraq_csrf cookie must be present for an authenticated session');
  const csrfToken = decodeURIComponent(csrfCookie.value).split('|')[0] ?? '';

  const beamNumber = codes.unique('BM-WVD');
  const res = await page.request.post(`${env.API_URL}/beam-receipts`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      date: new Date().toISOString().slice(0, 10),
      beamOrigin: 'purchase',
      items: [
        {
          beamNumber,
          netWeight: 50,
          ...(weaverId !== undefined ? { weaverId } : {}),
        },
      ],
    },
  });
  if (res.status() !== 201) throw new Error(`beam receipt create failed: ${await res.text()}`);

  const beam = await db.queryOne<{ id: string }>(`SELECT id FROM beams WHERE beam_number = $1`, [
    beamNumber,
  ]);
  if (!beam) throw new Error('the purchase beam receipt must register a beams row');
  return { id: beam.id, beamNumber };
}

// Cancel is gated behind a Radix AlertDialog on this page (unlike
// beam-receipt's bare-click cancel — confirmed via weaving-dispatch-detail
// .page.tsx's <ConfirmDialog confirmLabel="Cancel dispatch" .../>): the
// trigger button AND the dialog's confirm action share the SAME accessible
// name ("Cancel dispatch"), so a name-only click after the dialog opens
// would hit a Playwright strict-mode ambiguity. Scope the second click to
// the dialog (Radix renders role="alertdialog").
// Must wait for the mutation's own response before returning — the confirm
// click resolves synchronously in Playwright, but the ledger-reversal write
// happens server-side inside the async POST. Without this wait, a caller's
// immediately-following db.ledgerBalance() read races the request and
// observes the pre-cancel state (caught live: cancel appeared to not
// reverse the floor leg, which was actually this race, not a BE bug).
async function cancelDispatch(page: import('@playwright/test').Page): Promise<void> {
  await clickButton(page, 'Cancel dispatch');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        /\/weaving-dispatches\/[^/]+\/cancel$/.test(new URL(res.url()).pathname) &&
        res.status() === 200,
    ),
    dialog.getByRole('button', { name: 'Cancel dispatch' }).click(),
  ]);
}

test(
  'dispatch beams + weft to a weaver writes beam status flip and weft ledger legs, cancel fully reverses',
  async ({ page, db }) => {
    const jobWorkerA = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    const jobWorkerB = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code OFFSET 1 LIMIT 1`,
    );
    expect(jobWorkerA, 'seed must provide an active job worker').not.toBeNull();
    expect(jobWorkerB, 'seed must provide a second active job worker (distinct prior weaver)').not.toBeNull();

    const { id: beamId, beamNumber } = await createReceivedBeam(page, db, jobWorkerB!.id);

    const Q_WEFT = 10;
    // Same derivation as jw-out.spec.ts (raw floor lot, active masters,
    // >= Q_WEFT balance), but deliberately WITHOUT the
    // `cardinality(processed_types) = 0` filter jw-out.spec.ts applies —
    // WD-L3/spec §3.3's L18 predicate fix makes any non-beam-track lot valid
    // weft input, not just raw, and restricting to raw here would under-test
    // that fix.
    //
    // Also deliberately WITHOUT jw-out.spec.ts's `s.job_worker_id IS NULL`
    // filter: per fabtraq-be's position-custody.ts (B-015), a row with a
    // non-null floorId IS a floor position regardless of jobWorkerId — a
    // challan-out floor-debit leg keeps its source floorId while stamping the
    // destination jobWorkerId as provenance. Filtering job_worker_id IS NULL
    // here would exclude such debit legs from the SUM and overstate the
    // floor's real balance (caught live in the full suite: this query
    // reported >=10kg on a floor the FE's own custody-normalized "available"
    // figure — and db.ledgerBalance(floorKey) below, which correctly omits
    // any jobWorkerId filter — showed only 7kg once an earlier spec's
    // debit leg had landed on the same floor position).
    const src = await db.queryOne<{
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
    }>(
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
         AND l.status = 'active' AND f.status = 'active'
         AND q.status = 'active' AND sku.status = 'active'
       GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
                sku.name, sku.shade_number, l.name, f.name, f.id
       HAVING SUM(s.in_quantity - s.out_quantity) >= $1
       ORDER BY s.lot_number
       LIMIT 1`,
      [Q_WEFT],
    );
    expect(src, 'seed must provide a lot with >= Q_WEFT balance on an active floor').not.toBeNull();

    await gotoAndExpect(page, '/weaving-dispatches/new');

    // Header — native <select aria-label="Job worker"> (same pattern as
    // jw-challan-out-form.page.tsx). Date pre-fills to today (controlled
    // Input, no register) — left untouched.
    await selectNativeByLabel(page, 'Job worker', `${jobWorkerA!.code} – ${jobWorkerA!.name}`);

    // Beam section — BeamPickerTable.tsx: "Show all weavers" is a plain
    // checkbox labelled "Show beams for all weavers", NOT a button (plan's
    // [ASSUME] was wrong). jobWorkerA was NOT the beam's planned weaver
    // (jobWorkerB was), so the default weaver-scoped filter must be widened
    // before the beam row is selectable. Each beam's checkbox/weight inputs
    // are keyed by beamNumber, not a row index ("Select beam <no>", "Gross
    // weight for beam <no>", "Pipe weight for beam <no>").
    await page.getByLabel('Show beams for all weavers').check();
    // Narrow the table via the search box (BeamPickerTable "Search beams")
    // before ticking — covers the client-side beam-number filter live.
    await page.getByLabel('Search beams').fill(beamNumber);
    await page.getByLabel(`Select beam ${beamNumber}`).check();
    await page.getByLabel(`Gross weight for beam ${beamNumber}`).fill('52');
    await page.getByLabel(`Pipe weight for beam ${beamNumber}`).fill('2');
    await fillByLabel(page, 'Beam Value of Goods', '5000');

    // Weft section — WeftLineItemRow.tsx: aria-labels are "<field> for weft
    // line N" (plan's [ASSUME] guessed "... for line N", missing "weft").
    // SKU picker keeps the shared default "Select SKU" (no per-row override
    // here, unlike beam-receipt's yarn rows). Placements reuse
    // PlacementFieldArray exactly as jw-out.spec.ts drives it.
    await selectByAriaLabel(page, 'Quality for weft line 1', `${src!.quality_code} – ${src!.quality_name}`);
    const skuOptionLabel =
      src!.sku_shade_number !== null && src!.sku_shade_number !== ''
        ? `${src!.sku_name} — ${src!.sku_shade_number}`
        : src!.sku_name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await selectByAriaLabel(page, 'Source lot for weft line 1', src!.lot_number);
    await fillByLabel(page, 'Net weight for weft line 1', String(Q_WEFT));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select floor and location', `${src!.loc_name} · ${src!.floor_name}`);
    await fillByLabel(page, 'placement quantity 1', String(Q_WEFT));
    await fillByLabel(page, 'Weft Value of Goods', '3000');

    // Two ledger legs cannot both wrap the same click via db.ledgerDelta —
    // compute one combined before/after manually (mirrors beam-receipt.spec
    // .ts's sizing_jw keyA/keyB pattern).
    const floorKey = { lotNumber: src!.lot_number, skuId: src!.sku_id, floorId: src!.floor_id };
    const atJwKey = {
      qualityId: src!.quality_id,
      skuId: src!.sku_id,
      lotNumber: src!.lot_number,
      jobWorkerId: jobWorkerA!.id,
      floorId: null,
      locationId: null,
    };
    const floorBefore = await db.ledgerBalance(floorKey);
    const atJwBefore = await db.ledgerBalance(atJwKey);

    await clickButton(page, 'Save dispatch');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/weaving-dispatches\/[^/]+$/);
    const dispatchId = page.url().split('/').pop();

    const floorAfter = await db.ledgerBalance(floorKey);
    const atJwAfter = await db.ledgerBalance(atJwKey);
    expect(floorAfter - floorBefore).toBeCloseTo(-Q_WEFT, 3);
    expect(atJwAfter - atJwBefore).toBeCloseTo(Q_WEFT, 3);

    const beamAfterDispatch = await db.queryOne<{
      status: string;
      issued_challan_no: string | null;
      weaver_id: string;
    }>(`SELECT status, issued_challan_no, weaver_id FROM beams WHERE id = $1`, [beamId]);
    expect(beamAfterDispatch!.status).toBe('issued_to_weaver');
    expect(beamAfterDispatch!.weaver_id).toBe(jobWorkerA!.id);
    expect(beamAfterDispatch!.issued_challan_no).toBeTruthy();

    // JWB is visible on screen (PageHeader title falls back to beamChallanNo
    // first — weaving-dispatch-detail.page.tsx:87), so it can be captured
    // from the DOM. JWO has no comparable on-screen document number: the
    // page's own title only ever shows one challan number (beamChallanNo, or
    // the weft challan's as a fallback), and challan-pdf now owns both
    // documents entirely — "Beam Challan PDF"/"Weft Challan PDF" buttons
    // (usePrintChallan -> ChallanPdf, opened as a blob: URL in a new tab; see
    // challan-pdf.spec.ts) generate them client-side rather than a
    // CSS-gated `@media print` block on this page. Derive jwoNo from the DB
    // via the dispatch's own FK instead, which is the stronger assertion
    // anyway (proves the row is actually linked, not just that some text on
    // the page matches a regex).
    const jwbNo = await captureDocNo(page.getByRole('main'), /\bJWB-\d{4}-\d{2}-\d{3,}\b/);
    expect(beamAfterDispatch!.issued_challan_no).toBe(jwbNo);

    const dispatchRow = await db.queryOne<{ weft_challan_out_id: string | null }>(
      `SELECT weft_challan_out_id FROM weaving_dispatches WHERE id = $1`,
      [dispatchId],
    );
    expect(dispatchRow!.weft_challan_out_id, 'the dispatch must link a weft challan').not.toBeNull();
    const weftChallan = await db.queryOne<{ challan_no: string }>(
      `SELECT challan_no FROM jw_challans_out WHERE id = $1`,
      [dispatchRow!.weft_challan_out_id],
    );
    expect(weftChallan, 'the linked weft_challan_out_id must resolve to a real jw_challans_out row').not.toBeNull();
    expect(weftChallan!.challan_no).toMatch(/^JWO-\d{4}-\d{2}-\d{3,}$/);

    // Both sections rendered: the "Beams"/"Weft" h2 section headings are
    // plain, always-visible on-screen headings for the line-item tables —
    // no `hidden`/`@media print` gating on this page at all now that the PDF
    // documents ("Job Work Beam Issue"/"Job Work Delivery Weft Purpose") are
    // generated separately by challan-pdf (react-pdf, not this page's own
    // print stylesheet).
    await expect(page.getByRole('heading', { name: 'Beams', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Weft', level: 2 })).toBeVisible();

    await cancelDispatch(page);

    const floorAfterCancel = await db.ledgerBalance(floorKey);
    const atJwAfterCancel = await db.ledgerBalance(atJwKey);
    expect(floorAfterCancel).toBeCloseTo(floorBefore, 3);
    expect(atJwAfterCancel).toBeCloseTo(atJwBefore, 3);

    const beamAfterCancel = await db.queryOne<{
      status: string;
      weaver_id: string;
      issued_challan_no: string | null;
    }>(`SELECT status, weaver_id, issued_challan_no FROM beams WHERE id = $1`, [beamId]);
    expect(beamAfterCancel!.status).toBe('received');
    expect(beamAfterCancel!.weaver_id).toBe(jobWorkerB!.id); // restored to the PRIOR weaver, not null — the actual WD-L6 claim
    expect(beamAfterCancel!.issued_challan_no).toBeNull();

    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  },
);

test('beam-only dispatch mints JWB but no JWO', async ({ page, db }) => {
  const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(jobWorker, 'seed must provide an active job worker').not.toBeNull();

  const { beamNumber } = await createReceivedBeam(page, db);
  // Read the cutoff from Postgres itself, not the Node process's clock — if
  // created_at is DB-side `DEFAULT now()` and the test runner's clock is even
  // slightly ahead of the DB's, a genuinely-created row could land BEFORE a
  // JS-Date cutoff and the "no new JWO" assertion below would silently pass
  // for the wrong reason.
  const dbNow = await db.queryOne<{ t: string }>(`SELECT now() AS t`);
  const createdAtCutoff = dbNow!.t;

  await gotoAndExpect(page, '/weaving-dispatches/new');
  await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
  await page.getByLabel('Show beams for all weavers').check();
  await page.getByLabel(`Select beam ${beamNumber}`).check();
  await clickButton(page, 'Save dispatch');
  await expectToast(page, /^Saved /);
  await expect(page).toHaveURL(/\/weaving-dispatches\/[^/]+$/);

  const jwbNo = await captureDocNo(page.getByRole('main'), /\bJWB-\d{4}-\d{2}-\d{3,}\b/);
  const dispatchId = page.url().split('/').pop();

  const dispatchRow = await db.queryOne<{
    weft_challan_out_id: string | null;
    beam_challan_no: string | null;
  }>(`SELECT weft_challan_out_id, beam_challan_no FROM weaving_dispatches WHERE id = $1`, [dispatchId]);
  expect(dispatchRow!.beam_challan_no).toBe(jwbNo);
  expect(dispatchRow!.weft_challan_out_id).toBeNull();

  // Literal claim ("mints JWB but no JWO"): no jw_challans_out row was
  // created by this action, scoped by time (not a global COUNT) so it stays
  // correct regardless of the previous test's cancel-deletion semantics or
  // any other test creating a JWO before this one runs.
  const newJwoSinceDispatch = await db.queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM jw_challans_out WHERE created_at > $1`,
    [createdAtCutoff],
  );
  expect(newJwoSinceDispatch!.n).toBe('0');

  await expect(page.getByRole('heading', { name: 'Beams', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weft', level: 2 })).toHaveCount(0);
});

test('weaving type is not offered on the plain JW-Out form', async ({ page }) => {
  await gotoAndExpect(page, '/jw-challans-out/new');
  await expect(page.getByRole('heading', { name: 'New Job Work Challan Out' })).toBeVisible();
  // Positive anchor: a sibling operation checkbox that has always been there —
  // proves JobWorkTypeMultiSelect actually mounted, not just that the page
  // didn't 500. No `exact: true`: the wrapping `<Field label="Operations *">`
  // (jw-challan-out-form.page.tsx:375-382) is a single <label> around the
  // whole 5-checkbox group — pre-existing, not introduced by this workstream
  // — so Chromium's accname computation folds "Operations * Job work types"
  // into the FIRST checkbox's name only ("Operations * Job work types
  // Twisting"), not the later ones ("Gassing", "Warping", ...). A substring
  // match is the correct fix here, not exact.
  await expect(page.getByRole('checkbox', { name: 'Twisting' })).toBeVisible();
  // The guard under test: Weaving must be gone, not merely unchecked
  // (JobWorkTypeMultiSelect.tsx filters it out of SELECTABLE_JOB_WORK_TYPES —
  // weaving challans are only ever created via Weaving Dispatch, spec §3.2).
  await expect(page.getByRole('checkbox', { name: 'Weaving', exact: true })).toHaveCount(0);
});
