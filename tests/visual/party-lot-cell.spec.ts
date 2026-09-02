import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, fillByLabelExact, selectByAriaLabel, selectByLabel, clickButton } from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import { createSentinelPurchase } from '../../support/sentinel-purchase';

// Screenshot-only aid for CLAUDE.md's "UI changes get live screenshots read
// as a first-time user" rule, for the stacked party-lot / minted-lot cell
// added to the JW-Out detail page's line-items table (spec
// docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md
// §3.4). Not part of the assertion suite (that's tests/flows/jw-out.spec.ts's
// fourth test) — this file exists purely to produce PNGs a human reads.
// Never committed as e2e-artifacts; the lead decides whether it stays.
//
// Setup mirrors jw-out.spec.ts's party-lot test byte-for-byte (same helpers,
// same two-sentinel-purchase shape) rather than importing across spec files,
// matching this repo's stated convention (jw-out.spec.ts:159-161,
// sentinel-purchase.ts:36-41).
const SCREENS_DIR =
  '/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/screens';

test(
  'JW-Out detail page renders the stacked party-lot / minted-lot cell (screenshot)',
  async ({ page, db }) => {
    const Q = 7;
    const partyLot = codes.unique('PL');

    const withPl = await createSentinelPurchase(page, db, Q, { partyLotNo: partyLot });
    const withoutPl = await createSentinelPurchase(page, db, Q);

    const quality = await db.queryOne<{ code: string; name: string }>(
      `SELECT code, name FROM yarn_qualities WHERE id = $1`,
      [withPl.qualityId],
    );
    expect(quality, 'the sentinel purchases must reference a real quality').not.toBeNull();

    const jobWorker = await db.queryOne<{ code: string; name: string }>(
      `SELECT code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await page.getByLabel('Twisting').check();

    // Line 1 — the party-lot lot.
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    await selectByAriaLabel(page, 'Source lot for line 1', withPl.lotNumber);
    await fillByLabel(page, 'Net weight for line 1', String(Q));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(
      page,
      'Select floor and location',
      `${withPl.location.name} · ${withPl.floor.name}`,
    );
    await fillByLabelExact(page, 'placement quantity 1', String(Q));

    // Line 2 — the bare lot, no party lot.
    await clickButton(page, 'Add line');
    const line2 = page
      .locator('tr')
      .filter({ has: page.locator('[aria-label="Quality for line 2"]') });
    await selectByAriaLabel(page, 'Quality for line 2', `${quality!.code} – ${quality!.name}`);
    await selectByAriaLabel(page, 'Source lot for line 2', withoutPl.lotNumber);
    await fillByLabel(page, 'Net weight for line 2', String(Q));
    await line2.getByRole('button', { name: 'Add placement' }).click();
    await line2.locator('[aria-label="Select floor and location"]').click();
    await page
      .getByRole('option', { name: `${withoutPl.location.name} · ${withoutPl.floor.name}` })
      .click();
    await line2.getByLabel('placement quantity 1', { exact: true }).fill(String(Q));

    await clickButton(page, 'Save challan');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();

    await gotoAndExpect(page, `/jw-challans-out/${challanId}`);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan Out ${challanNo}` }),
    ).toBeVisible();
    // Sanity: both rows are on screen before photographing them.
    await expect(page.getByRole('row', { name: withPl.lotNumber })).toContainText(partyLot);
    await expect(page.getByRole('row', { name: withoutPl.lotNumber })).toContainText('—');

    await page.screenshot({
      path: `${SCREENS_DIR}/jw-out-detail-full.png`,
      fullPage: true,
    });
    await page.getByRole('table').screenshot({
      path: `${SCREENS_DIR}/jw-out-detail-table.png`,
    });
  },
);
