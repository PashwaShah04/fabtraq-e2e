import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

// FabricDesign (2026-08-12 weaving-in spec §2/§4) is a standard master —
// "job-worker anatomy": CRUD with a real edit route, unlike beam Design
// (create -> read-only detail, no edit — designs.spec.ts). `code` is a
// user-typed business code ("TATA" in the spec's own example — the weaver's
// paper "Design No"), NOT server-minted like DSN-/JW- codes, so it's a plain
// required text field on the form, same treatment as HSN Code on
// quality-form.page.tsx.
test('create → list → edit → persist a fabric design', async ({ page, db }) => {
  const quality = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

  const code = codes.unique('FABD');
  const name = `E2E Fabric Design ${code}`;

  // CREATE
  await gotoAndExpect(page, '/fabric-designs/new');
  await fillByLabel(page, 'Code', code);
  await fillByLabel(page, 'Name', name);
  // weftQualityId is the only other required field on createFabricDesignSchema
  // (spec §2) — expectedGlm/jobRatePerMeter/weftSkuId/beamDesigns are all
  // optional, left untouched for the happy-path create.
  await selectByAriaLabel(page, 'Weft quality', `${quality!.code} – ${quality!.name}`);
  await clickButton(page, 'Create');
  await expectToast(page, 'Fabric design created');

  // LIST — new fabric design appears
  await gotoAndExpect(page, '/fabric-designs');
  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();

  // EDIT — same row/link shape as job-workers.spec.ts / qualities.spec.ts
  // (Edit is a react-router Link, not a plain button).
  await page.getByRole('row', { name }).getByRole('button', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/fabric-designs\/[^/]+\/edit/);
  await fillByLabel(page, 'Expected GLM', '250');
  await clickButton(page, 'Update');
  await expectToast(page, 'Fabric design updated');

  // PERSIST — reopen via a fresh navigation, verify the edited field.
  await gotoAndExpect(page, '/fabric-designs');
  await page.getByRole('row', { name }).getByRole('button', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/fabric-designs\/[^/]+\/edit/);
  await expect(page.getByLabel('Expected GLM')).toHaveValue('250');
});
