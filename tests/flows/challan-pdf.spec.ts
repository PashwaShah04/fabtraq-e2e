import type { Page } from '@playwright/test';

import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { codes } from '../../fixtures/codes';
import type { Db } from '../../fixtures/db';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, fillByLabelExact, selectByAriaLabel, selectByLabel, clickButton } from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import { getCsrfToken } from '../../support/api';
import { createSentinelPurchase } from '../../support/sentinel-purchase';

// This spec's OWN job worker (API-driven, same pattern as fabric-taka-register.spec.ts's
// createJobWorker) instead of the shared "first active job worker" jw-out.spec.ts also picks —
// two specs racing/reusing the same seed row is exactly what the suite's "own data" rule exists
// to prevent. stateCode is set so the print-time hydration assertion below (jobWorker.stateName/
// stateCode) has something real to check, not just whatever the seed happens to carry.
async function createJobWorker(page: Page, db: Db): Promise<{ id: string; code: string; name: string }> {
  const csrfToken = await getCsrfToken(page);
  const name = codes.unique('E2E PDF JobWorker');
  const res = await page.request.post(`${env.API_URL}/job-workers`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { name, stateCode: '27', jobWorkTypes: ['twisting'] },
  });
  if (res.status() !== 201) throw new Error(`job worker create failed: ${await res.text()}`);
  const row = await db.queryOne<{ id: string; code: string }>(
    `SELECT id, code FROM job_workers WHERE name = $1`,
    [name],
  );
  if (!row) throw new Error('the job worker create must register a job_workers row');
  return { id: row.id, code: row.code, name };
}

// Task F6: challan-print (fabtraq-fe/docs/specs/2026-08-21-challan-pdf-design.md) generates the
// job-work challan PDF client-side (react-pdf, lazy-imported) rather than via the browser's own
// `window.print()` — the "Print PDF" button on a JW challan-out detail page opens a `blob:` URL
// in a new tab. This spec owns every fixture it touches: `createJobWorker` above mints a
// dedicated job worker, and `createSentinelPurchase` (already the suite's established "own lot"
// helper — see stock-transfer.spec.ts / jw-out.spec.ts's own second test) mints a dedicated,
// SKU-less lot through a real purchase — no "first active"/"first sufficient" query against
// shared seed rows anywhere in this spec, so it can't race or be starved by another spec hunting
// the same rows.
test(
  'Print PDF on a JW challan-out opens a real PDF, and the API/UI carry the print-time fields',
  async ({ page, db }) => {
    const Q = 8;

    const jobWorker = await createJobWorker(page, db);
    const partyLot = codes.unique('PL');
    const sentinel = await createSentinelPurchase(page, db, Q, { partyLotNo: partyLot });
    const quality = await db.queryOne<{ code: string; name: string }>(
      `SELECT code, name FROM yarn_qualities WHERE id = $1`,
      [sentinel.qualityId],
    );
    expect(quality, 'sentinel purchase must reference a real quality').not.toBeNull();

    // 1) Create OUR OWN jw-challan-out via the real form (not reusing any challan another spec
    // created — specs own their fixtures).
    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectByLabel(page, 'Job worker', `${jobWorker.code} – ${jobWorker.name}`);
    await page.getByLabel('Twisting').check();
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    // No SKU select: createSentinelPurchase's lot is SKU-less by design (the "No shade / greige"
    // sentinel answer) — same as jw-out.spec.ts's own sentinel-driven test.
    await selectByAriaLabel(page, 'Source lot for line 1', sentinel.lotNumber);
    await fillByLabel(page, 'Bag count for line 1', '3');
    await fillByLabel(page, 'Net weight for line 1', String(Q));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select floor and location',
      `${sentinel.location.name} · ${sentinel.floor.name}`,
    );
    await fillByLabelExact(page, 'placement quantity 1', String(Q));

    await clickButton(page, 'Save challan');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();
    expect(challanId, 'save must redirect to a detail URL carrying the new id').toBeTruthy();

    // Fresh load of the detail route (not just the post-save redirect), matching jw-out.spec.ts's
    // own convention of confirming the route itself renders from scratch.
    await gotoAndExpect(page, `/jw-challans-out/${challanId}`);
    await expect(page.getByRole('heading', { name: `Job Work Challan Out ${challanNo}` })).toBeVisible();

    // 2) LIVE WIRE — closes a known gap (fabtraq-fe/docs/specs/2026-08-21-challan-pdf-design.md
    // §5): the challan-print mappers need jobWorker.stateName/stateCode (PRD §374's State/State
    // Code requirement) and item.qualityName hydrated directly onto the API response, not just
    // present in an MSW fixture. Hit the live backend directly (not a mock) for this exact
    // challan and assert those additive fields actually arrived over the wire.
    const wireRes = await page.request.get(`${env.API_URL}/jw-challans-out/${challanId}`);
    expect(wireRes.ok()).toBe(true);
    const wireBody = (await wireRes.json()) as {
      jobWorker: { stateName: string | null; stateCode: string | null };
      items: { qualityName: string; sourceLotNumber: string; partyLotNo: string | null }[];
    };
    expect(wireBody.jobWorker.stateName, 'jobWorker.stateName must be hydrated on the response').toBeTruthy();
    expect(wireBody.jobWorker.stateCode, 'jobWorker.stateCode must be hydrated on the response').toBeTruthy();
    expect(wireBody.items.length).toBeGreaterThan(0);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const item of wireBody.items) {
      expect(item.qualityName, 'qualityName must not be blank').toBeTruthy();
      expect(item.qualityName, 'qualityName must be a name, not a raw UUID').not.toMatch(uuidPattern);
    }

    // The party lot the purchase form was given, resolved at READ time by the
    // BE from `yarn_purchase_item.party_lot_no` via
    // IInventoryService.findPartyLotsByLotNumbers (spec L4) and printed in the
    // challan's "Lot No." column instead of the minted lot (L1). Asserting the
    // exact typed string — not merely "not null" — is what catches a map keyed
    // on the item id instead of the lot number: with one item, a wrongly keyed
    // map yields null, and a right-keyed one yields exactly this value.
    expect(wireBody.items[0]!.sourceLotNumber).toBe(sentinel.lotNumber);
    expect(
      wireBody.items[0]!.partyLotNo,
      'items[].partyLotNo must carry the party lot typed on the purchase form',
    ).toBe(partyLot);

    // UI counterpart of the same gap: the Quality column must render the same name string the
    // wire carried (jw-challan-out-detail.page.tsx renders `item.qualityName` directly), not a
    // raw id — this is the live defect the design doc's §5 gap 2 called out ("detail page prints
    // a raw UUID past 200 qualities").
    const qualityCell = page.getByRole('cell', { name: wireBody.items[0]!.qualityName, exact: false });
    await expect(qualityCell.first()).toBeVisible();
    await expect(qualityCell.first()).not.toHaveText(uuidPattern);

    // L6 — the detail page shows BOTH identities in ONE cell: the party lot on
    // top, the minted lot beneath in muted text
    // (jw-challan-out-detail.page.tsx:316). Located by the minted lot rather
    // than by the column header (the header there reads "Source Lot", :291,
    // not "Lot No") and asserted on the CELL, not the row: bags/cones/gross all
    // render '—' in the same row, so a row-level assertion would be satisfied
    // by the wrong element.
    const lotCell = page
      .getByRole('row', { name: sentinel.lotNumber })
      .getByRole('cell')
      .filter({ hasText: sentinel.lotNumber });
    await expect(lotCell).toHaveCount(1);
    await expect(lotCell).toContainText(partyLot);
    await expect(lotCell).toContainText(sentinel.lotNumber);

    // 3) Click "Print PDF" and assert both that a real popup/tab opens (`context.
    // waitForEvent('page')`) AND capture the exact blob: URL `window.open` was called with.
    // Chromium hands a direct blob:-PDF navigation to its native PDF viewer, which never
    // settles into a normal document lifecycle from Playwright's side — `popup.url()` reads back
    // as empty/unusable no matter which load-state/URL wait is used, even though the tab is
    // genuinely there showing the PDF. So the URL itself is captured straight from the
    // `window.open` call (patched on the ORIGINAL page, in the same realm `usePrintChallan.ts`
    // called `URL.createObjectURL` from) rather than read back off the popup.
    const openedUrlPromise = page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const realOpen = window.open.bind(window);
          window.open = ((url?: string | URL, target?: string, features?: string) => {
            resolve(String(url));
            return realOpen(url, target, features);
          }) as typeof window.open;
        }),
    );
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      clickButton(page, 'Print PDF'),
    ]);
    const openedUrl = await openedUrlPromise;
    expect(openedUrl).toMatch(/^blob:/);
    expect(popup.isClosed()).toBe(false);

    // Fetch the blob's own bytes back on the ORIGINAL page — blob: URLs only resolve within the
    // browsing realm that minted them via `URL.createObjectURL`, which is this page, not the
    // popup — and confirm it's a real, non-trivial PDF: the %PDF- magic prefix, and >10KB (the
    // letterhead logo/wordmark JPEGs plus the embedded Liberation Sans subset alone push a real
    // document well past that; a near-empty or corrupt blob would be far smaller).
    const pdfInfo = await page.evaluate(async (url: string) => {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let prefix = '';
      for (let i = 0; i < 5 && i < bytes.length; i++) prefix += String.fromCharCode(bytes[i]!);
      return { prefix, size: bytes.length };
    }, openedUrl);
    expect(pdfInfo.prefix).toBe('%PDF-');
    expect(pdfInfo.size).toBeGreaterThan(10 * 1024);

    await popup.close();
  },
);
