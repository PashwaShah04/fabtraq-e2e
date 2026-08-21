import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, selectNativeByLabel, clickButton } from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';

// Task F6: challan-print (fabtraq-fe/docs/specs/2026-08-21-challan-pdf-design.md) generates the
// job-work challan PDF client-side (react-pdf, lazy-imported) rather than via the browser's own
// `window.print()` — the "Print PDF" button on a JW challan-out detail page opens a `blob:` URL
// in a new tab. This spec owns its own fixture (jw-out.spec.ts's happy-path pattern: a raw lot +
// active job worker from seed data, driven through the real form) rather than reusing any
// challan another spec may have created, then exercises the print button end to end.
test(
  'Print PDF on a JW challan-out opens a real PDF, and the API/UI carry the print-time fields',
  async ({ page, db }) => {
    const Q = 8;

    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    // Same shape as jw-out.spec.ts's source query: a raw (unprocessed), active-master-data lot
    // with enough balance on a floor position — guaranteed valid input for a 'twisting' item.
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
    }>(
      `SELECT s.lot_number, s.sku_id, s.quality_id,
              q.code AS quality_code, q.name AS quality_name,
              sku.name AS sku_name, sku.shade_number AS sku_shade_number,
              l.name AS loc_name, f.name AS floor_name
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
       GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
                sku.name, sku.shade_number, l.name, f.name
       HAVING SUM(s.in_quantity - s.out_quantity) >= $1
       ORDER BY s.lot_number
       LIMIT 1`,
      [Q],
    );
    expect(src, 'seed must provide a raw lot with sufficient balance on an active floor').not.toBeNull();

    // 1) Create OUR OWN jw-challan-out via the real form (not reusing any challan another spec
    // created — specs own their fixtures).
    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await page.getByLabel('Twisting').check();
    await selectByAriaLabel(page, 'Quality for line 1', `${src!.quality_code} – ${src!.quality_name}`);
    const skuOptionLabel =
      src!.sku_shade_number !== null && src!.sku_shade_number !== ''
        ? `${src!.sku_name} — ${src!.sku_shade_number}`
        : src!.sku_name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await selectByAriaLabel(page, 'Source lot for line 1', src!.lot_number);
    await fillByLabel(page, 'Bag count for line 1', '3');
    await fillByLabel(page, 'Net weight for line 1', String(Q));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select floor and location', `${src!.loc_name} · ${src!.floor_name}`);
    await fillByLabel(page, 'placement quantity 1', String(Q));

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
      items: { qualityName: string }[];
    };
    expect(wireBody.jobWorker.stateName, 'jobWorker.stateName must be hydrated on the response').toBeTruthy();
    expect(wireBody.jobWorker.stateCode, 'jobWorker.stateCode must be hydrated on the response').toBeTruthy();
    expect(wireBody.items.length).toBeGreaterThan(0);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const item of wireBody.items) {
      expect(item.qualityName, 'qualityName must not be blank').toBeTruthy();
      expect(item.qualityName, 'qualityName must be a name, not a raw UUID').not.toMatch(uuidPattern);
    }

    // UI counterpart of the same gap: the Quality column must render the same name string the
    // wire carried (jw-challan-out-detail.page.tsx renders `item.qualityName` directly), not a
    // raw id — this is the live defect the design doc's §5 gap 2 called out ("detail page prints
    // a raw UUID past 200 qualities").
    const qualityCell = page.getByRole('cell', { name: wireBody.items[0]!.qualityName, exact: false });
    await expect(qualityCell.first()).toBeVisible();
    await expect(qualityCell.first()).not.toHaveText(uuidPattern);

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
